// src/routes/auth.js
import { Router } from "express";
import { body } from "express-validator";
import { requireAuth, requireAdmin, requireAuthAllowing2FASetup } from "../middleware/auth.js";

export function makeAuthRouter(controller, attachScope) {
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

  /* ── Invitations ──────────────────────────────────────────────────────
     UNAUTHENTICATED by design: whoever follows an invite link has no account
     to authenticate with yet. The token in the body IS the credential and is
     verified inside the handler, the same arrangement as login-verify below.

     Neither route reveals whether a token ever existed — expired, spent and
     never-real all answer identically. */
  router.post("/invite/check", controller.checkInvite);
  router.post(
    "/invite/accept",
    [body("password").isLength({ min: 8 }).withMessage("Choose a password of at least 8 characters")],
    controller.acceptInvite
  );

  /* ── Two-factor ───────────────────────────────────────────────────────
     login-verify is UNAUTHENTICATED by design: the caller holds only a
     pending2FA token, which requireAuth rejects on purpose. The token itself
     is the credential and is verified inside the handler. */
  router.post("/2fa/login-verify", controller.loginVerify2FA);

  // Enrolment accepts the short-lived setup token as well as a full one, so a
  // user told to turn 2FA on can reach the endpoints that turn it on.
  router.post("/2fa/setup", requireAuthAllowing2FASetup, controller.setup2FA);
  router.post("/2fa/verify", requireAuthAllowing2FASetup, controller.verify2FA);
  router.get("/2fa/status", requireAuth, controller.twoFactorStatus);
  // Disabling needs a FULL session — a setup token must never be able to.
  router.post("/2fa/disable", requireAuth, controller.disable2FA);

  // The estate-wide switch.
  router.get("/2fa/policy", requireAuth, requireAdmin, controller.getTwoFactorPolicy);
  router.put("/2fa/policy", requireAuth, requireAdmin, controller.setTwoFactorPolicy);

  // Changing your own password. Allows the setup token too: an account on a
  // temporary password under a 2FA-required policy would otherwise have no way
  // to change it before enrolling.
  router.post("/me/password", requireAuthAllowing2FASetup, controller.changeOwnPassword  );

  // attachScope on this one route: /me reports which villages the account may
  // see, and that answer has to be the SAME one every other endpoint gives.
  // Resolving it a second way here is how the sidebar ends up disagreeing
  // with the dashboard.
  router.get("/me", requireAuth, ...(attachScope ? [attachScope] : []), controller.me);
  // Per-user UI preferences — synced across the user's devices.
  router.get("/me/preferences", requireAuth, controller.getPreferences);
  router.put("/me/preferences", requireAuth, controller.savePreferences);
  router.get("/dashboard", requireAuth, controller.dashboard);

  return router;
}
