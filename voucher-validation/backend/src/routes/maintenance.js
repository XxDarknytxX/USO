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

  // Every filed component across every visit — the "what was inspected when"
  // view, as opposed to the per-attendance one.
  router.get("/submissions", controller.listSubmissions);

  // A village as a thing: current condition of every component, its photos and
  // history, plus the paperwork that belongs to the site.
  router.get("/villages/:projectId/profile", controller.getVillageProfile);
  router.post("/villages/:projectId/documents", controller.addDocument);
  router.get("/documents/:id", controller.getDocument);
  // Removing site paperwork is an admin action.
  router.delete("/documents/:id", requireAdmin, controller.removeDocument);

  router.get("/visits", controller.listVisits);
  router.post("/visits", controller.createVisit);
  router.get("/visits/:id", controller.getVisit);
  router.put("/visits/:id", controller.updateVisit);
  // A draft can be thrown away; a filed report cannot.
  router.delete("/visits/:id", controller.deleteVisit);
  // Per-component filing — the normal path. The whole-visit submit below stays
  // as a way to file everything at once.
  router.post("/visits/:id/checks/:key/submit", controller.submitCheck);
  router.post("/visits/:id/checks/:key/reopen", requireAdmin, controller.reopenCheck);
  router.post("/visits/:id/submit", controller.submitVisit);
  // Unfiling a report is an admin action and records who and why.
  router.post("/visits/:id/reopen", requireAdmin, controller.reopenVisit);

  router.post("/visits/:id/photos", controller.addPhoto);
  router.get("/photos/:id", controller.getPhoto);
  router.delete("/photos/:id", controller.deletePhoto);

  return router;
}
