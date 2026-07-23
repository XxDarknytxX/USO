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
import { makeNetworkController } from "./controllers/networkController.js";
import { makeNetworkRouter } from "./routes/network.js";
import { startCollector } from "./services/networkCollector.js";
import { makeSyncScheduler } from "./services/syncScheduler.js";

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
const network = makeNetworkController(pool);

// Automatic Excel voucher sync — interval + on/off configured from the admin
// Settings page (app_settings: sync_enabled / sync_interval_minutes). Lives in
// this single VV process, so exactly one scheduler runs per deployment.
const syncScheduler = makeSyncScheduler({
  pool,
  runGuardedSync: (userId) => voucher.runGuardedSync(userId),
});
voucher.setSyncScheduler(syncScheduler);

// Routes
app.use("/api", makeAuthRouter(admin));
app.use("/api/vouchers", makeVoucherRouter(voucher));
app.use("/api/settings", makeSettingsRouter(voucher));
app.use("/api/users", makeUserRouter(admin));
app.use("/api/portal-config", makePortalConfigRouter(portalConfig));
app.use("/api/portal", makePortalRouter(portalApi));
app.use("/api/network", makeNetworkRouter(network));

// Health check (no secrets exposed)
app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Voucher Validation API listening on http://localhost:${port}`);
});

// Start the automatic voucher-sync scheduler (first run happens one interval from
// now, not on boot, so restarts/deploys don't each trigger a Ruijie export).
// Only ONE process may run it — N schedulers = N× the Ruijie export volume. In PM2
// cluster mode NODE_APP_INSTANCE is set per fork so only fork 0 arms the timer; in
// fork mode (our deploy) it's unset/"0", so this single process runs it. This makes
// the "one scheduler per deployment" guarantee code-enforced, not doc-only.
const _instanceId = process.env.NODE_APP_INSTANCE;
const _isSchedulerPrimary = _instanceId == null || String(_instanceId) === "0";
if (_isSchedulerPrimary) {
  syncScheduler.start().catch((e) => console.error("Sync scheduler failed to start:", e.message));
} else {
  console.log(`[SyncScheduler] instance ${_instanceId} is not primary — scheduler not started`);
}

// Background network-health/usage collector — DISABLED by default to conserve
// the Ruijie Cloud API quota. It polled every active village every few minutes
// (getDevices + getClients + getGatewayInterfaces + getGatewayUsage ≈ 4 calls ×
// villages × 12/hr × 24h ≈ the whole 5,000/day quota) — the dominant driver of
// the `code: 44` throttle. Device health + usage now refresh ON DEMAND: opening
// a village's Network diagram does one gated, cached live fetch (see
// networkController.getProjectHealth's cold-start fallback). Trade-off: the
// Overview dashboard's per-village status table (network_status) shows the last
// collected values until this is re-enabled.
// To re-enable later: set NETWORK_COLLECT_INTERVAL_MIN to a positive number.
const collectMin = Number(process.env.NETWORK_COLLECT_INTERVAL_MIN ?? 0);
if (collectMin > 0) startCollector(pool, { intervalMs: collectMin * 60 * 1000 });
