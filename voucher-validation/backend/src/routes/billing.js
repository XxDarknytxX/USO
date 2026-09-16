// src/routes/billing.js
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { computeBilling, writeTarget } from "../services/billing.js";

// Billing is administrators only: it is the estate's money, across every
// village in the estate default, and nothing here narrows by a viewer's scope.
export function makeBillingRouter(pool) {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  // GET /api/billing?month=YYYY-MM  (default: the last complete month)
  router.get("/", async (req, res) => {
    try {
      return res.json(await computeBilling(pool, { month: req.query.month }));
    } catch (e) {
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
