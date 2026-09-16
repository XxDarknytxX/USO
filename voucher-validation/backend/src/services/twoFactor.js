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
export async function isTwoFactorRequired(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'require_2fa'"
    );
    const v = rows[0]?.setting_value;
    if (v == null) return false;
    return String(v).toLowerCase() === "true" || String(v) === "1";
  } catch {
    return false;
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

  await pool.query("UPDATE users SET totp_secret = ? WHERE id = ?", [secret, user.id]);
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
  const [rows] = await pool.query("SELECT totp_secret FROM users WHERE id = ?", [userId]);
  const secret = rows[0]?.totp_secret;
  if (!secret) return { ok: false, error: "Start the setup again — no pending secret for this account." };

  // window: 1 accepts the adjacent 30s step either side, which covers ordinary
  // clock drift on a phone without meaningfully widening the guess space.
  const valid = speakeasy.totp.verify({ secret, encoding: "base32", token: String(code), window: 1 });
  if (!valid) return { ok: false, error: "That code is not right. Check the clock on your phone and try the current code." };

  const { plain, hashed } = await makeBackupCodes();
  await pool.query(
    "UPDATE users SET totp_enabled = 1, totp_backup_codes = ?, totp_enrolled_at = NOW() WHERE id = ?",
    [JSON.stringify(hashed), userId]
  );
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
    "SELECT totp_secret, totp_backup_codes FROM users WHERE id = ?",
    [userId]
  );
  const secret = rows[0]?.totp_secret;
  if (!secret) return { ok: false, error: "Two-factor authentication is not set up for this account." };

  if (speakeasy.totp.verify({ secret, encoding: "base32", token: String(code), window: 1 })) {
    return { ok: true, usedBackupCode: false };
  }

  const raw = rows[0]?.totp_backup_codes;
  const codes = !raw ? [] : typeof raw === "string" ? JSON.parse(raw) : raw;
  for (let i = 0; i < codes.length; i++) {
    if (await bcrypt.compare(String(code), codes[i])) {
      codes.splice(i, 1);
      await pool.query("UPDATE users SET totp_backup_codes = ? WHERE id = ?", [
        JSON.stringify(codes),
        userId,
      ]);
      return { ok: true, usedBackupCode: true, backupCodesRemaining: codes.length };
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
    "UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, totp_enrolled_at = NULL WHERE id = ?",
    [userId]
  );
}

/** A readable temporary password for an onboarding or reset mail. */
export function generateTempPassword() {
  // Ambiguous characters are left out: these get read off a screen and typed,
  // and "was that a 1 or an l" turns a reset into a support call.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}
