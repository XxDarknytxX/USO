// src/routes/settings.js
import { Router } from "express";
import { body } from "express-validator";
import { requireAuth } from "../middleware/auth.js";

export function makeSettingsRouter(controller) {
  const router = Router();
  router.use(requireAuth);

  // GET /api/settings
  router.get("/", controller.getSettings);

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
