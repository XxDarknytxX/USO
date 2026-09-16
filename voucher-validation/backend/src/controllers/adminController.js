// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  isTwoFactorRequired, setTwoFactorRequired, beginEnrolment, verifyEnrolment,
  verifyCode, clearTwoFactor, generateTempPassword,
} from "../services/twoFactor.js";
import {
  loadSmtpTransport, buildOnboarding, buildPasswordReset, buildTwoFactorReset,
} from "../services/mailer.js";
import { validationResult } from "express-validator";

/** Local response helpers */
const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  unauthorized: (res, msg = "Unauthorized") => res.status(401).json({ error: msg }),
  forbidden: (res, msg = "Forbidden") => res.status(403).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

/** Thin data-access helpers */
async function findUserByEmail(pool, email) {
  const [rows] = await pool.query(
    "SELECT id, email, password_hash, name, role FROM users WHERE email = ?",
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

// Replace a user's assigned villages. Bulk INSERT IGNORE downgrades a bad/duplicate
// project_id (FK miss) to a skipped row instead of erroring. Runs on a transaction
// connection. De-dupes + coerces to positive ints.
async function insertUserVillages(conn, userId, projectIds) {
  const ids = [
    ...new Set((projectIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
  ];
  if (!ids.length) return;
  const placeholders = ids.map(() => "(?, ?)").join(", ");
  const params = [];
  for (const pid of ids) params.push(userId, pid);
  await conn.query(
    `INSERT IGNORE INTO user_villages (user_id, project_id) VALUES ${placeholders}`,
    params
  );
}

/** Factory */
/**
 * Sends one account email and REPORTS whether it went, rather than throwing.
 * The database change has already happened by this point; failing the whole
 * request because SMTP is down would leave the caller thinking nothing
 * happened when the password has in fact already changed.
 */
async function sendAccountMail(pool, user, kind, { password } = {}) {
  try {
    const smtp = await loadSmtpTransport(pool);
    if (!smtp) return { sent: false, error: "SMTP is not configured in Settings" };
    // Falls back to the live console rather than to prose: a welcome mail whose
    // "sign in at" line reads "the operations console" is a mail that cannot be
    // acted on. CONSOLE_URL overrides it for staging.
    const url = process.env.CONSOLE_URL || process.env.APP_URL || "https://admin.vodafonefiji.cloud";
    const args = { name: user.name, email: user.email, password, url };
    const mail =
      kind === "onboarding" ? buildOnboarding(args)
      : kind === "password-reset" ? buildPasswordReset(args)
      : buildTwoFactorReset(args);
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
      try {
        const user = await findUserByEmail(pool, email);
        if (!user) return send.bad(res, "Invalid credentials");

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return send.bad(res, "Invalid credentials");

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

        await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]).catch(() => {});
        const token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "2h" });
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
    // Sets a temporary password, flags the account to change it on first use,
    // and mails it. The password is returned in the response as well: SMTP may
    // be unconfigured or the address wrong, and an admin who cannot see what
    // was set has no way to hand it over by another route.
    resetUserPassword: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT id, email, name FROM users WHERE id = ?", [req.params.id]);
        const user = rows[0];
        if (!user) return send.notFound(res, "User not found");

        const tempPassword = generateTempPassword();
        await pool.query(
          "UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = NOW() WHERE id = ?",
          [await bcrypt.hash(tempPassword, 10), user.id]
        );

        const mail = await sendAccountMail(pool, user, "password-reset", { password: tempPassword });
        return send.ok(res, { success: true, tempPassword, emailed: mail.sent, emailError: mail.error });
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

        await clearTwoFactor(pool, user.id);
        const mail = await sendAccountMail(pool, user, "2fa-reset", {});
        return send.ok(res, { success: true, wasEnabled: !!user.totp_enabled, emailed: mail.sent, emailError: mail.error });
      } catch (e) {
        console.error("[users] 2FA reset failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/users/:id/resend-onboarding  (admin)
    // Same as a password reset in effect, worded as a welcome — for an account
    // created before the mail worked, or one that never arrived.
    resendOnboarding: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT id, email, name FROM users WHERE id = ?", [req.params.id]);
        const user = rows[0];
        if (!user) return send.notFound(res, "User not found");

        const tempPassword = generateTempPassword();
        await pool.query(
          "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
          [await bcrypt.hash(tempPassword, 10), user.id]
        );
        const mail = await sendAccountMail(pool, user, "onboarding", { password: tempPassword });
        return send.ok(res, { success: true, tempPassword, emailed: mail.sent, emailError: mail.error });
      } catch (e) {
        console.error("[users] onboarding resend failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/me/password — change your own password.
    changeOwnPassword: async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || String(newPassword).length < 8) {
        return send.bad(res, "Choose a password of at least 8 characters");
      }
      try {
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
            return send.bad(res, "Your current password is not right");
          }
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

        const r = await verifyCode(pool, decoded.id, code);
        if (!r.ok) return send.bad(res, r.error || "That code is not right.");

        const { pending2FA, iat, exp, ...claims } = decoded;
        await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [decoded.id]).catch(() => {});
        const [rows] = await pool.query("SELECT must_change_password FROM users WHERE id = ?", [decoded.id]);
        return send.ok(res, {
          token: jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "2h" }),
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
        return send.ok(res, await beginEnrolment(pool, req.user));
      } catch (e) {
        console.error("[2fa] setup failed:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/2fa/verify — confirm enrolment, switch it on, return the backup
    // codes. They are shown exactly once; only hashes are kept.
    verify2FA: async (req, res) => {
      const { code } = req.body || {};
      if (!code) return send.bad(res, "Enter the code from your authenticator app");
      try {
        const r = await verifyEnrolment(pool, req.user.id, code);
        if (!r.ok) return send.bad(res, r.error);
        const { pending2FASetup, iat, exp, ...claims } = req.user;
        // A setup token brought them here; hand back a real one so enrolling
        // lands them in the app rather than back at the login screen.
        return send.ok(res, {
          enabled: true,
          backupCodes: r.backupCodes,
          token: jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "2h" }),
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
      try {
        if (await isTwoFactorRequired(pool)) {
          return send.bad(res, "Two-factor authentication is required for every account and cannot be turned off.");
        }
        const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
        if (!rows[0]) return send.notFound(res, "User not found");
        if (!password || !(await bcrypt.compare(password, rows[0].password_hash))) {
          return send.bad(res, "Enter your current password to turn two-factor off.");
        }
        await clearTwoFactor(pool, req.user.id);
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
        let villages = [];
        if (user.role === "viewer") {
          const [vrows] = await pool.query(
            `SELECT p.id, p.name, p.hostname, p.ruijie_group_id
               FROM user_villages uv JOIN network_projects p ON p.id = uv.project_id
              WHERE uv.user_id = ? AND p.is_active = 1
              ORDER BY p.sort_order, p.name`,
            [user.id]
          );
          villages = vrows.map((r) => ({
            id: r.id, name: r.name, hostname: r.hostname, ruijieGroupId: r.ruijie_group_id,
          }));
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
        return send.ok(res, { prefs });
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
    listUsers: async (_req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC"
        );
        const [uv] = await pool.query("SELECT user_id, project_id FROM user_villages");
        const byUser = {};
        for (const r of uv) (byUser[r.user_id] ||= []).push(r.project_id);
        const users = rows.map((u) => ({ ...u, villageIds: byUser[u.id] || [] }));
        return send.ok(res, { users });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/users
    createUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, password, name, role, villageIds } = req.body;
      const effRole = role || "viewer";
      const conn = await pool.getConnection();
      try {
        const [dup] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
        if (dup[0]) { conn.release(); return send.bad(res, "Email already registered"); }

        const passwordHash = await bcrypt.hash(password, 10);
        await conn.beginTransaction();
        const [ins] = await conn.query(
          "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
          [email, passwordHash, name || null, effRole]
        );
        const userId = ins.insertId;
        // Village scope is only meaningful for viewers (admins are unrestricted).
        if (effRole === "viewer") await insertUserVillages(conn, userId, villageIds);
        await conn.commit();
        conn.release();
        return send.created(res, { id: userId, email, name: name || null, role: effRole });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
        console.error(e);
        return send.serverErr(res);
      }
    },

    // PUT /api/users/:id
    updateUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const targetId = Number(req.params.id);
      const { email, password, name, role, villageIds } = req.body;
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
        if (email !== undefined) { sets.push("email = ?"); params.push(email); }
        if (name !== undefined) { sets.push("name = ?"); params.push(name); }
        // Same whitelist as insertUser: this previously took the raw value.
        if (role !== undefined) { sets.push("role = ?"); params.push(safeRoleOf(role)); }
        if (password) {
          sets.push("password_hash = ?");
          params.push(await bcrypt.hash(password, 10));
        }

        // Effective role AFTER this update decides village handling.
        const effRole = role !== undefined ? role : existing[0].role;
        // Admins are unrestricted -> always clear stale rows. Viewers -> replace the
        // set only when villageIds was actually sent.
        const touchesVillages = effRole === "admin" || villageIds !== undefined;
        if (sets.length === 0 && !touchesVillages) {
          conn.release();
          return send.bad(res, "Nothing to update");
        }

        await conn.beginTransaction();
        if (sets.length) {
          params.push(targetId);
          await conn.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
        }
        if (effRole === "admin") {
          await conn.query("DELETE FROM user_villages WHERE user_id = ?", [targetId]);
        } else if (villageIds !== undefined) {
          await conn.query("DELETE FROM user_villages WHERE user_id = ?", [targetId]);
          await insertUserVillages(conn, targetId, villageIds);
        }
        await conn.commit();

        const [rows] = await conn.query("SELECT id, email, name, role, created_at FROM users WHERE id = ?", [targetId]);
        const [uv] = await conn.query("SELECT project_id FROM user_villages WHERE user_id = ?", [targetId]);
        conn.release();
        return send.ok(res, { user: { ...rows[0], villageIds: uv.map((r) => r.project_id) } });
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
