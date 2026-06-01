// src/routes/network.js
import { Router } from "express";
import { body, param } from "express-validator";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makeNetworkRouter(controller) {
  const router = Router();

  // All network-monitoring routes require authentication.
  router.use(requireAuth);

  // Projects (any authenticated user can view)
  router.get("/projects", controller.listProjects);

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

  // Per-project device health + topology
  router.get(
    "/projects/:id/health",
    [param("id").isInt()],
    controller.getProjectHealth
  );

  return router;
}
