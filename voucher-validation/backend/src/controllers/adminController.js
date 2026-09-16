// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  isTwoFactorRequired, setTwoFactorRequired, beginEnrolment, verifyEnrolment,
  verifyCode, clearTwoFactor, regenerateBackupCodes,
} from "../services/twoFactor.js";
import {
  loadSmtpTransport, buildPasswordResetLink, buildTwoFactorReset, buildInvite,
} from "../services/mailer.js";
import {
  mintToken, storePasswordLink, consumeInvite, findInvitee, revokeInvite, unusablePasswordHash, LINK_HOURS,
} from "../services/invites.js";
import { makeAttemptLimiter, clientIp, pause } from "../services/attemptLimiter.js";
import { logTwoFactorEvent, readTwoFactorEvents } from "../services/twoFactorLog.js";
import { passwordProblem } from "../services/passwordPolicy.js";
import { validationResult } from "express-validator";

/** Local response helpers */
const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  unauthorized: (res, msg = "Unauthorized") => res.status(401).json({ error: msg }),
  forbidden: (res, msg = "Forbidden") => res.status(403).json({ error: msg }),
  // Was missing while four handlers already called it — every one of them threw
  // a TypeError into its own catch and answered 500 for a plain "no such user".
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

/**
 * A bcrypt hash of nothing anyone knows, compared against when the email is
 * unrecognised. Without it an unknown address returns in microseconds while a
 * known one costs a full bcrypt — which answers "is this person a user here"
 * to anyone with a stopwatch. Computed once at module load.
 */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);

/** How long a full session lasts. One place, so the three mint sites agree. */
const SESSION_TTL = "2h";

/**
 * Mints a full session AND records that the person signed in.
 *
 * These were two separate facts at three different call sites, and one of them
 * forgot the second: completing two-factor ENROLMENT hands back a real session,
 * but never wrote last_login_at — so anyone who signed in for the first time
 * under a policy that required enrolment was listed as "Never signed in" while
 * being signed in. Both facts now happen in one function, because there is no
 * such thing as issuing a session that is not a sign-in.
 *
 * The write is best-effort: a bookkeeping column must never be the reason
 * somebody is refused their console.
 */
async function issueSession(pool, claims) {
  await pool
    .query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [claims.id])
    .catch((e) => console.error("[auth] could not record sign-in:", e.message));
  return jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: SESSION_TTL });
}

/** Thin data-access helpers */
/**
 * The row the LOGIN path needs — every column it branches on, not just the ones
 * that identify the account.
 *
 * totp_enabled and must_change_password were missing here while login read
 * both. A column you did not select comes back `undefined`, which is falsy, so
 * there was no error to notice: `if (user.totp_enabled)` simply never fired,
 * every enrolled account was told to enrol again at its next sign-in, and no
 * temporary password was ever forced to be changed.
 *
 * If you add a branch to login, add its column here.
 */
async function findUserByEmail(pool, email) {
  const [rows] = await pool.query(
    `SELECT id, email, password_hash, name, role, totp_enabled, must_change_password
       FROM users WHERE email = ?`,
    [email]
  );
  return rows[0] || null;
}

// The only roles that may ever be written. Anything else falls back to the
// least-privileged one, so an unrecognised value can never grant access.
const ROLES = new Set(["admin", "viewer", "engineer"]);
export function safeRoleOf(role) {
  return ROLES.has(role) ? role : "viewer";
}

// Roles limited to a subset of the estate. WHICH villages is not a per-account
// question: it is the estate default under Settings, read by attachScope. Must
// agree with SCOPED_ROLES in middleware/auth.js.
const SCOPED_ROLES = new Set(["viewer", "engineer"]);
const ROLE_LABELS = { admin: "administrator", viewer: "viewer", engineer: "field engineer" };


async function insertUser(pool, { email, passwordHash, name, role }) {
  // Whitelist the role — never trust an arbitrary value into the privileged
  // column.
  const safeRole = safeRoleOf(role);
  const [res] = await pool.query(
    "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
    [email, passwordHash, name || null, safeRole]
  );
  return { id: res.insertId, email, name, role: safeRole };
}

/** Factory */
/**
 * Sends one account email and REPORTS whether it went, rather than throwing.
 * The database change has already happened by this point; failing the whole
 * request because SMTP is down would leave the caller thinking nothing
 * happened when the password has in fact already changed.
 */
async function sendAccountMail(pool, user, kind, { linkToken } = {}) {
  try {
    const smtp = await loadSmtpTransport(pool);
    if (!smtp) return { sent: false, error: "SMTP is not configured in Settings" };
    // Falls back to the live console rather than to prose: a welcome mail whose
    // "sign in at" line reads "the operations console" is a mail that cannot be
    // acted on. CONSOLE_URL overrides it for staging.
    const url = process.env.CONSOLE_URL || process.env.APP_URL || "https://admin.vodafonefiji.cloud";
    const args = { name: user.name, email: user.email, url };
    // Both password emails carry a one-time link to the same page. No kind
    // puts a password in the message any more — there is nothing left for one.
    // In the FRAGMENT, not the query string. A fragment never reaches the
    // server, so the credential is not written to the web server's access log
    // for every link opened, and cannot ride out in a Referer header.
    const link = linkToken
      ? `${url.replace(/\/+$/, "")}/set-password#token=${encodeURIComponent(linkToken)}`
      : null;
    const mail =
      kind === "invite" ? buildInvite({
        ...args, link,
        roleLabel: ROLE_LABELS[user.role] || null,
        expiresHours: LINK_HOURS.invite,
      })
      : kind === "reset" ? buildPasswordResetLink({ ...args, link, expiresHours: LINK_HOURS.reset })
      : buildTwoFactorReset(args);
    if ((kind === "invite" || kind === "reset") && !link) {
      throw new Error(`a ${kind} email needs a link token`);
    }
    await smtp.transport.sendMail({
      from: smtp.from, to: user.email,
      subject: mail.subject, text: mail.text, html: mail.html,
    });
    return { sent: true, error: null };
  } catch (e) {
    console.error(`[users] ${kind} mail failed:`, e.message);
    return { sent: false, error: e.message };
  }
}

// Guessing at credentials is throttled per (ip, account) with a slower
// per-account backstop. Shared across the password step and both code steps on
// purpose: an attacker who is being slowed down at one of them must not be able
// to switch to another and start again with a fresh allowance.
const limiter = makeAttemptLimiter();

/**
 * Answers one failed attempt: records it, waits out any distributed-guessing
 * penalty, and reports whether this caller is now cut off entirely. Returning
 * the 429 is the caller's job, so the message stays specific to the endpoint.
 */
async function penalise(ip, acct) {
  const { blockedFor, delayMs } = limiter.fail(ip, acct);
  await pause(delayMs);
  return blockedFor;
}

const tooMany = (res, seconds) => {
  res.setHeader("Retry-After", String(seconds));
  return res.status(429).json({
    error: `Too many attempts. Try again in ${seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`,
  });
};

/**
 * Emails a one-time password link, and makes it live only once the mail server
 * has accepted it. Returns { sent, error }.
 *
 * On a failed send NOTHING is written. That is the whole point of the order: a
 * resend that stored first would already have overwritten the link that DID
 * arrive, so a transient SMTP error cost the person the working link in their
 * inbox and left the account with none.
 */
async function sendPasswordLink(pool, user, purpose) {
  const token = mintToken();
  const mail = await sendAccountMail(pool, user, purpose, { linkToken: token });
  if (!mail.sent) return { sent: false, error: mail.error };
  await storePasswordLink(pool, user.id, purpose, token);
  return { sent: true, error: null };
}

export function makeAdminController(pool) {
  return {
    // POST /api/register (admin-only — see routes/auth.js). NEVER trusts a
    // client-supplied role: registration can only ever create a "viewer".
    // Role assignment (incl. admins) is done through the admin Users flow
    // (POST /api/users -> createUser), which is route-validated. Forcing viewer
    // here means even if this route's guard were ever loosened, it could not
    // mint an admin.
    register: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, password, name } = req.body;
      try {
        const existing = await findUserByEmail(pool, email);
        if (existing) return send.bad(res, "Email already registered");

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await insertUser(pool, { email, passwordHash, name, role: "viewer" });
        return send.created(res, { id: user.id, email: user.email, role: user.role });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/login
    login: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, password } = req.body;
      const ip = clientIp(req);
      const acct = String(email || "").toLowerCase();
      try {
        // Only the per-(ip, account) block refuses up front. The per-account
        // counter must never be able to stop a correct password — that is how
        // a throttle becomes a way to lock somebody out of their own console.
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);

        const user = await findUserByEmail(pool, email);
        // An unknown address takes the same work and the same wait as a known
        // one, so response time does not answer "does this account exist".
        const hash = user ? user.password_hash : DUMMY_HASH;
        const ok = await bcrypt.compare(String(password || ""), hash);

        if (!user || !ok) {
          const blockedFor = await penalise(ip, acct);
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, "Invalid credentials");
        }
        // The password was right. The code steps below keep their own count,
        // so clearing here cannot hand anyone a fresh allowance at those.
        limiter.succeed(ip, acct);

        const claims = { id: user.id, email: user.email, name: user.name, role: user.role };

        // ── Two-factor ────────────────────────────────────────────────────
        // Three outcomes, and which one you get never depends on anything the
        // caller sent — only on this account's state and the estate policy.
        if (user.totp_enabled) {
          // Enrolled: hand back a token that can do exactly one thing.
          const tempToken = jwt.sign({ ...claims, pending2FA: true }, process.env.JWT_SECRET, {
            expiresIn: "5m",
          });
          return send.ok(res, { requires2FA: true, tempToken });
        }

        if (await isTwoFactorRequired(pool)) {
          // Policy says everyone must have it and this account does not yet.
          // A setup token reaches the enrolment endpoints and nothing else, so
          // nobody browses the console while deciding whether to comply.
          const setupToken = jwt.sign({ ...claims, pending2FASetup: true }, process.env.JWT_SECRET, {
            expiresIn: "15m",
          });
          return send.ok(res, { requires2FASetup: true, token: setupToken });
        }

        const token = await issueSession(pool, claims);
        // mustChangePassword travels with the token so the SPA can force the
        // change immediately after an onboarding or reset mail.
        return send.ok(res, { token, mustChangePassword: !!user.must_change_password });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    /* ═══════════ ADMIN RESCUE: password / 2FA / onboarding ═══════════ */

    // POST /api/users/:id/reset-password  (admin)
    //
    // Emails a one-time link to choose a new password, then retires the current
    // one. Not a new password: a mailed password stays readable for as long as
    // the mailbox exists, and opens the account the whole time.
    //
    // Three rules, each from a way this went wrong:
    //
    //  • Not on your OWN account. The mail server accepting a message is not the
    //    message arriving — a stale address, a quarantine, a silent drop — and
    //    the old password is gone either way. Resetting yourself that way can
    //    leave the console with no administrator able to sign in. Your own
    //    password changes from Profile, which asks for the current one.
    //
    //  • Link first, retire second. If the email fails nothing changes: the old
    //    password still works and no link is stored.
    //
    //  • Retire only if the password has not changed since this reset began.
    //    Guarding on "our link is still outstanding" was not enough: a second
    //    link issued meanwhile replaces ours, the guard then matched nothing, and
    //    the admin was told the old password was dead while it still worked.
    //    Guarding on the change time instead covers every case — the person used
    //    the link, another admin set a password, a newer link was used — and a
    //    newer link merely SENT does not stop the retire, which is what the
    //    admin asked for.
    resetUserPassword: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT id, email, name, role FROM users WHERE id = ?", [req.params.id]);
        const user = rows[0];
        if (!user) return send.notFound(res, "User not found");

        if (Number(user.id) === Number(req.user.id)) {
          return send.bad(
            res,
            "To change your own password, use Profile → Security. A reset link sent to yourself retires your password before you know the email arrived."
          );
        }

        // The database's clock, as text, so the comparison below never passes
        // through a JavaScript Date and a timezone conversion.
        const [[{ startedAt }]] = await pool.query(
          "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS startedAt"
        );

        const r = await sendPasswordLink(pool, user, "reset");
        if (!r.sent) {
          return send.ok(res, { success: false, emailed: false, emailError: r.error, changed: false });
        }

        const [retire] = await pool.query(
          `UPDATE users
              SET password_hash = ?, must_change_password = 0,
                  password_changed_at = NOW(), password_retired_at = NOW()
            WHERE id = ?
              AND (password_changed_at IS NULL OR password_changed_at < ?)`,
          [await unusablePasswordHash(), user.id, startedAt]
        );
        const retired = retire.affectedRows === 1;

        logTwoFactorEvent(pool, {
          userId: user.id, userEmail: user.email, actor: req.user, req, event: "reset_sent",
          detail: retired ? `valid ${LINK_HOURS.reset}h, old password retired` : `valid ${LINK_HOURS.reset}h, password had just changed`,
        });
        return send.ok(res, { success: true, emailed: true, retired, expiresHours: LINK_HOURS.reset });
      } catch (e) {
        console.error("[users] password reset failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/users/:id/reset-2fa  (admin)
    // The lost-phone path. Clears the secret and every backup code, so the next
    // sign-in enrols afresh. Mailed because someone silently losing their second
    // factor should be told, in case it was not them who asked.
    resetUserTwoFactor: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT id, email, name, totp_enabled FROM users WHERE id = ?", [req.params.id]);
        const user = rows[0];
        if (!user) return send.notFound(res, "User not found");

        // Resetting your OWN second factor with nothing but the session token
        // is a way around /2fa/disable, which asks for the password and refuses
        // outright while the estate policy requires 2FA. A borrowed session
        // could otherwise strip the factor protecting the account it came from.
        // This endpoint is for helping SOMEONE ELSE who lost their phone; your
        // own goes through the path that asks who you are.
        if (Number(user.id) === Number(req.user.id)) {
          return send.bad(
            res,
            "Use Profile → Security to change two-factor on your own account — it asks for your password."
          );
        }

        await clearTwoFactor(pool, user.id);
        // Names both parties: whose factor was cleared, and who cleared it.
        logTwoFactorEvent(pool, {
          userId: user.id, userEmail: user.email, actor: req.user, req,
          event: "admin_reset",
          detail: user.totp_enabled ? "was enrolled" : "was not enrolled",
        });
        const mail = await sendAccountMail(pool, user, "2fa-reset", {});
        return send.ok(res, { success: true, wasEnabled: !!user.totp_enabled, emailed: mail.sent, emailError: mail.error });
      } catch (e) {
        console.error("[users] 2FA reset failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/users/:id/invite           (admin)
    // POST /api/users/:id/resend-onboarding (admin)
    //
    // Emails a one-time link to set a password. Both routes are this handler:
    // "resend the invite" and "resend onboarding" used to differ only in that
    // the second mailed a temporary password, and there is no longer any such
    // thing to mail.
    //
    // Unlike a reset, this does NOT retire an existing password. Onboarding is
    // "here is how to get in", not "your way in has been taken away" — for an
    // account that has never set one, there is nothing to retire anyway.
    // Issuing it does kill any earlier link, of either kind.
    resendInvite: async (req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT id, email, name, role FROM users WHERE id = ?",
          [req.params.id]
        );
        const user = rows[0];
        if (!user) return send.notFound(res, "User not found");

        const r = await sendPasswordLink(pool, user, "invite");
        if (r.sent) {
          logTwoFactorEvent(pool, {
            userId: user.id, userEmail: user.email, actor: req.user, req, event: "onboarding_sent",
            detail: `valid ${LINK_HOURS.invite}h`,
          });
        }
        return send.ok(res, {
          success: r.sent,
          emailed: r.sent,
          emailError: r.error,
          expiresHours: LINK_HOURS.invite,
        });
      } catch (e) {
        console.error("[users] onboarding link failed:", e.message);
        return send.serverErr(res);
      }
    },

    // DELETE /api/users/:id/invite  (admin)
    // Cancels a pending invite. The account stays, with a password nobody
    // holds — which is the right state for "I invited the wrong person".
    revokeInvite: async (req, res) => {
      try {
        await revokeInvite(pool, Number(req.params.id));
        return send.ok(res, { success: true });
      } catch (e) {
        console.error("[users] invite revoke failed:", e.message);
        return send.serverErr(res);
      }
    },

    /* ── The invite link itself — UNAUTHENTICATED by design ────────────────
       Whoever follows the link has no account yet, so there is nothing to
       authenticate with. The token IS the credential and is verified inside
       these two handlers.

       Neither one says whether a token ever existed. "Expired", "already
       used" and "never real" all come back the same, because distinguishing
       them turns the endpoint into a way to ask questions about accounts. */

    // POST /api/invite/check  — what the set-password page greets you with.
    checkInvite: async (req, res) => {
      try {
        const user = await findInvitee(pool, req.body?.token);
        if (!user) return send.bad(res, "This link is no longer valid. Ask your administrator to send a new one.");
        return send.ok(res, {
          valid: true,
          email: user.email,
          name: user.name || null,
          purpose: user.purpose === "reset" ? "reset" : "invite",
        });
      } catch (e) {
        console.error("[invite] check failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/invite/accept — set the password and burn the token.
    acceptInvite: async (req, res) => {
      const { token, password } = req.body || {};
      // The same rules the page shows, decided here. Enforced only in the
      // browser they were suggestions: anyone posting directly, or any page
      // that forgot to copy them, could set a password the page would refuse.
      const problem = passwordProblem(password);
      if (problem) return send.bad(res, problem);

      // Unauthenticated, so throttled per address on failures. A token is 256
      // bits and not guessable; this is about not letting an anonymous caller
      // spend server time without limit.
      const ip = clientIp(req);
      const acct = "invite-accept";
      try {
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);

        const account = await consumeInvite(pool, token, password);
        if (!account) {
          const blockedFor = await penalise(ip, acct);
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, "This link is no longer valid. Ask your administrator to send a new one.");
        }
        limiter.succeed(ip, acct);

        logTwoFactorEvent(pool, {
          userId: account.id, userEmail: account.email, req,
          event: account.purpose === "reset" ? "reset_used" : "onboarding_used",
        });
        // Deliberately does NOT return a session. Signing in straight after is
        // one extra step and it is the step that proves the password works —
        // and it routes through the 2FA policy instead of duplicating it here.
        return send.ok(res, { success: true });
      } catch (e) {
        console.error("[invite] accept failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/me/password — change your own password.
    changeOwnPassword: async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || String(newPassword).length < 8) {
        return send.bad(res, "Choose a password of at least 8 characters");
      }
      // This checks the current password against the same hash that disable2FA
      // and the backup-code endpoint check, so it is the same guessing oracle
      // and needs the same brake. Unthrottled, a stolen 2-hour token could be
      // ground into the password itself — and with the password, the second
      // factor comes off.
      const ip = clientIp(req);
      const acct = `pw:${req.user.id}`;
      try {
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);
        const [rows] = await pool.query(
          "SELECT password_hash, must_change_password FROM users WHERE id = ?",
          [req.user.id]
        );
        if (!rows[0]) return send.notFound(res, "User not found");
        // The current password is required EXCEPT when the account is on a
        // temporary one it was told to change — that person has already proved
        // they hold it by signing in, and asking again just re-types the
        // credential from the email.
        if (!rows[0].must_change_password) {
          if (!currentPassword || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
            const blockedFor = await penalise(ip, acct);
            if (blockedFor) return tooMany(res, blockedFor);
            return send.bad(res, "Your current password is not right");
          }
          limiter.succeed(ip, acct);
        }
        await pool.query(
          "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW() WHERE id = ?",
          [await bcrypt.hash(String(newPassword), 10), req.user.id]
        );
        return send.ok(res, { success: true });
      } catch (e) {
        console.error("[users] password change failed:", e.message);
        return send.serverErr(res);
      }
    },

    /* ═══════════════════ TWO-FACTOR AUTHENTICATION ═══════════════════ */

    // POST /api/2fa/login-verify — exchange a pending2FA token for a real one.
    loginVerify2FA: async (req, res) => {
      const { tempToken, code } = req.body || {};
      if (!tempToken || !code) return send.bad(res, "Token and code are required");
      try {
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        // Only a token minted for this exact purpose. A full token arriving
        // here would otherwise let anyone with a session mint another.
        if (!decoded.pending2FA) return send.bad(res, "Invalid session token");

        // THE step that has to be throttled. Six digits is 10^6, three of them
        // are valid at any instant, and the token that lets you try lives five
        // minutes — unthrottled, someone holding the password walks in.
        // Keyed on the account from the TOKEN, which the caller cannot forge.
        const ip = clientIp(req);
        const acct = `2fa:${decoded.id}`;
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);

        const r = await verifyCode(pool, decoded.id, code);
        if (!r.ok) {
          const blockedFor = await penalise(ip, acct);
          logTwoFactorEvent(pool, {
            userId: decoded.id, userEmail: decoded.email, req,
            event: blockedFor ? "throttled" : "verify_failed", success: false,
            detail: blockedFor ? `refused for ${blockedFor}s` : null,
          });
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, r.error || "That code is not right.");
        }
        limiter.succeed(ip, acct);
        logTwoFactorEvent(pool, {
          userId: decoded.id, userEmail: decoded.email, req,
          event: r.usedBackupCode ? "backup_used" : "verify_ok",
          detail: r.usedBackupCode ? `${r.backupCodesRemaining} backup code(s) left` : null,
        });

        const { pending2FA, iat, exp, ...claims } = decoded;
        const [rows] = await pool.query("SELECT must_change_password FROM users WHERE id = ?", [decoded.id]);
        return send.ok(res, {
          token: await issueSession(pool, claims),
          mustChangePassword: !!rows[0]?.must_change_password,
          usedBackupCode: !!r.usedBackupCode,
          // Surfaced so someone burning through their codes is told before the
          // last one is gone, rather than after.
          backupCodesRemaining: r.backupCodesRemaining,
        });
      } catch {
        return send.bad(res, "That sign-in attempt expired. Enter your password again.");
      }
    },

    // POST /api/2fa/setup — secret + QR. Does NOT enable anything yet.
    setup2FA: async (req, res) => {
      try {
        const setup = await beginEnrolment(pool, req.user);
        logTwoFactorEvent(pool, {
          userId: req.user.id, userEmail: req.user.email, req, event: "enrol_started",
        });
        return send.ok(res, setup);
      } catch (e) {
        // "Already on" is the caller's situation, not a server fault — say so
        // rather than answering 500 to something the person can act on.
        if (e.code === "ALREADY_ENROLLED") return send.bad(res, e.message);
        console.error("[2fa] setup failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/2fa/verify — confirm enrolment, switch it on, return the backup
    // codes. They are shown exactly once; only hashes are kept.
    verify2FA: async (req, res) => {
      const { code } = req.body || {};
      if (!code) return send.bad(res, "Enter the code from your authenticator app");
      const ip = clientIp(req);
      const acct = `enrol:${req.user.id}`;
      try {
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);
        const r = await verifyEnrolment(pool, req.user.id, code);
        if (!r.ok) {
          const blockedFor = await penalise(ip, acct);
          logTwoFactorEvent(pool, {
            userId: req.user.id, userEmail: req.user.email, req,
            event: blockedFor ? "throttled" : "verify_failed", success: false,
            detail: blockedFor ? `refused for ${blockedFor}s` : "during enrolment",
          });
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, r.error);
        }
        limiter.succeed(ip, acct);
        logTwoFactorEvent(pool, {
          userId: req.user.id, userEmail: req.user.email, req, event: "enrolled",
        });
        const { pending2FASetup, iat, exp, ...claims } = req.user;
        // A setup token brought them here; hand back a real one so enrolling
        // lands them in the app rather than back at the login screen.
        return send.ok(res, {
          enabled: true,
          backupCodes: r.backupCodes,
          token: await issueSession(pool, claims),
        });
      } catch (e) {
        console.error("[2fa] verify failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/2fa/disable — turn it off for yourself. Requires the current
    // password: a walk-up to an unlocked screen should not be able to strip the
    // second factor off the account.
    disable2FA: async (req, res) => {
      const { password } = req.body || {};
      // Turning the second factor OFF is a password guess like any other, and
      // it is reachable from a session someone walked away from.
      const ip = clientIp(req);
      const acct = `disable:${req.user.id}`;
      try {
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);
        if (await isTwoFactorRequired(pool)) {
          return send.bad(res, "Two-factor authentication is required for every account and cannot be turned off.");
        }
        const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
        if (!rows[0]) return send.notFound(res, "User not found");
        if (!password || !(await bcrypt.compare(password, rows[0].password_hash))) {
          const blockedFor = await penalise(ip, acct);
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, "Enter your current password to turn two-factor off.");
        }
        limiter.succeed(ip, acct);
        await clearTwoFactor(pool, req.user.id);
        logTwoFactorEvent(pool, {
          userId: req.user.id, userEmail: req.user.email, req, event: "disabled",
        });
        return send.ok(res, { enabled: false });
      } catch (e) {
        console.error("[2fa] disable failed:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/2fa/status — what this account and the estate require.
    twoFactorStatus: async (req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT totp_enabled, totp_enrolled_at, totp_backup_codes FROM users WHERE id = ?",
          [req.user.id]
        );
        const raw = rows[0]?.totp_backup_codes;
        const codes = !raw ? [] : typeof raw === "string" ? JSON.parse(raw) : raw;
        return send.ok(res, {
          enabled: !!rows[0]?.totp_enabled,
          enrolledAt: rows[0]?.totp_enrolled_at || null,
          backupCodesRemaining: codes.length,
          requiredEstateWide: await isTwoFactorRequired(pool),
        });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/2fa/backup-codes — a fresh set of ten, shown once.
    //
    // Needs the password, like disabling does: this invalidates every code the
    // account currently holds, so a session left unattended must not be enough
    // to strand somebody's only way back in.
    regenerateBackupCodes: async (req, res) => {
      const { password } = req.body || {};
      const ip = clientIp(req);
      const acct = `backup:${req.user.id}`;
      try {
        const wait = limiter.retryAfter(ip, acct);
        if (wait) return tooMany(res, wait);

        const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
        if (!rows[0]) return send.notFound(res, "User not found");
        if (!password || !(await bcrypt.compare(password, rows[0].password_hash))) {
          const blockedFor = await penalise(ip, acct);
          if (blockedFor) return tooMany(res, blockedFor);
          return send.bad(res, "Enter your current password to replace your backup codes.");
        }
        limiter.succeed(ip, acct);

        const r = await regenerateBackupCodes(pool, req.user.id);
        if (!r.ok) return send.bad(res, r.error);
        logTwoFactorEvent(pool, {
          userId: req.user.id, userEmail: req.user.email, req, event: "backup_regenerated",
        });
        return send.ok(res, { backupCodes: r.backupCodes });
      } catch (e) {
        console.error("[2fa] backup code regeneration failed:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/2fa/events — the audit trail.
    //
    // An admin gets the estate-wide view; anybody else gets their own account
    // and only their own. That second case is not a courtesy: the person best
    // placed to notice "I did not do that" is the account holder, and they
    // cannot notice it if they cannot see it.
    twoFactorEvents: async (req, res) => {
      try {
        const mine = req.user.role !== "admin";
        const events = await readTwoFactorEvents(pool, {
          userId: mine ? req.user.id : req.query.userId ? Number(req.query.userId) : null,
          limit: req.query.limit,
        });
        return send.ok(res, { events, scope: mine ? "self" : "estate" });
      } catch (e) {
        console.error("[2fa] event read failed:", e.message);
        return send.serverErr(res);
      }
    },

    // GET/PUT /api/2fa/policy  (admin) — the estate-wide switch.
    getTwoFactorPolicy: async (_req, res) => {
      try {
        const [[c]] = await pool.query(
          "SELECT COUNT(*) AS total, SUM(totp_enabled = 1) AS enrolled FROM users"
        );
        return send.ok(res, {
          required: await isTwoFactorRequired(pool),
          users: Number(c.total || 0),
          enrolled: Number(c.enrolled || 0),
        });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    setTwoFactorPolicy: async (req, res) => {
      try {
        const on = req.body?.required === true || req.body?.required === "true";
        // Turning it ON does not enrol anyone or lock anyone out: accounts
        // without 2FA get a setup token at their next login and enrol then.
        // Existing sessions keep working until they expire, which is the
        // difference between a policy change and an outage.
        await setTwoFactorRequired(pool, on);
        // An estate-wide switch is the single most consequential 2FA action
        // there is, and the one most worth being able to attribute later.
        logTwoFactorEvent(pool, {
          userId: req.user.id, userEmail: req.user.email, req,
          event: on ? "policy_on" : "policy_off",
        });
        return send.ok(res, { required: on });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/me — current user + (for viewers) their assigned villages, so the
    // SPA can seed its scope and drive the viewer-only UI.
    me: async (req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT id, email, name, role FROM users WHERE id = ?",
          [req.user.id]
        );
        const user = rows[0];
        if (!user) return send.unauthorized(res, "User not found");
        // What a scoped account may see is the estate default — the same
        // single setting attachScope reads — not a per-account list. Resolved
        // through the same middleware so the two can never disagree.
        let villages = [];
        if (SCOPED_ROLES.has(user.role) && Array.isArray(req.scope?.projectIds)) {
          const ids = req.scope.projectIds;
          if (ids.length) {
            const [vrows] = await pool.query(
              `SELECT id, name, hostname, ruijie_group_id FROM network_projects
                WHERE id IN (${ids.map(() => "?").join(",")})
                ORDER BY sort_order, name`,
              ids
            );
            villages = vrows.map((r) => ({
              id: r.id, name: r.name, hostname: r.hostname, ruijieGroupId: r.ruijie_group_id,
            }));
          }
        }
        return send.ok(res, { user: { ...user, villages } });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/me/preferences — per-user UI prefs (village display filter, active
    // scope). Stored server-side so a user's settings sync across their devices
    // instead of living in one browser's localStorage.
    // GET /api/me/preferences
    //
    // Returns the caller's own preferences AND the estate default for the
    // "All Villages" set. Two settings, deliberately:
    //
    //   globalVisibleSiteIds — set by an admin under Settings, applies to
    //     everyone who has not chosen their own. This is where a test village
    //     gets excluded once, for the whole console.
    //
    //   prefs.visibleSiteIds — this account's own choice, which overrides the
    //     default for them alone. An admin can tick a test village back on to
    //     look at it without putting it in front of anybody else.
    //
    // The default is served from HERE rather than from GET /api/settings
    // because that route is admin-only and every role needs to know what the
    // default is. It is a list of village ids, which tells the caller nothing
    // they could not learn from the village list they already receive.
    getPreferences: async (req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT prefs FROM user_preferences WHERE user_id = ?",
          [req.user.id]
        );
        let prefs = {};
        if (rows.length && rows[0].prefs) {
          prefs = typeof rows[0].prefs === "string" ? JSON.parse(rows[0].prefs) : rows[0].prefs;
        }

        // null (or an unreadable value) means "no default set" — every village.
        // A stored default that will not parse is treated the same way rather
        // than throwing: a corrupt setting should widen the view, not break the
        // console for everyone at once.
        let globalVisibleSiteIds = null;
        try {
          const [[row]] = await pool.query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'global_visible_villages'"
          );
          if (row?.setting_value) {
            const parsed = JSON.parse(row.setting_value);
            if (Array.isArray(parsed)) {
              globalVisibleSiteIds = parsed.map(Number).filter(Number.isFinite);
            }
          }
        } catch (e) {
          console.error("[prefs] global village default unreadable:", e.message);
        }

        return send.ok(res, { prefs, globalVisibleSiteIds });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // PUT /api/me/preferences { prefs } — MERGE the given keys into the user's
    // stored prefs, so a partial save never clobbers other settings.
    savePreferences: async (req, res) => {
      const incoming = req.body?.prefs;
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        return res.status(400).json({ error: "prefs must be an object" });
      }
      // Atomic read-merge-write: lock the user's row (FOR UPDATE) so two of the
      // same user's devices saving different keys at once can't clobber each
      // other — the merge preserves keys only if the read+write are serialized.
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        // Ensure the row exists so FOR UPDATE always has something to lock —
        // this serializes even two brand-new-user first writes (the second
        // INSERT IGNORE blocks on the first, then reads its committed value).
        await conn.query(
          "INSERT IGNORE INTO user_preferences (user_id, prefs) VALUES (?, '{}')",
          [req.user.id]
        );
        const [rows] = await conn.query(
          "SELECT prefs FROM user_preferences WHERE user_id = ? FOR UPDATE",
          [req.user.id]
        );
        let current = {};
        if (rows.length && rows[0].prefs) {
          current = typeof rows[0].prefs === "string" ? JSON.parse(rows[0].prefs) : rows[0].prefs;
        }
        const merged = { ...current, ...incoming };
        await conn.query(
          `INSERT INTO user_preferences (user_id, prefs) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE prefs = VALUES(prefs), updated_at = CURRENT_TIMESTAMP`,
          [req.user.id, JSON.stringify(merged)]
        );
        await conn.commit();
        return send.ok(res, { prefs: merged });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        console.error(e);
        return send.serverErr(res);
      } finally {
        conn.release();
      }
    },

    // GET /api/dashboard (placeholder)
    dashboard: async (_req, res) => send.ok(res, { widgets: [] }),

    // ---- User management (admin only) ----

    // GET /api/users — each user + the project ids assigned to them (for the
    // admin edit form to seed the village multi-select).
    // GET /api/users  (admin)
    // Returns the account's STATE as well as its identity. An admin looking at
    // this list needs to know who has never accepted their invite and whose
    // invite has quietly gone stale — an account that cannot be signed into
    // looks exactly like a working one if all you list is name and role.
    listUsers: async (_req, res) => {
      try {
        const [rows] = await pool.query(
          `SELECT id, email, name, role, created_at, last_login_at, invited_at,
                  totp_enabled, must_change_password,
                  password_set_token IS NOT NULL AS has_invite,
                  password_set_purpose,
                  password_set_expires,
                  password_retired_at,
                  (password_set_token IS NOT NULL AND password_set_expires > NOW()) AS invite_live
             FROM users
            ORDER BY created_at DESC`
        );
        const users = rows.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          created_at: u.created_at,
          lastLoginAt: u.last_login_at,
          invitedAt: u.invited_at,
          twoFactorEnabled: !!u.totp_enabled,
          mustChangePassword: !!u.must_change_password,
          inviteExpiresAt: u.has_invite ? u.password_set_expires : null,
          // Status is decided by what is TRUE about the password, not by the
          // purpose of the last link sent — that inference broke whenever two
          // links overlapped. Locked means password_retired_at is set: nobody
          // can sign in until a link is used. Whether that reads as an invite or
          // a reset depends on whether the account has ever been used.
          //
          //   usable password                  -> active   (a live link, if any,
          //                                                 is reported alongside)
          //   locked, live link                -> invited | reset-sent
          //   locked, no live link             -> invite-expired | reset-expired
          status: !u.password_retired_at
            ? "active"
            : u.invite_live
              ? (u.last_login_at ? "reset-sent" : "invited")
              : (u.last_login_at ? "reset-expired" : "invite-expired"),
          // A live link on an account that can ALSO still sign in: onboarding
          // sent to a working account. Worth showing; not worth a status.
          linkLive: !!u.invite_live,
        }));
        // The configured lifetimes, so the admin UI can state them instead of
        // hard-coding "a couple of hours" beside a value somebody configured.
        return send.ok(res, { users, linkHours: LINK_HOURS });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/users
    // POST /api/users  (admin)
    //
    // Two ways to create an account, and the default is the one where nobody
    // but the account holder ever knows the password: the account goes in with
    // an unusable hash and an invite link goes out by mail.
    //
    // `password` is the other way — an admin sets one directly, for someone
    // who has no mailbox yet or is standing next to them. It still forces a
    // change at first sign-in, because a password someone else chose and typed
    // is a password someone else knows.
    //
    // The account is created either way. If SMTP is down the invite is still
    // minted and reported as unsent, so the admin can resend rather than
    // discovering later that nothing was created.
    createUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, name, role } = req.body;
      const password = req.body.password || null;
      const effRole = safeRoleOf(role);

      if (password && String(password).length < 6) {
        return send.bad(res, "A password you set must be at least 6 characters");
      }
      const conn = await pool.getConnection();
      let userId = null;
      try {
        const [dup] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
        if (dup[0]) { conn.release(); return send.bad(res, "Email already registered"); }

        const passwordHash = password
          ? await bcrypt.hash(password, 10)
          : await unusablePasswordHash();

        await conn.beginTransaction();
        const [ins] = await conn.query(
          `INSERT INTO users (email, password_hash, name, role, must_change_password, password_retired_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          // No password given = invite path = nobody can sign in until the link
          // is used. Recorded, so the list says so rather than inferring it.
          [email, passwordHash, name || null, effRole, password ? 1 : 0, password ? null : new Date()]
        );
        userId = ins.insertId;
        await conn.commit();
        conn.release();
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
        console.error("[users] create failed:", e.message);
        return send.serverErr(res);
      }

      // Mail is sent AFTER the transaction commits, never inside it: a held
      // transaction waiting on an SMTP handshake is a lock waiting on a network.
      const created = { id: userId, email, name: name || null, role: effRole };
      if (password) {
        return send.created(res, { ...created, invited: false, emailed: false });
      }
      // Same rule as every other link: undelivered means discarded. The account
      // still exists, with a password nobody holds, and the admin is told to
      // send the onboarding link again once mail is working.
      const r = await sendPasswordLink(pool, created, "invite");
      if (r.sent) {
        logTwoFactorEvent(pool, {
          userId: created.id, userEmail: created.email, actor: req.user, req, event: "onboarding_sent",
          detail: `new account, valid ${LINK_HOURS.invite}h`,
        });
      }
      return send.created(res, {
        ...created,
        invited: true,
        emailed: r.sent,
        emailError: r.error,
        expiresHours: LINK_HOURS.invite,
      });
    },

    // PUT /api/users/:id
    updateUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const targetId = Number(req.params.id);
      const { email, password, name, role } = req.body;
      const conn = await pool.getConnection();
      try {
        const [existing] = await conn.query("SELECT id, email, role FROM users WHERE id = ?", [targetId]);
        if (!existing[0]) { conn.release(); return send.bad(res, "User not found"); }

        // If email changed, check it's not taken by someone else
        if (email && email !== existing[0].email) {
          const [dup] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
          if (dup[0] && dup[0].id !== targetId) { conn.release(); return send.bad(res, "Email already in use"); }
        }

        // Build dynamic SET clause
        const sets = [];
        const params = [];
        const emailChanged = email !== undefined && email !== existing[0].email;
        if (email !== undefined) { sets.push("email = ?"); params.push(email); }
        if (name !== undefined) { sets.push("name = ?"); params.push(name); }
        // Same whitelist as insertUser: this previously took the raw value.
        if (role !== undefined) { sets.push("role = ?"); params.push(safeRoleOf(role)); }
        if (password) {
          // A password an administrator typed is a password an administrator
          // knows. The modal has always said they would be asked to change it;
          // until now nothing made that true.
          sets.push("password_hash = ?", "must_change_password = 1",
                    "password_changed_at = NOW()", "password_retired_at = NULL");
          params.push(await bcrypt.hash(password, 10));
        }

        // Any outstanding link is cancelled when the thing it was sent FOR
        // changes:
        //  • the email — or a link already delivered to the WRONG address stays
        //    usable, and whoever holds it sets the password on the corrected
        //    account. Fixing a typo in someone's address was a takeover.
        //  • the password — or the link, used later, silently replaces the one
        //    just set by hand, while the list still reports a reset outstanding.
        // A role change deliberately does not: promoting someone before they
        // have accepted their invite is ordinary, and the link is theirs.
        const cancelLink = emailChanged || Boolean(password);
        if (cancelLink) {
          sets.push("password_set_token = NULL", "password_set_expires = NULL", "password_set_purpose = NULL");
        }

        // Effective role AFTER this update decides village handling. Run
        // through the same whitelist the SET clause uses, or an unrecognised
        // value would be stored as "viewer" while this line still treated it
        // as something else.
        const effRole = role !== undefined ? safeRoleOf(role) : existing[0].role;

        // Demoting the last admin leaves a console nobody can administer, and
        // no amount of database access from the UI can undo it.
        if (existing[0].role === "admin" && effRole !== "admin") {
          const [[{ admins }]] = await conn.query(
            "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'"
          );
          if (admins <= 1) {
            conn.release();
            return send.bad(res, "This is the only administrator — promote someone else first");
          }
        }
        if (sets.length === 0) {
          conn.release();
          return send.bad(res, "Nothing to update");
        }

        await conn.beginTransaction();
        if (sets.length) {
          params.push(targetId);
          await conn.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
        }
        await conn.commit();

        const [rows] = await conn.query(
          "SELECT id, email, name, role, created_at FROM users WHERE id = ?",
          [targetId]
        );
        conn.release();
        // Said, so the admin knows to send a fresh link to the corrected address.
        return send.ok(res, { user: rows[0], linkCancelled: cancelLink });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
        console.error(e);
        return send.serverErr(res);
      }
    },

    // DELETE /api/users/:id
    deleteUser: async (req, res) => {
      const targetId = Number(req.params.id);
      if (targetId === req.user.id) {
        return send.bad(res, "Cannot delete your own account");
      }
      try {
        const [[target]] = await pool.query("SELECT role FROM users WHERE id = ?", [targetId]);
        if (!target) return send.bad(res, "User not found");
        if (target.role === "admin") {
          const [[{ admins }]] = await pool.query(
            "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'"
          );
          if (admins <= 1) {
            return send.bad(res, "This is the only administrator — promote someone else first");
          }
        }
        const [result] = await pool.query("DELETE FROM users WHERE id = ?", [targetId]);
        if (result.affectedRows === 0) return send.bad(res, "User not found");
        return send.ok(res, { deleted: true });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },
  };
}
