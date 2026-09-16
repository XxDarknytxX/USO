#!/usr/bin/env node
// scripts/reset-2fa.mjs
//
// Clears two-factor on one account, from the server.
//
//     node scripts/reset-2fa.mjs someone@example.com            # show what it would do
//     node scripts/reset-2fa.mjs someone@example.com --apply
//
// The escape hatch for the case the admin UI cannot cover: the LAST
// administrator is locked out, so there is nobody left who can reset them from
// the Users page. Shell access on the server is the authority here, which is
// the same authority that could edit the database by hand — this just does it
// correctly, clearing every related column instead of the one you remembered.
//
// After this the account signs in with its PASSWORD ALONE, and is walked
// through enrolment again if the estate policy requires two-factor. So it is
// exactly as strong as that password until they re-enrol — do it, then enrol
// straight away, and prefer the Users page whenever another admin is available,
// because that route is logged with a named actor and mails the account holder.

import { openPool } from "./_db.mjs";
import { logTwoFactorEvent } from "../src/services/twoFactorLog.js";

const [email, ...rest] = process.argv.slice(2);
const apply = rest.includes("--apply");

if (!email) {
  console.error("Usage: node scripts/reset-2fa.mjs <email> [--apply]");
  process.exit(1);
}

const pool = openPool();
const [rows] = await pool.query(
  `SELECT id, email, name, role, totp_enabled, totp_enrolled_at,
          totp_secret IS NOT NULL AS has_secret
     FROM users WHERE email = ?`,
  [email]
);
const u = rows[0];
if (!u) {
  console.error(`No account with the address ${email}`);
  await pool.end();
  process.exit(1);
}

console.log(`\nAccount #${u.id}  ${u.email}  (${u.role})`);
console.log(`  two-factor      ${u.totp_enabled ? "ON" : "off"}`);
console.log(`  secret stored   ${u.has_secret ? "yes" : "no"}`);
console.log(`  enrolled at     ${u.totp_enrolled_at ? new Date(u.totp_enrolled_at).toISOString() : "—"}`);

if (!u.totp_enabled && !u.has_secret) {
  console.log("\nNothing to clear — this account has no second factor.");
  await pool.end();
  process.exit(0);
}

if (!apply) {
  console.log(
    "\nWould clear the authenticator secret, every backup code, the enrolment\n" +
    "date and the replay marker. Nothing was changed.\n\n" +
    `Re-run with --apply:\n  node scripts/reset-2fa.mjs ${email} --apply\n`
  );
  await pool.end();
  process.exit(0);
}

const [res] = await pool.query(
  `UPDATE users
      SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL,
          totp_enrolled_at = NULL, totp_last_step = NULL
    WHERE id = ?`,
  [u.id]
);

// Recorded like any other reset. A reset performed from a shell has no HTTP
// request and no signed-in actor behind it, and the log says so rather than
// leaving a row that looks like somebody in the UI did it.
logTwoFactorEvent(pool, {
  userId: u.id,
  userEmail: u.email,
  event: "admin_reset",
  detail: "from the server console (reset-2fa.mjs)",
});

console.log(
  res.affectedRows
    ? "\n✓ Two-factor cleared. This account now signs in with its password alone.\n" +
      "  Enrol again from Profile → Security as soon as you are back in — and if the\n" +
      "  estate policy requires two-factor, the next sign-in will walk you through it.\n"
    : "\n✗ Nothing was updated. The account may have changed while this ran.\n"
);

// Give the fire-and-forget log write a moment to land before the pool closes.
await new Promise((r) => setTimeout(r, 250));
await pool.end();
