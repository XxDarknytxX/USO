// src/services/invites.js
//
// Invitations: an account is created with no usable password, and the person
// sets their own through a one-time link.
//
// This is deliberately not "mail them a temporary password". A password in an
// inbox is a password that stays readable for as long as the mailbox exists,
// gets forwarded, and turns up in backups — and the account is reachable with
// it the whole time. A link that expires and dies on first use is reachable
// for as long as it takes someone to click it once.
//
// Only the SHA-256 of the token is stored. The token itself exists in the mail
// and nowhere else, so reading the database does not hand anyone a way in.
// SHA-256 rather than bcrypt on purpose: these are 32 random bytes, not a
// human-chosen secret, so there is nothing to slow an attacker down about —
// and the lookup has to find a user FROM the token, which a per-row salt
// makes impossible without scanning every account.

import crypto from "node:crypto";
import bcrypt from "bcryptjs";

/** How long an invite stays good. Long enough for someone on leave. */
export const INVITE_TTL_DAYS = 7;

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Mints an invite for a user and stores its hash. Returns the CLEAR token —
 * the only time it exists — for the caller to put in the mail.
 */
export async function issueInvite(pool, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `UPDATE users
        SET password_set_token = ?,
            password_set_expires = DATE_ADD(NOW(), INTERVAL ? DAY),
            invited_at = NOW()
      WHERE id = ?`,
    [hashToken(token), INVITE_TTL_DAYS, userId]
  );
  return token;
}

/**
 * A password nobody holds. Used as the stored hash for an invited account so
 * the NOT NULL column is satisfied without the account being reachable: every
 * password anyone could type fails against it.
 */
export async function unusablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}

/**
 * Looks up the account an invite belongs to. Returns null for a token that is
 * unknown, already used, or past its expiry — the caller must not distinguish
 * between those, or the endpoint becomes a way to ask whether a token existed.
 */
export async function findInvitee(pool, token) {
  if (!token || typeof token !== "string") return null;
  const [rows] = await pool.query(
    `SELECT id, email, name, role
       FROM users
      WHERE password_set_token = ?
        AND password_set_expires IS NOT NULL
        AND password_set_expires > NOW()
      LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

/**
 * Sets the password and consumes the invite in ONE statement, matched on the
 * token hash again. Two admins clicking the same link at once cannot both
 * succeed: the second UPDATE matches nothing, because the first cleared it.
 *
 * must_change_password is cleared as well — the whole point of this path is
 * that the password was chosen by the person who will use it, so there is
 * nothing to make them change on the way in.
 */
export async function consumeInvite(pool, token, newPassword) {
  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  const [res] = await pool.query(
    `UPDATE users
        SET password_hash = ?,
            must_change_password = 0,
            password_changed_at = NOW(),
            password_set_token = NULL,
            password_set_expires = NULL
      WHERE password_set_token = ?
        AND password_set_expires IS NOT NULL
        AND password_set_expires > NOW()`,
    [passwordHash, hashToken(token)]
  );
  return res.affectedRows === 1;
}

/** Drops a pending invite without touching the password. */
export async function revokeInvite(pool, userId) {
  await pool.query(
    "UPDATE users SET password_set_token = NULL, password_set_expires = NULL WHERE id = ?",
    [userId]
  );
}
