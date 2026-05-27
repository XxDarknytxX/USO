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

  // POST /api/users
  router.post(
    "/",
    [
      body("email").isEmail().withMessage("Valid email required"),
      body("password").isLength({ min: 6 }).withMessage("Password >= 6 chars"),
      body("name").optional().isString(),
      body("role").optional().isIn(["admin", "viewer"]).withMessage("Role must be admin or viewer"),
    ],
    controller.createUser
  );

  // PUT /api/users/:id
  router.put(
    "/:id",
    [
      param("id").isInt().withMessage("Valid user ID required"),
      body("email").optional().isEmail().withMessage("Valid email required"),
      body("password").optional().isLength({ min: 6 }).withMessage("Password >= 6 chars"),
      body("name").optional().isString(),
      body("role").optional().isIn(["admin", "viewer"]).withMessage("Role must be admin or viewer"),
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
