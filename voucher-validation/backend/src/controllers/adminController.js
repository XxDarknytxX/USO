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
  const [res] = await pool.query(
    "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
    [email, passwordHash, name || null, role || "viewer"]
  );
  return { id: res.insertId, email, name, role: role || "viewer" };
}

/** Factory */
export function makeAdminController(pool) {
  return {
    // POST /api/register
    register: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, password, name, role } = req.body;
      try {
        const existing = await findUserByEmail(pool, email);
        if (existing) return send.bad(res, "Email already registered");

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await insertUser(pool, { email, passwordHash, name, role });
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

    // GET /api/me
    me: async (req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT id, email, name, role FROM users WHERE id = ?",
          [req.user.id]
        );
        const user = rows[0];
        if (!user) return send.unauthorized(res, "User not found");
        return send.ok(res, { user });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/dashboard (placeholder)
    dashboard: async (_req, res) => send.ok(res, { widgets: [] }),

    // ---- User management (admin only) ----

    // GET /api/users
    listUsers: async (_req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC"
        );
        return send.ok(res, { users: rows });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/users
    createUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const { email, password, name, role } = req.body;
      try {
        const existing = await findUserByEmail(pool, email);
        if (existing) return send.bad(res, "Email already registered");

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await insertUser(pool, {
          email,
          passwordHash,
          name,
          role: role || "viewer",
        });
        return send.created(res, { id: user.id, email: user.email, name: user.name, role: user.role });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // PUT /api/users/:id
    updateUser: async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return send.bad(res, errors.array()[0].msg);

      const targetId = Number(req.params.id);
      const { email, password, name, role } = req.body;
      try {
        // Check user exists
        const [existing] = await pool.query("SELECT id, email FROM users WHERE id = ?", [targetId]);
        if (!existing[0]) return send.bad(res, "User not found");

        // If email changed, check it's not taken by someone else
        if (email && email !== existing[0].email) {
          const dup = await findUserByEmail(pool, email);
          if (dup && dup.id !== targetId) return send.bad(res, "Email already in use");
        }

        // Build dynamic SET clause
        const sets = [];
        const params = [];
        if (email !== undefined) { sets.push("email = ?"); params.push(email); }
        if (name !== undefined) { sets.push("name = ?"); params.push(name); }
        if (role !== undefined) { sets.push("role = ?"); params.push(role); }
        if (password) {
          const hash = await bcrypt.hash(password, 10);
          sets.push("password_hash = ?");
          params.push(hash);
        }

        if (sets.length === 0) return send.bad(res, "Nothing to update");

        params.push(targetId);
        await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);

        const [rows] = await pool.query("SELECT id, email, name, role, created_at FROM users WHERE id = ?", [targetId]);
        return send.ok(res, { user: rows[0] });
      } catch (e) {
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
