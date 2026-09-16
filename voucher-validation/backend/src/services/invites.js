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

/*
 * One-time password links, for two purposes:
 *
 *   invite — onboarding. "An account was made for you; choose a password."
 *            Does not touch any password the account already has.
 *   reset  — "Your password has been reset; choose a new one." The caller
 *            retires the current password once the email has gone.
 *
 * Neither ever puts a password in an email. A mailed password stays readable
 * for as long as the mailbox exists, gets forwarded and turns up in backups,
 * and the account can be entered with it the whole time. A link dies on first
 * use and within hours regardless.
 *
 * HOURS, not days. The link is the credential for as long as it lives, and a
 * week is a long time for a credential to sit in an inbox. Reset is shorter
 * than onboarding because the person asked for it (or an admin did, on their
 * behalf) and is expected to act now; onboarding may land while someone is off
 * shift. Both are configurable, and clamped so a typo cannot mint a link that
 * lives for a year.
 */
const hoursFromEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 72) : fallback;
};

export const LINK_HOURS = {
  invite: hoursFromEnv("ONBOARDING_LINK_HOURS", 8),
  reset: hoursFromEnv("PASSWORD_RESET_LINK_HOURS", 2),
};

const PURPOSES = new Set(Object.keys(LINK_HOURS));

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Mints a one-time link for a user and stores only its hash. Returns the CLEAR
 * token — the only time it exists — for the caller to put in the mail.
 *
 * One outstanding link per account: issuing a new one overwrites the stored
 * hash, so any earlier link — of either purpose — dies at that moment.
 */
export async function issuePasswordLink(pool, userId, purpose) {
  if (!PURPOSES.has(purpose)) throw new Error(`Unknown password link purpose "${purpose}"`);
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `UPDATE users
        SET password_set_token = ?,
            password_set_expires = DATE_ADD(NOW(), INTERVAL ? HOUR),
            password_set_purpose = ?,
            invited_at = IF(? = 'invite', NOW(), invited_at)
      WHERE id = ?`,
    [hashToken(token), LINK_HOURS[purpose], purpose, purpose, userId]
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
    `SELECT id, email, name, role, password_set_purpose AS purpose
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
            password_set_expires = NULL,
            password_set_purpose = NULL
      WHERE password_set_token = ?
        AND password_set_expires IS NOT NULL
        AND password_set_expires > NOW()`,
    [passwordHash, hashToken(token)]
  );
  return res.affectedRows === 1;
}

/**
 * Discards ONE specific link — the one this caller issued — and nothing newer.
 *
 * Used when the email carrying a link could not be sent. Matching on the hash
 * rather than the user id matters: if a second link was issued for the same
 * account in the meantime, a plain "clear this user's link" would kill the one
 * that DID get delivered.
 */
export async function discardPasswordLink(pool, userId, token) {
  await pool.query(
    `UPDATE users
        SET password_set_token = NULL, password_set_expires = NULL, password_set_purpose = NULL
      WHERE id = ? AND password_set_token = ?`,
    [userId, hashToken(token)]
  );
}

/** Drops a pending invite without touching the password. */
export async function revokeInvite(pool, userId) {
  await pool.query(
    "UPDATE users SET password_set_token = NULL, password_set_expires = NULL, password_set_purpose = NULL WHERE id = ?",
    [userId]
  );
}
