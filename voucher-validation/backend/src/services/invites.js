// src/services/invites.js
//
// One-time password links: onboarding ("an account was made for you; choose a
// password") and reset ("your password was reset; choose a new one").
//
// Never a password in an email. A mailed password stays readable for as long as
// the mailbox exists, gets forwarded, turns up in backups, and opens the account
// the whole time. A link dies on first use and within hours regardless.
//
// Only the SHA-256 of a token is stored; the token exists in the mail and
// nowhere else, so reading the database hands nobody a way in. SHA-256 rather
// than bcrypt on purpose: these are 32 random bytes, not a human-chosen secret,
// so there is nothing for a work factor to slow down — and the lookup must find
// the account FROM the token, which a per-row salt would make a full scan.
//
// ── Send, THEN store ─────────────────────────────────────────────────────
// A token is minted in memory, emailed, and only stored once the mail server
// has accepted it. The obvious order — store, then send — has a bad failure:
// storing overwrites whatever link the account already had, so a resend that
// fails to send has already destroyed the link that DID arrive, and discarding
// the new one afterwards leaves the account with no working link at all.
// Stored after sending, a failed send changes nothing.
//
// The cost is a window of milliseconds between the mail being accepted and the
// link becoming valid. Nobody receives, opens and submits an email that fast.

import crypto from "node:crypto";
import bcrypt from "bcryptjs";

/*
 * HOURS, not days: the link is the credential for as long as it lives. Reset is
 * shorter than onboarding because it is acted on now; onboarding may land while
 * someone is off shift. Configurable, clamped so a typo cannot mint a link that
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

/** A fresh token, in memory only. Nothing is written until storePasswordLink. */
export function mintToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Makes a minted token live for a user. Call only AFTER its email was accepted.
 *
 * One outstanding link per account: this overwrites the stored hash, so any
 * earlier link — of either purpose — stops working at this moment.
 */
export async function storePasswordLink(pool, userId, purpose, token) {
  if (!PURPOSES.has(purpose)) throw new Error(`Unknown password link purpose "${purpose}"`);
  await pool.query(
    `UPDATE users
        SET password_set_token = ?,
            password_set_expires = DATE_ADD(NOW(), INTERVAL ? HOUR),
            password_set_purpose = ?,
            invited_at = IF(? = 'invite', NOW(), invited_at)
      WHERE id = ?`,
    [hashToken(token), LINK_HOURS[purpose], purpose, purpose, userId]
  );
}

/**
 * A password nobody holds. Stored for an account that must not be enterable
 * until its owner uses a link: invited and never set up, or reset and not yet
 * recovered. Every password anyone could type fails against it.
 */
export async function unusablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}

/**
 * The account a live token belongs to, or null. Unknown, spent and expired all
 * return null — callers must not tell them apart, or the endpoint becomes a way
 * to ask whether a token existed.
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
 * Sets the password and burns the token. Returns the account on success, or
 * null when the token is not live.
 *
 * The token is checked BEFORE the password is hashed. This route is
 * unauthenticated, and bcrypt is deliberately slow, so hashing first meant any
 * anonymous caller could buy a full bcrypt of server CPU per request by posting
 * garbage. A bad token now costs one indexed SELECT.
 *
 * The write is still conditional on the token itself, so two tabs submitting
 * the same link cannot both win: the second UPDATE matches nothing.
 *
 * password_retired_at is cleared — the account has a password its owner chose —
 * and must_change_password is cleared for the same reason.
 */
export async function consumeInvite(pool, token, newPassword) {
  const account = await findInvitee(pool, token);
  if (!account) return null;

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  const [res] = await pool.query(
    `UPDATE users
        SET password_hash = ?,
            must_change_password = 0,
            password_changed_at = NOW(),
            password_retired_at = NULL,
            password_set_token = NULL,
            password_set_expires = NULL,
            password_set_purpose = NULL
      WHERE password_set_token = ?
        AND password_set_expires IS NOT NULL
        AND password_set_expires > NOW()`,
    [passwordHash, hashToken(token)]
  );
  return res.affectedRows === 1 ? account : null;
}

/**
 * Cancels whatever link is outstanding, without touching the password.
 * Used when the thing the link was sent FOR has changed — the address it went
 * to, or the password it would replace.
 */
export async function revokeInvite(pool, userId) {
  await pool.query(
    "UPDATE users SET password_set_token = NULL, password_set_expires = NULL, password_set_purpose = NULL WHERE id = ?",
    [userId]
  );
}
