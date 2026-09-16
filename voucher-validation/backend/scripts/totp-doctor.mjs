#!/usr/bin/env node
// scripts/totp-doctor.mjs
//
// Why is this code being rejected?
//
//     node scripts/totp-doctor.mjs someone@example.com            # state only
//     node scripts/totp-doctor.mjs someone@example.com 123456     # explain one code
//
// "The code does not work" has several causes that look identical from the
// sign-in screen, and guessing between them costs an afternoon:
//
//   • the server clock has drifted, so every code is wrong by a fixed offset
//   • the authenticator holds an entry from an EARLIER enrolment, because each
//     visit to the setup screen mints a new secret
//   • the code is right but already spent (the single-use rule)
//   • the encryption key is missing or wrong, so the stored secret is unreadable
//
// Given a code, this says which. It searches a deliberately wide window — far
// wider than login accepts — so a code that matches at ±5 steps reports the
// drift instead of reporting "wrong".
//
// It does NOT print the secret, and does not print a usable code.

import speakeasy from "speakeasy";
import { openPool } from "./_db.mjs";

const { open: unseal, isSealed, encryptionEnabled, activeKeyId } =
  await import("../src/services/secretBox.js");

const [email, code] = process.argv.slice(2);
if (!email) {
  console.error("Usage: node scripts/totp-doctor.mjs <email> [6-digit-code]");
  process.exit(1);
}

const pool = openPool();
const [rows] = await pool.query(
  `SELECT id, email, totp_enabled, totp_secret, totp_last_step, totp_backup_codes, totp_enrolled_at
     FROM users WHERE email = ?`,
  [email]
);
const u = rows[0];
if (!u) {
  console.error(`No account with the address ${email}`);
  await pool.end();
  process.exit(1);
}

const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);

console.log(`\nAccount #${u.id}  ${u.email}`);
line("two-factor", u.totp_enabled ? "ON" : "off");
line("enrolled at", u.totp_enrolled_at ? new Date(u.totp_enrolled_at).toISOString() : "—");
line("secret stored", u.totp_secret ? (isSealed(u.totp_secret) ? "yes, encrypted" : "yes, PLAINTEXT") : "NO");
line("encryption", encryptionEnabled ? `on (key ${activeKeyId})` : "off — no key configured");

const codes = !u.totp_backup_codes
  ? []
  : typeof u.totp_backup_codes === "string"
    ? JSON.parse(u.totp_backup_codes)
    : u.totp_backup_codes;
line("backup codes left", codes.length);

const nowStep = Math.floor(Date.now() / 30000);
line("server time", new Date().toISOString());
line("current step", nowStep);
line("last step used", u.totp_last_step == null ? "none" : String(u.totp_last_step));

if (u.totp_last_step != null) {
  const d = nowStep - Number(u.totp_last_step);
  if (d <= 0) {
    console.log(
      `\n  ⚠ The last step used is AT OR AHEAD of now (${d}). Every code will be\n` +
      "    refused as already-used until the clock catches up. This means the\n" +
      "    server clock moved backwards — check NTP."
    );
  }
}

if (!u.totp_secret) {
  console.log("\nNothing to check: this account has no secret. It must enrol.");
  await pool.end();
  process.exit(0);
}

let secret;
try {
  secret = unseal(u.totp_secret);
} catch (e) {
  console.log(`\n  ✗ THE STORED SECRET CANNOT BE READ: ${e.message}`);
  console.log(
    "\n    Every code will be rejected until this is resolved. Either restore the\n" +
    "    key that sealed it (TOTP_ENCRYPTION_KEY_OLD), or reset two-factor for\n" +
    "    this account from the Users page and enrol again."
  );
  await pool.end();
  process.exit(1);
}
console.log("  secret readable       yes");

if (!code) {
  console.log(
    "\nPass a code from the authenticator app to have it explained:\n" +
    `  node scripts/totp-doctor.mjs ${email} 123456\n`
  );
  await pool.end();
  process.exit(0);
}

// Deliberately far wider than login's window: the point is to find a match that
// login would MISS, and say why it missed.
const WIDE = 20; // ±10 minutes
const hit = speakeasy.totp.verifyDelta({
  secret,
  encoding: "base32",
  token: String(code).replace(/\s+/g, ""),
  window: WIDE,
});

console.log("");
if (!hit) {
  console.log("  ✗ That code does not match this secret at any point in ±10 minutes.");
  console.log(
    "\n    Almost always this means the authenticator is showing an entry from an\n" +
    "    EARLIER enrolment — every visit to the setup screen mints a new secret,\n" +
    "    and only the most recent one is stored. Check for more than one\n" +
    "    'Vodafone Fiji USO' entry and try the newest, or use a backup code.\n" +
    "    Failing that, reset two-factor for the account and enrol once, cleanly."
  );
  await pool.end();
  process.exit(1);
}

const matchedStep = nowStep + hit.delta;
console.log(`  ✓ The code matches this secret, at step ${matchedStep} (delta ${hit.delta}).`);

if (Math.abs(hit.delta) > 1) {
  console.log(
    `\n  ✗ BUT login accepts only ±1 step, and this is ${hit.delta}.\n` +
    `    That is a clock difference of about ${Math.round(Math.abs(hit.delta) * 30)} seconds between this\n` +
    "    server and the phone. Fix the SERVER clock first — it is the one that\n" +
    "    has to be right:\n" +
    "        timedatectl status\n" +
    "        sudo timedatectl set-ntp true\n" +
    "    If the server is correct, the phone's clock is off; on Android the\n" +
    "    setting is Google Authenticator → ⋮ → Time correction for codes."
  );
} else if (u.totp_last_step != null && matchedStep <= Number(u.totp_last_step)) {
  console.log(
    `\n  ✗ BUT this code is already spent (last step used: ${u.totp_last_step}).\n` +
    "    Each code works once by design. Wait for the app to show the next one."
  );
} else {
  console.log("\n  ✓ Login would ACCEPT this code right now. Nothing is wrong with the secret,");
  console.log("    the encryption, or the clock — look at throttling or the sign-in flow instead:");
  console.log("        SELECT event, success, detail, ip_address, created_at");
  console.log("          FROM two_factor_events ORDER BY id DESC LIMIT 20;");
}

await pool.end();
