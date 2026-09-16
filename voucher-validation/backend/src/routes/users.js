// src/routes/users.js
import { Router } from "express";
import { body, param } from "express-validator";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/auth.js";

export function makeUserRouter(controller) {
  const router = Router();

  // All user management routes require auth + admin
  router.use(requireAuth, requireAdmin);

  // GET /api/users
  router.get("/", controller.listUsers);

  // Admin rescue. All of these change the account first and report whether the
  // mail went, rather than failing the whole request when SMTP is down.
  // Password reset: a one-time link, and the old password retired once it is sent.
  router.post("/:id/reset-password", controller.resetUserPassword);
  router.post("/:id/reset-2fa", controller.resetUserTwoFactor);
  // Onboarding: a one-time link to set a password. Two routes, one handler —
  // they used to differ by one of them mailing a temporary password.
  router.post("/:id/resend-onboarding", controller.resendInvite);
  router.post("/:id/invite", controller.resendInvite);
  router.delete("/:id/invite", controller.revokeInvite);

  // The roles the API will accept. MUST match the users.role enum in
  // config/db.js and the ROLES whitelist in adminController — 'engineer' was
  // missing here while the column, the middleware and the UI all had it, so
  // creating or editing one answered 400.
  const ROLES = ["admin", "viewer", "engineer"];
  const roleMsg = "Role must be admin, viewer or engineer";

  // POST /api/users
  // `password` is OPTIONAL: leaving it out is the invite path, where the
  // account is created with an unusable hash and the person sets their own
  // through a mailed link. Validated only when actually present.
  router.post(
    "/",
    [
      body("email").isEmail().withMessage("Valid email required"),
      body("password").optional({ values: "falsy" }).isLength({ min: 6 }).withMessage("Password >= 6 chars"),
      body("name").optional().isString(),
      body("role").optional().isIn(ROLES).withMessage(roleMsg),
    ],
    controller.createUser
  );

  // PUT /api/users/:id
  router.put(
    "/:id",
    [
      param("id").isInt().withMessage("Valid user ID required"),
      body("email").optional().isEmail().withMessage("Valid email required"),
      body("password").optional({ values: "falsy" }).isLength({ min: 6 }).withMessage("Password >= 6 chars"),
      body("name").optional().isString(),
      body("role").optional().isIn(ROLES).withMessage(roleMsg),
    ],
    controller.updateUser
  );

  // DELETE /api/users/:id
  router.delete(
    "/:id",
    [param("id").isInt().withMessage("Valid user ID required")],
    controller.deleteUser
  );

  return router;
}
