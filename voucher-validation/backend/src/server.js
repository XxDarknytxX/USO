// src/server.js — Voucher Validation API
import "dotenv/config";
import express from "express";
import cors from "cors";
import { getPool } from "./config/db.js";
import { makeAdminController } from "./controllers/adminController.js";
import { makeVoucherController } from "./controllers/voucherController.js";
import { makeAuthRouter } from "./routes/auth.js";
import { makeVoucherRouter } from "./routes/vouchers.js";
import { makeSettingsRouter } from "./routes/settings.js";
import { makeUserRouter } from "./routes/users.js";
import { makePortalConfigController } from "./controllers/portalConfigController.js";
import { makePortalApiController } from "./controllers/portalApiController.js";
import { makePortalConfigRouter } from "./routes/portalConfig.js";
import { makePortalRouter } from "./routes/portal.js";

const app = express();

// Trust Nginx reverse proxy so req.ip reflects the real client.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const n = Number(trustProxy);
  app.set("trust proxy", Number.isFinite(n) ? n : trustProxy);
}

// CORS — allowlist from env. Blank = allow all (dev convenience only).
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length === 0
      ? true
      : (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          cb(new Error(`Origin ${origin} not allowed by CORS`));
        },
    credentials: true,
  })
);
app.use(express.json());

// Boot env check (presence only — never log secret values)
console.log("\n=== VV SERVER STARTUP ===");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("Env check:");
for (const k of [
  "RUIJIE_API_BASE_URL",
  "RUIJIE_APP_ID",
  "RUIJIE_APP_SECRET",
  "RUIJIE_GROUP_ID",
  "RUIJIE_TENANT_ID",
  "PORTAL_API_SECRET",
  "JWT_SECRET",
  "DATABASE_NAME",
]) {
  console.log(`  - ${k}: ${process.env[k] ? "SET" : "MISSING"}`);
}
console.log("=========================\n");

// DB + controllers
const pool = await getPool();
const admin = makeAdminController(pool);
const voucher = makeVoucherController(pool);
const portalConfig = makePortalConfigController(pool);
const portalApi = makePortalApiController(pool);

// Routes
app.use("/api", makeAuthRouter(admin));
app.use("/api/vouchers", makeVoucherRouter(voucher));
app.use("/api/settings", makeSettingsRouter(voucher));
app.use("/api/users", makeUserRouter(admin));
app.use("/api/portal-config", makePortalConfigRouter(portalConfig));
app.use("/api/portal", makePortalRouter(portalApi));

// Health check (no secrets exposed)
app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Voucher Validation API listening on http://localhost:${port}`);
});
