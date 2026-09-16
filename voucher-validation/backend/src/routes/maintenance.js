// src/routes/maintenance.js
import { Router } from "express";
import { requireAuth, requireAdmin, requireMaintenanceAccess } from "../middleware/auth.js";

export function makeMaintenanceRouter(controller, attachScope) {
  const router = Router();

  // Admins and engineers, and viewers read-only. Billing accounts not at all.
  //
  // Field engineers are maintenance-only: the dashboard data routers refuse
  // them (requireDashboardAccess), and like every non-admin they cannot reach
  // anything behind requireAdmin or requireNotViewer — vouchers, settings,
  // audit logs, transaction flows, user management.
  //
  // Maintenance is village-scoped, like everything else a non-admin reaches.
  // The estate carries test villages that an admin adds and removes, and a
  // contractor has no business seeing one — still less filing a report against
  // it, which would put that account in the evidence trail for a site nobody
  // sent them to. The villages are the estate default under Settings.
  //
  // Admins are unrestricted, so the admin-only routes below (reopen, document
  // removal) are unaffected by this.
  // Viewers read; admins and engineers read and write. Decided by HTTP method
  // in requireMaintenanceAccess, so a write route added here later is closed to
  // viewers without anyone having to remember.
  router.use(requireAuth, requireMaintenanceAccess);
  if (attachScope) router.use(attachScope);

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
