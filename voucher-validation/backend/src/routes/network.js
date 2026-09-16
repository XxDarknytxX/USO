// src/routes/network.js
import { Router } from "express";
import { body, param } from "express-validator";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makeNetworkRouter(controller, attachScope) {
  const router = Router();

  // All network-monitoring routes require authentication.
  router.use(requireAuth);
  // Village scope so viewers only ever see their assigned villages' projects,
  // overview rows, trend, and per-project health.
  if (attachScope) router.use(attachScope);

  // Projects (any authenticated user can view)
  router.get("/projects", controller.listProjects);

  // All-villages overview dashboard (from collector snapshots)
  router.get("/overview", controller.getOverview);

  // Time-bucketed trend (clients / usage / uptime) for dashboards
  router.get("/overview/history", controller.getTrend);

  // Refresh every village's health now (admin). Spends Ruijie quota, so it is
  // admin-only and single-flighted in the collector.
  router.post("/collect", requireAdmin, controller.collectNow);
  // Scheduler state for the Settings page.
  router.get("/collect/status", requireAdmin, controller.collectStatus);

  // Starlink native telemetry — the poller that decides whether a village is
  // online. Status reports coverage as well as liveness, because a village with
  // no resolved device id silently falls back to the Ruijie signal.
  router.get("/telemetry/status", requireAdmin, controller.telemetryStatus);
  router.post("/telemetry/poll", requireAdmin, controller.telemetryPollNow);
  router.post("/telemetry/reload", requireAdmin, controller.telemetryReload);

  // Per-village Starlink data usage. One live Starlink call per village, so the
  // manual refresh is admin-only and single-flighted in the collector.
  router.get("/starlink/usage/status", requireAdmin, controller.usageStatus);
  router.post("/starlink/usage/collect", requireAdmin, controller.usageCollectNow);
  router.post("/starlink/usage/reload", requireAdmin, controller.usageReload);

  // Discover Ruijie network groups for the "add site" picker (admin)
  router.get("/discover", requireAdmin, controller.discoverGroups);

  // Project management is admin-only
  router.post(
    "/projects",
    requireAdmin,
    [body("name").notEmpty().withMessage("Project name is required")],
    controller.createProject
  );
  router.put(
    "/projects/:id",
    requireAdmin,
    [param("id").isInt()],
    controller.updateProject
  );
  router.delete(
    "/projects/:id",
    requireAdmin,
    [param("id").isInt()],
    controller.deleteProject
  );

  // Per-village Starlink data usage (cached; see services/starlinkService.js)
  router.get(
    "/projects/:id/starlink",
    [param("id").isInt().withMessage("id must be an integer")],
    controller.getProjectStarlink
  );

  // Per-project device health + topology
  router.get(
    "/projects/:id/health",
    [param("id").isInt()],
    controller.getProjectHealth
  );

  return router;
}
