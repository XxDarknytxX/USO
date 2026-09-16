// src/routes/billing.js
import { Router } from "express";
import { requireAuth, requireBillingAccess } from "../middleware/auth.js";
import { computeBilling, writeTarget } from "../services/billing.js";

// Administrators and billing accounts read the bill; only administrators change
// the target (requireBillingAccess decides by HTTP method). Every reader gets
// the SAME bill — the estate default — because a bill must not change with who
// is looking at it.
export function makeBillingRouter(pool, attachScope) {
  const router = Router();
  router.use(requireAuth, requireBillingAccess);
  if (attachScope) router.use(attachScope);

  // GET /api/billing?month=YYYY-MM  (default: the last complete month)
  router.get("/", async (req, res) => {
    try {
      const isAdmin = req.user?.role === "admin";
      // A non-admin is clamped to its resolved scope. If that scope could not
      // be resolved — attachScope hit a database error, or is not mounted — the
      // bill is REFUSED. Failing closed to an empty scope is right for a list of
      // villages and wrong for a bill: a $0 bill with HTTP 200 reads as a month
      // in which nothing was earned, and exports as one.
      if (!isAdmin && (!req.scope || req.scope.unresolved)) {
        return res.status(503).json({ error: "Could not work out which villages to bill — please try again" });
      }
      const scope = isAdmin ? null : req.scope;
      return res.json(await computeBilling(pool, { month: req.query.month, scope, detail: isAdmin }));
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
