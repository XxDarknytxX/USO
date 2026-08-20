// src/routes/maintenance.js
import { Router } from "express";
import { requireAuth, requireAdmin, requireMaintainer } from "../middleware/auth.js";

export function makeMaintenanceRouter(controller) {
  const router = Router();

  // Admins and engineers. Engineers reach nothing else in the app — every other
  // router is guarded by requireAdmin or requireNotViewer, both of which now
  // deny them.
  router.use(requireAuth, requireMaintainer);

  // The checklist itself, so the UI never drifts from server validation.
  router.get("/components", controller.getComponents);
  // Which villages are due or overdue for their 6-monthly service.
  router.get("/schedule", controller.getSchedule);

  router.get("/visits", controller.listVisits);
  router.post("/visits", controller.createVisit);
  router.get("/visits/:id", controller.getVisit);
  router.put("/visits/:id", controller.updateVisit);
  router.post("/visits/:id/submit", controller.submitVisit);
  // Unfiling a report is an admin action and records who and why.
  router.post("/visits/:id/reopen", requireAdmin, controller.reopenVisit);

  router.post("/visits/:id/photos", controller.addPhoto);
  router.get("/photos/:id", controller.getPhoto);
  router.delete("/photos/:id", controller.deletePhoto);

  return router;
}
