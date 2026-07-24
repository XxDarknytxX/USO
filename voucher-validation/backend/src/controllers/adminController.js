// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

async function insertUser(pool, { email, passwordHash, name, role }) {
  // Whitelist the role — never trust an arbitrary value into the privileged
  // column. Anything that isn't exactly "admin" becomes "viewer".
  const safeRole = role === "admin" ? "admin" : "viewer";
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

        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "2h" }
        );
        return send.ok(res, { token });
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
        if (role !== undefined) { sets.push("role = ?"); params.push(role); }
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
