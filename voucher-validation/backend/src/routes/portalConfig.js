// src/routes/portalConfig.js
// Admin-authenticated routes for portal plan configuration management
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makePortalConfigRouter(controller) {
  const router = Router();

  // All portal config routes require authentication
  router.use(requireAuth);

  // Reorder must come before /:id to avoid route conflict
  router.put("/plans/reorder", requireAdmin, controller.reorderPlans);

  // CRUD for portal plan configs
  router.get("/plans", controller.getPlans);
  router.get("/plans/:id", controller.getPlan);
  router.post("/plans", requireAdmin, controller.createPlan);
  router.put("/plans/:id", requireAdmin, controller.updatePlan);
  router.delete("/plans/:id", requireAdmin, controller.deletePlan);

  // Audit logs
  router.get("/audit-logs", controller.getAuditLogs);

  // Transaction flow (grouped timeline view)
  router.get("/transaction-flows", controller.getTransactionFlows);

  // Sales revenue aggregation (total / month / today / per-village + trend)
  router.get("/revenue", controller.getRevenue);

  return router;
}
