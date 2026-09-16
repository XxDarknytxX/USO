// src/middleware/auth.js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET); // { id, email, role }
    // A half-finished login is not a login. These tokens exist only to be
    // exchanged — pending2FA for a code, pending2FASetup for enrolment — and
    // must not open anything else, or the second factor is decorative.
    if (claims.pending2FA || claims.pending2FASetup) {
      return res.status(403).json({
        error: claims.pending2FA
          ? "Two-factor verification required"
          : "Two-factor setup required",
        requires2FA: !!claims.pending2FA,
        requires2FASetup: !!claims.pending2FASetup,
      });
    }
    req.user = claims;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * For the enrolment endpoints only: accepts the short-lived setup token as well
 * as a full one, so somebody who has been told to turn 2FA on can actually
 * reach the page that turns it on. Still rejects a pending2FA token, which has
 * a different job.
 */
export function requireAuthAllowing2FASetup(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims.pending2FA) return res.status(403).json({ error: "Two-factor verification required" });
    req.user = claims;
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

// Which roles are LIMITED to a subset of the estate. Admins are unrestricted
// and are handled before this is consulted; anything NOT listed here is
// restricted to nothing, so a role added later cannot default to seeing
// everything by omission.
const SCOPED_ROLES = new Set(["viewer", "engineer"]);

/**
 * Attaches req.scope describing which villages the caller may see:
 *   admin             -> { isViewer:false, projectIds:null, groupIds:null }  (null = unrestricted)
 *   viewer | engineer -> the ESTATE DEFAULT, resolved to network_projects.id
 *                        + ruijie_group_id
 *   anything else     -> nothing
 *
 * ONE setting decides this for the whole console: app_settings
 * global_visible_villages, edited by an admin under Settings. There is no
 * per-account village list. The estate carries test villages that get added
 * and removed, and excluding one should be a single decision that takes effect
 * everywhere — not the same list maintained once per account, which goes stale
 * the day a village is added and nobody remembers who to update.
 *
 * An unset or unreadable default means "no restriction", which is what an
 * administrator who has never set one has asked for. A default that has been
 * explicitly CLEARED means nothing, and is honoured as such.
 *
 * `isViewer` is a misnomer kept deliberately — it is read at dozens of call
 * sites and means "restricted", not "has the viewer role".
 *
 * Fails CLOSED: any DB error yields an EMPTY set, never unrestricted.
 *
 * A factory because it needs the pool. Mount AFTER requireAuth on scoped routers.
 */
export function makeAttachScope(pool) {
  return async function attachScope(req, res, next) {
    if (req.user?.role === "admin") {
      req.scope = { isViewer: false, projectIds: null, groupIds: null };
      return next();
    }
    if (!SCOPED_ROLES.has(req.user?.role)) {
      req.scope = { isViewer: true, projectIds: [], groupIds: [] };
      return next();
    }
    try {
      const [[setting]] = await pool.query(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'global_visible_villages'"
      );
      let ids = null; // null = no restriction
      if (setting?.setting_value) {
        try {
          const parsed = JSON.parse(setting.setting_value);
          if (Array.isArray(parsed)) ids = parsed.map(Number).filter(Number.isFinite);
        } catch {
          /* unreadable default = no restriction; a corrupt setting should widen
             the view, not take the console away from everyone at once */
        }
      }

      let rows;
      if (ids && ids.length === 0) {
        // Cleared on purpose means nothing — and `IN ()` is a syntax error, so
        // this cannot be left to the query to express.
        rows = [];
      } else if (ids) {
        [rows] = await pool.query(
          `SELECT id, ruijie_group_id FROM network_projects
            WHERE is_active = 1 AND id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else {
        [rows] = await pool.query(
          "SELECT id, ruijie_group_id FROM network_projects WHERE is_active = 1"
        );
      }

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
