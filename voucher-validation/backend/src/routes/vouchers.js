// src/routes/vouchers.js
import { Router } from "express";
import { query, param, body } from "express-validator";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makeVoucherRouter(controller) {
  const router = Router();

  // All voucher routes require authentication
  router.use(requireAuth);

  // --- Static paths first (before /:uuid) ---

  // GET /api/vouchers/stats
  router.get("/stats", controller.getStats);

  // GET /api/vouchers/search?q=...&page=&limit=
  router.get(
    "/search",
    [
      query("q").optional().isString(),
      query("page").optional().isInt({ min: 1 }),
      query("limit").optional().isInt({ min: 1, max: 100 }),
    ],
    controller.searchVouchers
  );

  // GET /api/vouchers/activity?page=&limit=&eventType=&voucherUuid=&startDate=&endDate=
  router.get(
    "/activity",
    [
      query("page").optional().isInt({ min: 1 }),
      query("limit").optional().isInt({ min: 1, max: 100 }),
      query("eventType").optional().isString(),
      query("voucherUuid").optional().isString(),
      query("startDate").optional().isISO8601(),
      query("endDate").optional().isISO8601(),
    ],
    controller.getActivityLog
  );

  // GET /api/vouchers/test-connection
  router.get("/test-connection", controller.testConnection);

  // GET /api/vouchers/sync-logs
  router.get("/sync-logs", controller.getSyncLogs);

  // GET /api/vouchers/historical?page=&limit=
  router.get(
    "/historical",
    [
      query("page").optional().isInt({ min: 1 }),
      query("limit").optional().isInt({ min: 1, max: 100 }),
    ],
    controller.getHistoricalVouchers
  );

  // GET /api/vouchers/user-groups - fetch profiles from Ruijie
  router.get("/user-groups", controller.getUserGroups);

  // GET /api/vouchers - paginated list
  router.get(
    "/",
    [
      query("page").optional().isInt({ min: 1 }),
      query("limit").optional().isInt({ min: 1, max: 100 }),
      query("status").optional().isIn(["0", "1", "2", "3"]),
      query("packageName").optional().isString(),
      query("userGroupId").optional().isString(),
    ],
    controller.getVouchers
  );

  // POST /api/vouchers - create voucher (admin only)
  router.post(
    "/",
    requireAdmin,
    [
      body("user_group_id").notEmpty().withMessage("User group is required"),
      body("profile").optional().isString(),
      body("quantity").optional().isInt({ min: 1, max: 100 }),
    ],
    controller.createVoucher
  );

  // POST /api/vouchers/sync (admin only)
  router.post("/sync", requireAdmin, controller.syncVouchers);

  // POST /api/vouchers/bulk (admin only)
  router.post(
    "/bulk",
    requireAdmin,
    [
      body("action").isIn(["delete", "disable", "enable"]).withMessage("Invalid bulk action"),
      body("uuids").isArray({ min: 1 }).withMessage("uuids must be a non-empty array"),
    ],
    controller.bulkOperation
  );

  // POST /api/vouchers/restore/:uuid (admin only)
  router.post(
    "/restore/:uuid",
    requireAdmin,
    [param("uuid").notEmpty()],
    controller.restoreVoucher
  );

  // --- Dynamic paths (/:uuid) last ---

  // GET /api/vouchers/:uuid
  router.get(
    "/:uuid",
    [param("uuid").notEmpty()],
    controller.getVoucherDetail
  );

  // PUT /api/vouchers/:uuid (admin only)
  router.put(
    "/:uuid",
    requireAdmin,
    [param("uuid").notEmpty()],
    controller.updateVoucher
  );

  // DELETE /api/vouchers/:uuid (admin only)
  router.delete(
    "/:uuid",
    requireAdmin,
    [param("uuid").notEmpty()],
    controller.deleteVoucher
  );

  // PATCH /api/vouchers/:uuid/toggle (admin only)
  router.patch(
    "/:uuid/toggle",
    requireAdmin,
    [param("uuid").notEmpty()],
    controller.toggleVoucherStatus
  );

  return router;
}
