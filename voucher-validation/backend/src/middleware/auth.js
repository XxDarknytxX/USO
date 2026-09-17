// src/middleware/auth.js
import jwt from "jsonwebtoken";
import { readEstateDefault } from "../services/estateScope.js";

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

/**
 * Two administrator roles.
 *   admin       runs the console day to day
 *   superadmin  everything an admin can, plus the settings that change the
 *               console for everyone or hold credentials: the estate default,
 *               email (SMTP) and Starlink API configuration, the two-factor
 *               policy and the schedules — and superadmin accounts themselves.
 * Every "admin only" check below admits both; requireSuperadmin admits one.
 */
export const ADMIN_ROLES = new Set(["admin", "superadmin"]);
export const isAdminRole = (role) => ADMIN_ROLES.has(role);

export function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user?.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function requireSuperadmin(req, res, next) {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Only the superadmin can change this" });
  }
  next();
}

// ADMIN ONLY, whatever the name suggests. It dates from when "viewer" was the
// only other role; every role since (engineer, billing) is refused here too,
// because it is an allow-list of one. Used for endpoints that are not
// village-scopeable: sync-logs, audit logs, transaction flows, manual
// assistance, voucher CRUD data, settings.
export function requireNotViewer(req, res, next) {
  // Engineers are denied here too. They are not viewers, so without this every
  // endpoint guarded by requireNotViewer — settings, audit logs, transaction
  // flows, voucher CRUD — would open to a field contractor the moment the role
  // was added. Allow-list the roles that may pass rather than deny-listing.
  if (!isAdminRole(req.user?.role)) {
    return res.status(403).json({ error: "Not permitted for this account" });
  }
  next();
}

/**
 * Maintenance access, decided by what the request DOES.
 *
 *   read  (GET, HEAD)  — admin, engineer, viewer
 *   write (everything else) — admin, engineer
 *
 * Viewers may look at the maintenance record — schedules, filed reports, site
 * photos — for the villages they can see, but may not start, edit, photograph
 * or file anything.
 *
 * Gated on the METHOD rather than listed route by route on purpose. A list of
 * write routes is a list someone forgets to update: the next endpoint added
 * would be open to viewers by default. Keyed on the method, a new POST is
 * closed to them unless someone deliberately says otherwise.
 */
const MAINTENANCE_READERS = new Set(["superadmin", "admin", "engineer", "viewer"]);
const MAINTENANCE_WRITERS = new Set(["superadmin", "admin", "engineer"]);

export function requireMaintenanceAccess(req, res, next) {
  const role = req.user?.role;
  const reading = req.method === "GET" || req.method === "HEAD";
  const allowed = reading ? MAINTENANCE_READERS : MAINTENANCE_WRITERS;
  if (!allowed.has(role)) {
    return res.status(403).json({
      error: reading ? "Maintenance access required" : "Your account can view maintenance but not change it",
    });
  }
  next();
}

/**
 * The monitoring data behind the Dashboard and Overview — revenue, vouchers,
 * network health, Starlink usage and telemetry. Admins, viewers and billing.
 *
 * NOT engineers. A field engineer's console is Maintenance and nothing else:
 * they are contractors sent to a site, and the estate's revenue and voucher
 * figures are not theirs to see. Hiding the tabs was never going to be the
 * whole answer, because the tabs are only a view onto these endpoints.
 *
 * An allow-list, applied at ROUTER level on the routers that serve that data,
 * so an endpoint added to one of them later is closed to engineers by default.
 */
const DASHBOARD_ROLES = new Set(["superadmin", "admin", "viewer", "billing"]);

export function requireDashboardAccess(req, res, next) {
  if (!DASHBOARD_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: "Your account does not have access to this data" });
  }
  next();
}

/**
 * The monthly bill. Admins and billing accounts READ it; only admins change
 * the target it is measured against, because that one number moves every
 * village's figure for everyone who reads the bill.
 *
 * Keyed on the method like maintenance, so a write route added later is
 * admin-only unless someone deliberately opens it.
 */
const BILLING_READERS = new Set(["superadmin", "admin", "billing"]);
const BILLING_WRITERS = new Set(["superadmin", "admin"]);

export function requireBillingAccess(req, res, next) {
  const role = req.user?.role;
  const reading = req.method === "GET" || req.method === "HEAD";
  const allowed = reading ? BILLING_READERS : BILLING_WRITERS;
  if (!allowed.has(role)) {
    return res.status(403).json({
      error: reading ? "Billing access required" : "Only an administrator can change the billing target",
    });
  }
  next();
}

// Which roles are LIMITED to a subset of the estate. Admins are unrestricted
// and are handled before this is consulted; anything NOT listed here is
// restricted to nothing, so a role added later cannot default to seeing
// everything by omission.
const SCOPED_ROLES = new Set(["viewer", "engineer", "billing"]);

/**
 * Attaches req.scope describing which villages the caller may see:
 *   admin             -> { isViewer:false, projectIds:null, groupIds:null }  (null = unrestricted)
 *   viewer | engineer | billing -> the ESTATE DEFAULT, resolved to network_projects.id
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
    if (isAdminRole(req.user?.role)) {
      req.scope = { isViewer: false, projectIds: null, groupIds: null };
      return next();
    }
    if (!SCOPED_ROLES.has(req.user?.role)) {
      req.scope = { isViewer: true, projectIds: [], groupIds: [] };
      return next();
    }
    try {
      // Shared with the preferences endpoint and billing, so the villages a
      // scoped account is shown and the villages the bill covers are decided by
      // the same code. null = no restriction (unset, every village, or an
      // unreadable value — see services/estateScope.js). A read failure throws
      // and lands in the catch below, which fails closed.
      const { ids } = await readEstateDefault(pool);

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
      // `unresolved` tells this apart from a role that legitimately sees no
      // village. Most readers show nothing either way; the bill must not — an
      // empty bill looks exactly like a month in which nothing was earned.
      req.scope = { isViewer: true, projectIds: [], groupIds: [], unresolved: true };
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
