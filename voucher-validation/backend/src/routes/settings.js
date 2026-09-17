// src/routes/settings.js
import { Router } from "express";
import { body } from "express-validator";
import { requireAuth, requireNotViewer, requireSuperadmin } from "../middleware/auth.js";

export function makeSettingsRouter(controller) {
  const router = Router();
  // Settings are administrators only. Admins may READ the general settings
  // and the sync status; everything that changes the console for everyone or
  // holds a credential — email (SMTP), the Starlink API account, schedules and
  // any app setting write (the estate default, receipts) — is the superadmin's.
  router.use(requireAuth, requireNotViewer);

  // GET /api/settings
  router.get("/", controller.getSettings);

  // GET /api/settings/sync-status — automatic-sync scheduler state + last sync
  router.get("/sync-status", controller.getSyncStatus);

  // SMTP (outgoing email) config. GET never returns the stored password.
  router.get("/smtp", requireSuperadmin, controller.getSmtpSettings);
  router.put("/smtp", requireSuperadmin, controller.updateSmtpSettings);
  // Send a test email using the saved config.
  router.post("/smtp/test", requireSuperadmin, controller.sendTestEmail);

  // Starlink API credentials, shared across every village. GET never returns
  // the client secret, only whether one is stored; PUT with a blank secret
  // keeps the stored one.
  router.get("/starlink", requireSuperadmin, controller.getStarlinkSettings);
  router.put("/starlink", requireSuperadmin, controller.updateStarlinkSettings);
  // Diagnose the saved Starlink config: credentials, token, then a real query.
  router.post("/starlink/test", requireSuperadmin, controller.testStarlinkSettings);

  // PUT /api/settings/sync — atomically set the sync schedule (enabled + interval)
  router.put(
    "/sync",
    requireSuperadmin,
    [
      body("enabled").isBoolean().withMessage("enabled must be a boolean"),
      body("intervalMinutes").isNumeric().withMessage("intervalMinutes must be a number"),
    ],
    controller.updateSyncSettings
  );

  // PUT /api/settings/network-collect — atomically set the network-health
  // collection schedule (enabled + interval).
  router.put(
    "/network-collect",
    requireSuperadmin,
    [
      body("enabled").isBoolean().withMessage("enabled must be a boolean"),
      body("intervalMinutes").isNumeric().withMessage("intervalMinutes must be a number"),
    ],
    controller.updateNetworkCollectSettings
  );

  // PUT /api/settings
  router.put(
    "/",
    requireSuperadmin,
    [
      body("key").notEmpty().withMessage("Setting key is required"),
      body("value").exists().withMessage("Setting value is required"),
    ],
    controller.updateSetting
  );

  return router;
}
