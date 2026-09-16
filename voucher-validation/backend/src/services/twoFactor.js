// src/services/twoFactor.js
// TOTP two-factor authentication, ported from the Ticket-System implementation
// so both consoles behave the same way for the people who use both.
//
// THE SHAPE OF THE LOGIN, and why it is two steps:
//   password ok, 2FA on   -> a 5-minute token marked pending2FA. It opens
//                            nothing; the only thing it can do is be exchanged
//                            for a real token by a valid code.
//   password ok, 2FA off  -> a full token, or — when the estate requires 2FA —
//                            a 15-minute setup token that can reach only the
//                            enrolment endpoints.
// Splitting it this way means a stolen password alone never yields a session,
// and an account that has not enrolled cannot wander the app while it decides.
//
// Backup codes are stored as bcrypt hashes and CONSUMED on use. A database
// someone has read should not hand them a way past 2FA, and a code that has
// been used once should not work twice.

import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { seal, open as unseal, needsReseal } from "./secretBox.js";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export const ISSUER = "Vodafone Fiji USO";

/**
 * Global enforcement, owned by an admin in Settings.
 *
 * DEFAULTS TO OFF. Enforcement is a deliberate act by an administrator who has
 * enrolled first and knows the reset path — not something a deploy turns on for
 * an estate that has never seen it. Anyone can still enrol individually while
 * it is off; the switch only decides whether it is compulsory.
 */
let lastKnownPolicy = false;

export async function isTwoFactorRequired(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'require_2fa'"
    );
    const v = rows[0]?.setting_value;
    if (v == null) { lastKnownPolicy = false; return false; }
    lastKnownPolicy = String(v).toLowerCase() === "true" || String(v) === "1";
    return lastKnownPolicy;
  } catch (e) {
    // A read failure used to answer "not required", which fails OPEN: a
    // database hiccup, or a query an attacker can make fail, turns enforcement
    // off estate-wide and every account signs in on a password alone. Cached
    // instead — the last answer the database actually gave — so an outage
    // holds the policy steady rather than lifting it. Only a process that has
    // never managed one read falls back to off, and that process cannot serve
    // logins anyway.
    console.error("[2fa] policy read failed, using last known value:", e.message);
    return lastKnownPolicy;
  }
}

export async function setTwoFactorRequired(pool, on) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, setting_type, description)
     VALUES ('require_2fa', ?, 'boolean', 'Require two-factor authentication for every console account')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [on ? "true" : "false"]
  );
  return !!on;
}

/**
 * Starts enrolment: a fresh secret plus a QR the browser can render without
 * needing a QR library of its own. The secret is stored but 2FA stays OFF —
 * see verifyEnrolment.
 */
export async function beginEnrolment(pool, user) {
  // Starting enrolment OVERWRITES totp_secret while leaving totp_enabled
  // alone, so an account that already has a working second factor and merely
  // opens this screen — then closes it — has had its secret replaced by one
  // nothing holds. It is still marked as enrolled, so the next sign-in asks
  // for a code no authenticator can produce: locked out, admin reset only.
  //
  // Turning it off first is the supported way to re-enrol, and that path asks
  // for the password.
  const [[current]] = await pool.query(
    "SELECT totp_enabled FROM users WHERE id = ?",
    [user.id]
  );
  if (current?.totp_enabled) {
    const e = new Error(
      "Two-factor is already on for this account. Turn it off first if you want to set it up again."
    );
    e.code = "ALREADY_ENROLLED";
    throw e;
  }

  const generated = speakeasy.generateSecret({
    name: `${ISSUER}:${user.email}`,
    issuer: ISSUER,
    length: 20,
  });
  const secret = generated.base32;
  // The label has to carry the issuer too, or some authenticators list the
  // entry as a bare email address with no hint which system it belongs to.
  const otpauth =
    generated.otpauth_url ||
    `otpauth://totp/${encodeURIComponent(`${ISSUER}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`;
  const qrCode = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: "L", margin: 1, width: 256 });

  // Sealed on the way in. A no-key deployment gets the plaintext back from
  // seal(), so this is safe to land before the key is configured.
  await pool.query("UPDATE users SET totp_secret = ? WHERE id = ?", [seal(secret), user.id]);
  return { secret, qrCode, manualEntryKey: secret };
}

/** Ten single-use codes, returned in clear ONCE and stored only as hashes. */
async function makeBackupCodes() {
  const plain = [];
  const hashed = [];
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
    plain.push(code);
    // Cost 6: these are high-entropy random codes, not human passwords, so the
    // work factor that protects a guessable secret is not needed here.
    hashed.push(await bcrypt.hash(code, 6));
  }
  return { plain, hashed };
}

/**
 * Completes enrolment. 2FA only switches on once a code from the authenticator
 * verifies, which proves the secret was actually scanned — enabling it any
 * earlier locks the account out of its own login.
 */
export async function verifyEnrolment(pool, userId, code) {
  const [rows] = await pool.query(
    "SELECT totp_secret, totp_enabled FROM users WHERE id = ?",
    [userId]
  );
  const stored = rows[0]?.totp_secret;
  if (!stored) return { ok: false, error: "Start the setup again — no pending secret for this account." };
  let secret;
  try {
    secret = unseal(stored);
  } catch (e) {
    // The key that sealed this is not configured. Say so rather than treating
    // the ciphertext as a secret, which would fail every code forever with a
    // message about the clock on their phone.
    console.error("[2fa] cannot read pending secret:", e.message);
    return { ok: false, error: "Two-factor setup is not available right now. Tell your administrator." };
  }

  // Enrolment is for accounts that have no second factor. Without this, anyone
  // holding a session could call it against the LIVE secret and be handed a
  // fresh set of backup codes — replacing every code the owner holds, with no
  // password, going round the endpoint that exists to ask for one.
  if (rows[0].totp_enabled) {
    return { ok: false, error: "Two-factor is already on for this account." };
  }

  // window: 1 accepts the adjacent 30s step either side, which covers ordinary
  // clock drift on a phone without meaningfully widening the guess space.
  // verifyDelta rather than verify, because the step has to be RECORDED.
  const delta = speakeasy.totp.verifyDelta({
    secret,
    encoding: "base32",
    token: String(code),
    window: 1,
  });
  if (!delta) return { ok: false, error: "That code is not right. Check the clock on your phone and try the current code." };

  const { plain, hashed } = await makeBackupCodes();
  // The enrolment code is SPENT, and is recorded as spent.
  //
  // Writing NULL here — which this did — says "nothing has been used yet" at
  // the exact moment something has. Someone who read those six digits off the
  // screen during setup had the ~90 seconds of the window to sign in with
  // them, which is the replay the single-use rule exists to stop, reopened by
  // the one code an onlooker is most likely to have seen.
  const step = Math.floor(Date.now() / 30000) + delta.delta;
  const [res] = await pool.query(
    `UPDATE users
        SET totp_enabled = 1, totp_backup_codes = ?, totp_enrolled_at = NOW(),
            totp_last_step = ?
      WHERE id = ? AND totp_enabled = 0`,
    [JSON.stringify(hashed), step, userId]
  );
  // Conditional on still being un-enrolled, so two setups racing cannot both
  // enable — the loser would otherwise leave codes nobody was shown.
  if (res.affectedRows !== 1) {
    return { ok: false, error: "Two-factor is already on for this account." };
  }
  return { ok: true, backupCodes: plain };
}

/**
 * Issues a fresh set of backup codes for an already-enrolled account, replacing
 * whatever is there.
 *
 * This exists because the obvious alternative does not work when it is needed
 * most: "turn two-factor off and on again" is refused outright while the estate
 * policy requires it, which is exactly the situation where someone down to
 * their last code cannot afford to be stuck. The authenticator secret is left
 * alone — the phone still works, only the paper fallback is replaced.
 */
export async function regenerateBackupCodes(pool, userId) {
  const [rows] = await pool.query("SELECT totp_enabled FROM users WHERE id = ?", [userId]);
  if (!rows[0]?.totp_enabled) {
    return { ok: false, error: "Two-factor is not on for this account." };
  }
  const { plain, hashed } = await makeBackupCodes();
  await pool.query("UPDATE users SET totp_backup_codes = ? WHERE id = ?", [
    JSON.stringify(hashed),
    userId,
  ]);
  return { ok: true, backupCodes: plain };
}

/**
 * Checks a code at login: the authenticator first, then the backup codes.
 *
 * A backup code that matches is REMOVED before this returns, so it cannot be
 * replayed. The remaining count comes back so the caller can warn someone who
 * is running out.
 */
export async function verifyCode(pool, userId, code) {
  const [rows] = await pool.query(
    "SELECT totp_secret, totp_backup_codes, totp_last_step FROM users WHERE id = ?",
    [userId]
  );
  const stored = rows[0]?.totp_secret;
  if (!stored) return { ok: false, error: "Two-factor authentication is not set up for this account." };
  let secret;
  try {
    secret = unseal(stored);
  } catch (e) {
    // Better a clear refusal than a confident "wrong code" against something
    // that was never the secret.
    console.error("[2fa] cannot read secret at login:", e.message);
    return { ok: false, error: "Two-factor is not available right now. Tell your administrator." };
  }

  // Turning the key on does not require a migration to have run first: the
  // next successful sign-in upgrades the row. The script covers accounts that
  // do not sign in often.
  if (needsReseal(stored)) {
    pool
      .query("UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?", [seal(secret), userId, stored])
      .catch((e) => console.error("[2fa] reseal failed (harmless, will retry):", e.message));
  }

  // speakeasy.totp.verifyDelta returns WHICH step matched, which is what makes
  // single-use possible: the code alone cannot be compared against anything,
  // but the step it belongs to can be remembered.
  const delta = speakeasy.totp.verifyDelta({
    secret,
    encoding: "base32",
    token: String(code),
    window: 1,
  });

  if (delta) {
    const step = Math.floor(Date.now() / 30000) + delta.delta;
    const last = rows[0]?.totp_last_step == null ? null : Number(rows[0].totp_last_step);

    // A code is good for about ninety seconds across the window. Accepting it
    // more than once in that time means a code seen over a shoulder, left on a
    // shared screen, or captured in flight is a second sign-in for whoever has
    // it. Each step is spent once, and anything at or before the last one
    // spent is refused.
    if (last != null && step <= last) {
      return { ok: false, error: "That code has already been used. Wait for your app to show the next one." };
    }

    // Conditional on the step not having moved, so two requests arriving
    // together cannot both claim it: the second UPDATE matches no rows.
    const [res] = await pool.query(
      `UPDATE users SET totp_last_step = ?
        WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
      [step, userId, step]
    );
    if (res.affectedRows !== 1) {
      return { ok: false, error: "That code has already been used. Wait for your app to show the next one." };
    }
    return { ok: true, usedBackupCode: false };
  }

  const raw = rows[0]?.totp_backup_codes;
  const codes = !raw ? [] : typeof raw === "string" ? JSON.parse(raw) : raw;
  for (let i = 0; i < codes.length; i++) {
    if (await bcrypt.compare(String(code), codes[i])) {
      const remaining = codes.filter((_, j) => j !== i);
      // Spending the code is conditional on the stored list still being the
      // one we read. Two requests presenting the SAME backup code at the same
      // moment would otherwise both compare successfully against their own
      // copy and both write back — the code would work twice, which is the one
      // thing a single-use code must never do. The second UPDATE matches
      // nothing and is refused.
      const [res] = await pool.query(
        "UPDATE users SET totp_backup_codes = ? WHERE id = ? AND totp_backup_codes = ?",
        [JSON.stringify(remaining), userId, typeof raw === "string" ? raw : JSON.stringify(raw)]
      );
      if (res.affectedRows !== 1) {
        return { ok: false, error: "That code has already been used." };
      }
      return { ok: true, usedBackupCode: true, backupCodesRemaining: remaining.length };
    }
  }
  return { ok: false, error: "That code is not right." };
}

/**
 * Clears 2FA for an account. Used both by a person turning it off for
 * themselves and by an admin rescuing someone who has lost their phone —
 * which is the same database operation and deliberately the same function, so
 * the two cannot drift apart.
 */
export async function clearTwoFactor(pool, userId) {
  await pool.query(
    `UPDATE users
        SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL,
            totp_enrolled_at = NULL, totp_last_step = NULL
      WHERE id = ?`,
    [userId]
  );
}

