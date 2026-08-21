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
import { makeMpaisaController } from "./controllers/mpaisaController.js";
import { makeMaintenanceController } from "./controllers/maintenanceController.js";
import { makeMpaisaRouter } from "./routes/mpaisa.js";
import { makeMaintenanceRouter } from "./routes/maintenance.js";
import { collectOnceGuarded } from "./services/networkCollector.js";
import { makeNetworkCollectScheduler } from "./services/networkCollectScheduler.js";
import RuijieService from "./services/ruijieService.js";
import { makeSyncScheduler } from "./services/syncScheduler.js";
import { makeAttachScope } from "./middleware/auth.js";

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
// The M-PAiSA report upload carries a whole customer report as JSON text — give
// just that route a larger body limit. The global parser below then skips a body
// already parsed here (body-parser marks req._body once parsed).
app.use("/api/mpaisa/upload", express.json({ limit: "25mb" }));
// Maintenance photos arrive base64 in the JSON body (browser-downscaled, a few
// hundred KB each), hence the raised limit.
//
// Document uploads are explicitly exempted. express.json only parses bodies
// whose Content-Type is application/json, so a PDF body would pass through
// untouched regardless — but the exemption states the requirement rather than
// leaving it resting on that default, because the body of a document upload
// IS the file and must reach the route handler as an unread stream.
app.use("/api/maintenance", (req, res, next) => {
  const isDocUpload = req.method === "POST" && /\/documents\/?$/.test(req.path);
  return isDocUpload ? next() : express.json({ limit: "15mb" })(req, res, next);
});
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
const mpaisa = makeMpaisaController(pool);
const maintenance = makeMaintenanceController(pool);

// Automatic Excel voucher sync — interval + on/off configured from the admin
// Settings page (app_settings: sync_enabled / sync_interval_minutes). Lives in
// this single VV process, so exactly one scheduler runs per deployment.
const syncScheduler = makeSyncScheduler({
  pool,
  runGuardedSync: (userId) => voucher.runGuardedSync(userId),
});
voucher.setSyncScheduler(syncScheduler);

// Per-request village scope for the read-only viewer role (admin = unrestricted).
const attachScope = makeAttachScope(pool);

// Routes
app.use("/api", makeAuthRouter(admin));
app.use("/api/vouchers", makeVoucherRouter(voucher, attachScope));
app.use("/api/settings", makeSettingsRouter(voucher));
app.use("/api/users", makeUserRouter(admin));
app.use("/api/portal-config", makePortalConfigRouter(portalConfig, attachScope));
app.use("/api/portal", makePortalRouter(portalApi));
app.use("/api/network", makeNetworkRouter(network, attachScope));
app.use("/api/mpaisa", makeMpaisaRouter(mpaisa));
app.use("/api/maintenance", makeMaintenanceRouter(maintenance));

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

// Periodic all-villages network-health collection. This was disabled outright
// for a while: at every-5-minutes it cost ~4 Ruijie calls x ~30 villages x 288
// cycles/day, which alone exceeded the account quota and drove the `code: 44`
// throttle. It is back as a SCHEDULED job whose interval and on/off live in
// app_settings (network_collect_enabled / network_collect_interval_minutes),
// edited from the admin Settings page, with an hour floor. Daily is ~120
// calls/day (~2.4% of quota); 6-hourly ~480 (~10%).
//
// NETWORK_COLLECT_INTERVAL_MIN is no longer read — the setting replaces it.
const networkCollectScheduler = makeNetworkCollectScheduler({
  pool,
  runCollect: () => collectOnceGuarded(pool, new RuijieService()),
});
network.setCollectScheduler(networkCollectScheduler);
voucher.setNetworkCollectScheduler(networkCollectScheduler);

// Same primary-instance gate as the sync scheduler: N schedulers would mean N
// times the Ruijie call volume, which is the exact failure this job caused before.
if (_isSchedulerPrimary) {
  networkCollectScheduler
    .start()
    .catch((e) => console.error("Network collect scheduler failed to start:", e.message));
} else {
  console.log(`[NetCollect] instance ${_instanceId} is not primary — scheduler not started`);
}
