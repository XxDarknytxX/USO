// src/routes/settings.js
import { Router } from "express";
import { body } from "express-validator";
import { requireAuth, requireNotViewer } from "../middleware/auth.js";

export function makeSettingsRouter(controller) {
  const router = Router();
  // Settings are staff-only; the read-only viewer role has no business here
  // (reading or writing the sync schedule / app settings).
  router.use(requireAuth, requireNotViewer);

  // GET /api/settings
  router.get("/", controller.getSettings);

  // GET /api/settings/sync-status — automatic-sync scheduler state + last sync
  router.get("/sync-status", controller.getSyncStatus);

  // SMTP (outgoing email) config. GET never returns the stored password.
  router.get("/smtp", controller.getSmtpSettings);
  router.put("/smtp", controller.updateSmtpSettings);
  // Send a test email using the saved config.
  router.post("/smtp/test", controller.sendTestEmail);

  // Starlink API credentials, shared across every village. GET never returns
  // the client secret, only whether one is stored; PUT with a blank secret
  // keeps the stored one.
  router.get("/starlink", controller.getStarlinkSettings);
  router.put("/starlink", controller.updateStarlinkSettings);

  // PUT /api/settings/sync — atomically set the sync schedule (enabled + interval)
  router.put(
    "/sync",
    [
      body("enabled").isBoolean().withMessage("enabled must be a boolean"),
      body("intervalMinutes").isNumeric().withMessage("intervalMinutes must be a number"),
    ],
    controller.updateSyncSettings
  );

  // PUT /api/settings
  router.put(
    "/",
    [
      body("key").notEmpty().withMessage("Setting key is required"),
      body("value").exists().withMessage("Setting value is required"),
    ],
    controller.updateSetting
  );

  return router;
}
