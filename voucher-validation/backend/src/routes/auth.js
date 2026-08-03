// src/routes/auth.js
import { Router } from "express";
import { body } from "express-validator";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makeAuthRouter(controller) {
  const router = Router();

  // Admin-only. This was previously an UNAUTHENTICATED public endpoint that also
  // trusted a client-supplied role — an anonymous admin-provisioning hole. The
  // first admin is bootstrapped via src/seed.js, not here, so gating it breaks
  // nothing. Normal account creation goes through POST /api/users (createUser).
  router.post(
    "/register",
    requireAuth,
    requireAdmin,
    [
      body("email").isEmail().withMessage("Valid email required"),
      body("password").isLength({ min: 6 }).withMessage("Password >= 6 chars"),
    ],
    controller.register
  );

  router.post(
    "/login",
    [
      body("email").isEmail().withMessage("Valid email required"),
      body("password").notEmpty().withMessage("Password required"),
    ],
    controller.login
  );

  router.get("/me", requireAuth, controller.me);
  // Per-user UI preferences — synced across the user's devices.
  router.get("/me/preferences", requireAuth, controller.getPreferences);
  router.put("/me/preferences", requireAuth, controller.savePreferences);
  router.get("/dashboard", requireAuth, controller.dashboard);

  return router;
}
