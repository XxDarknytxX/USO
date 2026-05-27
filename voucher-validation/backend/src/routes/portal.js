// src/routes/portal.js
// Public API routes called by USO Portal (shared-secret auth)
import { Router } from "express";
import { requirePortalSecret } from "../middleware/portalAuth.js";

export function makePortalRouter(controller) {
  const router = Router();

  // All portal API routes require shared-secret authentication
  router.use(requirePortalSecret);

  // Plan data for USO Portal frontend
  router.get("/plans", controller.getPortalPlans);
  router.get("/categories", controller.getPortalCategories);

  // Voucher claim/release lifecycle
  router.post("/claim-voucher", controller.claimVoucher);
  router.post("/release-voucher", controller.releaseVoucher);
  router.post("/mark-used", controller.markVoucherUsed);

  // Voucher usage status (for user-facing status page)
  router.get("/voucher-status/:voucherCode", controller.getVoucherStatus);

  // Audit log ingestion
  router.post("/audit-log", controller.ingestAuditLog);

  return router;
}
