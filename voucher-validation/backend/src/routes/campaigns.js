// src/routes/campaigns.js
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

// Email campaigns reach every customer with an email on file, so the whole
// router is administrators only. Fixed paths are registered before /:id.
export function makeCampaignRouter(controller) {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get("/stats", controller.stats);
  router.get("/contacts", controller.contacts);
  router.post("/preview", controller.preview);
  router.post("/audience-count", controller.audienceCount);

  router.get("/suppressions", controller.listSuppressions);
  router.post("/suppressions", controller.addSuppression);
  router.delete("/suppressions/:email", controller.removeSuppression);

  router.get("/", controller.list);
  router.post("/", controller.create);

  router.get("/:id", controller.get);
  router.put("/:id", controller.update);
  router.delete("/:id", controller.remove);
  router.post("/:id/duplicate", controller.duplicate);
  router.post("/:id/test", controller.testSend);
  router.post("/:id/send", controller.send);
  router.post("/:id/pause", controller.pause);
  router.post("/:id/resume", controller.resume);
  router.post("/:id/cancel", controller.cancel);
  router.post("/:id/retry-failed", controller.retryFailed);
  router.get("/:id/recipients", controller.recipients);

  return router;
}
