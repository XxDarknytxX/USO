// src/routes/system.js
// Host health for the machine this console runs on.
//
// ADMIN ONLY, and not merely by convention: this reports hostname, kernel
// version, filesystem layout and the pm2 process inventory, which together are
// a useful map for anyone who should not have one. Viewers have no business
// here — they are scoped to a handful of villages.

import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { collectSystemHealth } from "../services/systemHealth.js";

export function makeSystemRouter(pool) {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  // GET /api/system/health
  // Takes ~250ms by design: CPU utilisation is a delta between two readings,
  // and a single reading would report the average since boot — a number that
  // never moves on a long-lived box.
  router.get("/health", async (_req, res) => {
    try {
      return res.json(await collectSystemHealth(pool));
    } catch (e) {
      console.error("[system] health failed:", e.message);
      return res.status(500).json({ error: "Could not read system health" });
    }
  });

  return router;
}
