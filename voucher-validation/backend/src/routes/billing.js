// src/routes/billing.js
import { Router } from "express";
import { requireAuth, requireBillingAccess } from "../middleware/auth.js";
import { computeBilling, writeTarget } from "../services/billing.js";

// Administrators and billing accounts read the bill; only administrators change
// the target (requireBillingAccess decides by HTTP method). The bill follows the
// reader's view the way the dashboards do: ?villages= carries the switcher's
// village or "Your view"; without it, the estate default.
export function makeBillingRouter(pool, attachScope) {
  const router = Router();
  router.use(requireAuth, requireBillingAccess);
  if (attachScope) router.use(attachScope);

  // GET /api/billing?month=YYYY-MM&villages=1,2,3
  //   month     default: the last complete month
  //   villages  optional — the reader's view. Absent: the estate default.
  router.get("/", async (req, res) => {
    try {
      const isAdmin = req.user?.role === "admin";
      let selection = null;
      if (req.query.villages !== undefined) {
        const raw = String(req.query.villages).trim();
        const parts = raw === "" ? [] : raw.split(",");
        const ids = parts.map((s) => Number(s.trim()));
        if (parts.length > 5000 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
          return res.status(400).json({ error: "villages must be a comma-separated list of village ids" });
        }
        selection = [...new Set(ids)];
      }
      // A non-admin is clamped to its resolved scope. If that scope could not
      // be resolved — attachScope hit a database error, or is not mounted — the
      // bill is REFUSED. Failing closed to an empty scope is right for a list of
      // villages and wrong for a bill: a $0 bill with HTTP 200 reads as a month
      // in which nothing was earned, and exports as one.
      if (!isAdmin && (!req.scope || req.scope.unresolved)) {
        return res.status(503).json({ error: "Could not work out which villages to bill — please try again" });
      }
      const scope = isAdmin ? null : req.scope;
      return res.json(await computeBilling(pool, { month: req.query.month, scope, selection, detail: isAdmin }));
    } catch (e) {
      if (e.code === "SCOPE_CHANGED") {
        return res.status(503).json({ error: e.message });
      }
      console.error("[billing] compute failed:", e.message);
      return res.status(500).json({ error: "Could not calculate billing" });
    }
  });

  // PUT /api/billing/target { target }
  router.put("/target", async (req, res) => {
    try {
      const target = await writeTarget(pool, req.body?.target, req.user?.id);
      return res.json({ target });
    } catch (e) {
      if (e.code === "BAD_TARGET") return res.status(400).json({ error: e.message });
      console.error("[billing] target write failed:", e.message);
      return res.status(500).json({ error: "Could not save the target" });
    }
  });

  return router;
}
