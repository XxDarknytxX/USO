// src/routes/mpaisa.js
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export function makeMpaisaRouter(controller) {
  const router = Router();

  // Admin-only: ingest + view the M-PAiSA number→email mapping.
  router.use(requireAuth, requireAdmin);

  // The upload body (a whole customer report as JSON text) is parsed by a
  // larger-limit express.json() mounted on this path in server.js.
  router.post("/upload", controller.upload);
  router.get("/", controller.list);

  return router;
}
