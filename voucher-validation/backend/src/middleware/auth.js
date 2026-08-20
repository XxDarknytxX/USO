// src/middleware/auth.js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { id, email, role }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Blocks the read-only "viewer" role from an endpoint entirely (403). Used for
// endpoints a viewer must never reach and that aren't village-scopeable
// (sync-logs, audit logs, transaction flows, manual assistance, voucher CRUD data,
// settings). With only admin/viewer roles this is effectively "admin only" today,
// but the name states the intent for read endpoints that were previously any-authed.
export function requireNotViewer(req, res, next) {
  // Engineers are denied here too. They are not viewers, so without this every
  // endpoint guarded by requireNotViewer — settings, audit logs, transaction
  // flows, voucher CRUD — would open to a field contractor the moment the role
  // was added. Allow-list the roles that may pass rather than deny-listing.
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Not permitted for this account" });
  }
  next();
}

// Maintenance: admins and engineers. Engineers are scoped to nothing else.
export function requireMaintainer(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "engineer") {
    return res.status(403).json({ error: "Maintenance access required" });
  }
  next();
}

// Attaches req.scope describing which villages the caller may see:
//   admin  -> { isViewer:false, projectIds:null, groupIds:null }  (null = unrestricted)
//   viewer -> { isViewer:true, projectIds:[int], groupIds:[str] }  (their assigned
//             ACTIVE villages, resolved to network_projects.id + ruijie_group_id)
// Fails CLOSED for viewers: any DB error yields an EMPTY set, never unrestricted.
// A factory because it needs the pool. Mount AFTER requireAuth on scoped routers.
export function makeAttachScope(pool) {
  return async function attachScope(req, res, next) {
    if (req.user?.role === "admin") {
      req.scope = { isViewer: false, projectIds: null, groupIds: null };
      return next();
    }
    // Anyone who is not an admin is RESTRICTED. Written as "not admin" rather
    // than "is viewer" so a new role can never default to unrestricted: an
    // engineer reaching a scoped dashboard endpoint gets an empty set (they
    // have no user_villages rows), not every village's revenue.
    if (req.user?.role !== "viewer") {
      req.scope = { isViewer: true, projectIds: [], groupIds: [] };
      return next();
    }
    try {
      const [rows] = await pool.query(
        `SELECT p.id, p.ruijie_group_id
           FROM user_villages uv
           JOIN network_projects p ON p.id = uv.project_id
          WHERE uv.user_id = ? AND p.is_active = 1`,
        [req.user.id]
      );
      req.scope = {
        isViewer: true,
        projectIds: rows.map((r) => Number(r.id)),
        groupIds: rows
          .map((r) => r.ruijie_group_id)
          .filter((g) => g != null && String(g).trim() !== "")
          .map(String),
      };
    } catch (e) {
      console.error("attachScope failed (failing closed):", e.message);
      req.scope = { isViewer: true, projectIds: [], groupIds: [] };
    }
    return next();
  };
}

// Resolve the effective Ruijie group-id filter for a request.
//   returns null            -> unrestricted (admin, no group requested) => query all
//   returns [] (empty)      -> restricted to nothing (viewer with no/again out-of-scope)
//   returns [ids]           -> restrict to these group ids
// `requested` may be null, a single id string, a comma list, or an array.
export function effectiveGroupIds(scope, requested) {
  const reqArr =
    requested == null || requested === ""
      ? null
      : (Array.isArray(requested) ? requested : String(requested).split(","))
          .map((s) => String(s).trim())
          .filter(Boolean);
  if (!scope?.isViewer) return reqArr; // admin: honor request (null = all)
  const allowed = new Set((scope.groupIds || []).map(String));
  if (!reqArr) return [...allowed]; // viewer, no explicit request -> their whole set
  return reqArr.filter((g) => allowed.has(g)); // viewer + request -> intersection
}
