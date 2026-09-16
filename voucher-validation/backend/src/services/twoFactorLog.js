// src/services/twoFactorLog.js
//
// The audit trail for everything that touches a second factor.
//
// What it is for: a second factor that works leaves no trace of having worked,
// so without this the only 2FA events anyone can see are the ones that changed
// something visible. A slow guessing attempt spread over days, a reset nobody
// asked for, a code verified from an address on the other side of the world —
// all of it happens silently. The log is how those become answerable
// afterwards, which is the only time anyone thinks to ask.
//
// Two rules govern the whole file:
//
//   1. LOGGING NEVER FAILS A REQUEST. Every write is fire-and-forget with its
//      own catch. An audit trail that can 500 the login path is a new way to
//      lock everybody out, and "we could not write the log" is not a reason to
//      refuse somebody their console.
//
//   2. NOTHING SECRET GOES IN. Not the code, not the secret, not a backup
//      code, not a password. The log records THAT something happened and to
//      whom — a log holding the credential is a second copy of the credential,
//      in the table people are most likely to export.

/** The events worth a row. Anything not listed is rejected, so a typo at a
 *  call site shows up as a missing event rather than a new category of one. */
export const TWO_FACTOR_EVENTS = new Set([
  "enrol_started",      // a QR was issued
  "enrolled",           // a code proved it and the factor went live
  "verify_ok",          // a code accepted at sign-in
  "verify_failed",      // a code rejected at sign-in
  "backup_used",        // a backup code spent
  "backup_regenerated", // a fresh set issued
  "disabled",           // the owner turned it off
  "admin_reset",        // an administrator cleared someone else's
  "policy_on",          // the estate-wide requirement switched on
  "policy_off",         //   ... and off
  "throttled",          // too many attempts; the caller was refused outright
]);

const trim = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * Records one event. Deliberately returns nothing and never throws.
 *
 * @param pool        mysql2 pool
 * @param {object} e
 * @param {number}  [e.userId]     whose factor this concerns
 * @param {string}  [e.userEmail]  copied in so the row still names someone
 *                                 after the account is deleted
 * @param {string}   e.event       one of TWO_FACTOR_EVENTS
 * @param {boolean} [e.success]    default true
 * @param {object}  [e.actor]      req.user, when somebody did this TO someone
 *                                 else — an admin reset names both parties
 * @param {object}  [e.req]        for the address and the user agent
 * @param {string}  [e.detail]     short, non-secret, e.g. "3 codes left"
 */
export function logTwoFactorEvent(pool, e = {}) {
  const event = String(e.event || "");
  if (!TWO_FACTOR_EVENTS.has(event)) {
    console.error(`[2fa-log] refusing to record unknown event "${event}"`);
    return;
  }

  const req = e.req || {};
  const actor = e.actor || null;
  // Only when it was somebody ELSE. Naming yourself as the actor on your own
  // sign-in adds a column of noise to every row.
  const actorId = actor && Number(actor.id) !== Number(e.userId) ? actor.id : null;
  const actorEmail = actorId ? trim(actor.email, 255) : null;

  pool
    .query(
      `INSERT INTO two_factor_events
         (user_id, user_email, event, success, actor_id, actor_email, ip_address, user_agent, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.userId ?? null,
        trim(e.userEmail, 255),
        event,
        e.success === false ? 0 : 1,
        actorId,
        actorEmail,
        trim(req.ip || req.socket?.remoteAddress, 64),
        trim(req.headers?.["user-agent"], 512),
        trim(e.detail, 255),
      ]
    )
    .catch((err) => {
      // Rule 1. The console keeps working; the operator finds out here.
      console.error(`[2fa-log] could not record ${event}:`, err.message);
    });
}

/**
 * Reads the trail back, newest first.
 * `userId` narrows it to one account; omitting it is the estate-wide view and
 * is admin-only at the route.
 */
export async function readTwoFactorEvents(pool, { userId = null, limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const [rows] = userId
    ? await pool.query(
        `SELECT * FROM two_factor_events WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        [userId, n]
      )
    : await pool.query(`SELECT * FROM two_factor_events ORDER BY id DESC LIMIT ?`, [n]);

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    event: r.event,
    success: !!r.success,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    ip: r.ip_address,
    userAgent: r.user_agent,
    detail: r.detail,
    at: r.created_at,
  }));
}

/**
 * Drops rows older than `days`. Called on a timer from server.js.
 *
 * An audit table on the login path grows forever otherwise, and the value of a
 * row falls off a cliff once it is older than anyone's memory of the incident.
 * A year is long enough to answer "when did this start" about something noticed
 * late.
 */
export async function pruneTwoFactorEvents(pool, days = 365) {
  try {
    const [r] = await pool.query(
      "DELETE FROM two_factor_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [days]
    );
    if (r.affectedRows) console.log(`[2fa-log] pruned ${r.affectedRows} event(s) older than ${days} days`);
  } catch (e) {
    console.error("[2fa-log] prune failed:", e.message);
  }
}
