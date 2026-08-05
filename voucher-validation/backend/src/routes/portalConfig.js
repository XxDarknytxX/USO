// src/routes/portalConfig.js
// Admin-authenticated routes for portal plan configuration management
import { Router } from "express";
import { requireAuth, requireAdmin, requireNotViewer } from "../middleware/auth.js";

export function makePortalConfigRouter(controller, attachScope) {
  const router = Router();

  // All portal config routes require authentication
  router.use(requireAuth);
  // Village scope so the viewer-reachable /revenue can clamp to assigned villages.
  if (attachScope) router.use(attachScope);

  // Reorder must come before /:id to avoid route conflict
  router.put("/plans/reorder", requireAdmin, controller.reorderPlans);

  // CRUD for portal plan configs — not for viewers
  router.get("/plans", requireNotViewer, controller.getPlans);
  router.get("/plans/:id", requireNotViewer, controller.getPlan);
  router.post("/plans", requireAdmin, controller.createPlan);
  router.put("/plans/:id", requireAdmin, controller.updatePlan);
  router.delete("/plans/:id", requireAdmin, controller.deletePlan);

  // Audit logs — not for viewers
  router.get("/audit-logs", requireNotViewer, controller.getAuditLogs);

  // Transaction flow (grouped timeline view) — not for viewers
  router.get("/transaction-flows", requireNotViewer, controller.getTransactionFlows);

  // Sales revenue aggregation (total / month / today / per-village + trend).
  // Viewer-reachable (dashboard) — the controller clamps to req.scope.
  router.get("/revenue", controller.getRevenue);
  // Everything about one month: totals, daily/hourly series, plan + village splits.
  router.get("/breakdown", controller.getBreakdown);

  // Manual assistance cases (paid but auth failed) — not for viewers (incl. the
  // live resolve write, which was previously any-authenticated).
  router.get("/manual-assistance", requireNotViewer, controller.getManualAssistance);
  router.post("/manual-assistance/:transactionId/resolve", requireNotViewer, controller.resolveManualAssistance);

  return router;
}
