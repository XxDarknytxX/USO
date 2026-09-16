// src/services/starlinkTelemetry.js
// Starlink native telemetry — the source of truth for whether a village has
// internet.
//
// WHY THIS REPLACED THE RUIJIE SIGNAL. "Online" used to mean the Ruijie gateway
// said its WAN was up. That is the LOCAL link, one layer below the thing we
// actually care about: the Starlink dish is the internet, and a village whose
// dish is dark has no service no matter what the gateway reports. Telemetry
// answers that question directly.
//
// It also replaces the daily data-usage signal we considered first, which could
// not do the job: normalizeCycle zero-fills days[] across the whole billing
// cycle, so "the dish reported 0.00 GB" and "the dish reported nothing" are the
// same row, and the granularity is a UTC day against a Fiji (UTC+12) clock.
// Telemetry is per-sample and unambiguous — a dead dish simply stops appearing.
//
// THE COST SHAPE IS THE WHOLE REASON THIS IS AFFORDABLE. The stream is
// ACCOUNT-WIDE, not per-device: one POST returns rows for every dish on the
// account and we demultiplex by DeviceId. Thirty-one villages cost exactly what
// one village costs. Contrast getUsage() in starlinkService.js, which is one
// live call PER SERVICE LINE.
//
// Ported from the Starlink Portal's telemetryPoller.js, which has been running
// this call in production against the same API. The column mapping, the
// columnar parse and the per-batch averaging are its logic; the persistence,
// the settings-driven lifecycle and the per-village resolution are ours.

import * as starlink from "./starlinkService.js";

/* ------------------------------------------------------------------ tuning */

// The stream long-polls: maxLingerMs is how long Starlink will hold the request
// open waiting for data, so a 15s linger polled every 15s is a near-continuous
// consumer rather than 4 wasted round trips a minute. This is the cadence the
// production portal runs.
const LINGER_MS = 15_000;
const BATCH_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 45_000; // must exceed LINGER_MS or every poll times out

// One row per device per poll. Thirty-one dishes at 15s is ~180k rows/day, so
// history is kept short — this data answers "is it up" and "how has the link
// behaved lately", not "what happened last quarter".
const RETENTION_DAYS = 14;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// Starlink's CamelCase stream columns → our snake_case storage.
const COLUMNS = {
  UtcTimestampNs: "ts_ns",
  DownlinkThroughput: "downlink",
  UplinkThroughput: "uplink",
  PingLatencyMsAvg: "latency_ms",
  PingDropRateAvg: "drop_rate",
  SignalQuality: "signal_quality",
  ObstructionPercentTime: "obstruction_pct",
  Uptime: "uptime_seconds",
};

const log = (...m) => console.log(new Date().toISOString(), "[Telemetry]", ...m);

/* ------------------------------------------------------------------- parse */

/**
 * Starlink returns a COLUMNAR response: a column-name list per device type, and
 * a flat array of rows whose first element is the device type. Only
 * UserTerminal ("u") rows are dishes; the account also streams router ("r")
 * rows we have no use for.
 *
 * Returns [{ deviceId, point }].
 */
export function parseStreamResponse(body) {
  const columnsByType = body?.data?.columnNamesByDeviceType;
  const values = body?.data?.values;
  if (!columnsByType || !Array.isArray(values) || !values.length) return [];

  const uColumns = columnsByType.u || [];
  const idx = {};
  for (const [starlinkName, ourName] of Object.entries(COLUMNS)) {
    const i = uColumns.indexOf(starlinkName);
    if (i !== -1) idx[ourName] = i;
  }

  const deviceIdIdx = uColumns.indexOf("DeviceId");
  if (deviceIdIdx === -1) {
    log("no DeviceId column in the stream response — cannot attribute rows");
    return [];
  }

  const out = [];
  let shortRows = 0;
  for (const row of values) {
    if (row[0] !== "u") continue; // device type is always column 0
    // A row shorter than the column list would shift every value left — uptime
    // landing in obstruction, and so on — and we would persist it as fact and
    // then decide a village's online state from it. Drop it instead.
    if (row.length < uColumns.length) {
      shortRows++;
      continue;
    }
    const deviceId = row[deviceIdIdx];
    if (!deviceId) continue;
    const point = {};
    for (const [name, i] of Object.entries(idx)) point[name] = row[i];
    out.push({ deviceId, point });
  }
  if (shortRows) log(`dropped ${shortRows} malformed row(s) shorter than the column list`);
  return out;
}

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const mean = (xs) => {
  const ok = xs.map(num).filter((v) => v != null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

/* ----------------------------------------------------------------- persist */

/**
 * Collapses a batch to one row per device and writes it, then refreshes the
 * per-device latest row the dashboard reads.
 *
 * The latest table exists so the overview does not have to run a correlated
 * MAX(recorded_at) per village on a table with millions of rows; it is a
 * derived convenience and can be rebuilt from the history at any time.
 */
async function persist(pool, parsed) {
  if (!parsed.length) return 0;

  const byDevice = new Map();
  for (const { deviceId, point } of parsed) {
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
    byDevice.get(deviceId).push(point);
  }

  const now = new Date();
  const rows = [];
  for (const [deviceId, points] of byDevice) {
    rows.push([
      deviceId,
      now,
      mean(points.map((p) => p.downlink)),
      mean(points.map((p) => p.uplink)),
      mean(points.map((p) => p.latency_ms)),
      mean(points.map((p) => p.drop_rate)),
      mean(points.map((p) => p.signal_quality)),
      mean(points.map((p) => p.obstruction_pct)),
      mean(points.map((p) => p.uptime_seconds)),
      points.length,
    ]);
  }

  await pool.query(
    `INSERT INTO starlink_telemetry
       (device_id, recorded_at, downlink_mbps, uplink_mbps, latency_ms,
        drop_rate, signal_quality, obstruction_pct, uptime_seconds, sample_count)
     VALUES ?`,
    [rows]
  );

  // Upserted one device at a time: a multi-row VALUES ? with ON DUPLICATE KEY
  // is fine in MySQL, but this loop is 31 statements at most and reads far more
  // plainly than the VALUES() aliasing the multi-row form needs.
  for (const r of rows) {
    await pool.query(
      `INSERT INTO starlink_device_latest
         (device_id, last_seen_at, downlink_mbps, uplink_mbps, latency_ms,
          drop_rate, signal_quality, obstruction_pct, uptime_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_seen_at = VALUES(last_seen_at),
         downlink_mbps = VALUES(downlink_mbps),
         uplink_mbps = VALUES(uplink_mbps),
         latency_ms = VALUES(latency_ms),
         drop_rate = VALUES(drop_rate),
         signal_quality = VALUES(signal_quality),
         obstruction_pct = VALUES(obstruction_pct),
         uptime_seconds = VALUES(uptime_seconds)`,
      [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]]
    );
  }
  return rows.length;
}

/* -------------------------------------------------------------- resolution */

// A telemetry DeviceId looks like "ut5030988e-8610251b-d8c1116b".
const DEVICE_ID_RE = /^ut[0-9a-f]{6,}/i;
const DEVICE_ID_ANYWHERE = /\but[0-9a-f]{6,}(?:-[0-9a-f]+)*\b/i;

/**
 * Finds the `ut…` device id for a village from whatever the admin typed.
 *
 * An admin knows a village by its kit, not by a telemetry device id, and
 * nothing in this system — or in the Starlink Portal, whose admin types the
 * device id in by hand — maps one to the other. So rather than depend on a
 * field name nobody has confirmed, this SCANS the service-line record for any
 * value SHAPED like a device id. That works whichever field carries it, and
 * keeps working if Starlink renames it.
 *
 * Returns the device id, or null if it could not be resolved. Never throws.
 */
export async function resolveDeviceId(pool, project) {
  // 1. Already resolved.
  if (project.starlink_device_id && DEVICE_ID_RE.test(project.starlink_device_id)) {
    return project.starlink_device_id;
  }
  // 2. The admin pasted a device id into the kit field. Accept it.
  const typed = String(project.starlink_kit_id || "").trim();
  if (DEVICE_ID_RE.test(typed)) return typed;

  // 3. Ask Starlink about the service line and look for a device-id-shaped
  //    value anywhere in the record.
  const line = project.starlink_service_line_number;
  if (!line) return null;
  try {
    const cfg = await starlink.loadConfig(pool);
    if (!cfg) return null;
    const token = await starlink.getAccessToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/+$/, "");
    const body = await starlink.starlinkRequest(
      `${base}/v2/service-lines/${encodeURIComponent(line)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, timeoutMs: 30000 }
    );
    const match = JSON.stringify(body ?? {}).match(DEVICE_ID_ANYWHERE);
    if (match) {
      log(`resolved ${project.name}: ${line} → ${match[0]}`);
      return match[0];
    }
    log(`no device id found in the service-line record for ${project.name} (${line})`);
  } catch (e) {
    log(`resolve failed for ${project.name}:`, starlink.describeError(e));
  }
  return null;
}

/**
 * Fills in starlink_device_id for every village that has a kit or service line
 * but no resolved device id yet. Cheap and idempotent — villages already
 * resolved cost nothing.
 */
export async function resolveAllDeviceIds(pool) {
  const [projects] = await pool.query(
    `SELECT id, name, starlink_service_line_number, starlink_device_id, starlink_kit_id
       FROM network_projects
      WHERE is_active = 1
        AND (starlink_service_line_number IS NOT NULL OR starlink_kit_id IS NOT NULL)`
  );
  let resolved = 0;
  for (const p of projects) {
    if (p.starlink_device_id && DEVICE_ID_RE.test(p.starlink_device_id)) continue;
    const id = await resolveDeviceId(pool, p);
    if (!id) continue;
    await pool.query("UPDATE network_projects SET starlink_device_id = ? WHERE id = ?", [id, p.id]);
    resolved++;
  }
  if (resolved) log(`resolved ${resolved} device id(s)`);
  return { checked: projects.length, resolved };
}

/* ------------------------------------------------------------------ poller */

export function makeTelemetryPoller({ pool }) {
  let timer = null;
  let cleanupTimer = null;
  let stopped = false;
  let active = false;
  let enabled = false;
  let polling = false;

  let lastPollAt = null;
  let lastPersistAt = null;
  let totalPersisted = 0;
  let consecutiveErrors = 0;
  let lastError = null;
  let devicesSeen = 0;

  async function seedDefaults() {
    try {
      await pool.query(
        `INSERT IGNORE INTO app_settings (setting_key, setting_value, setting_type, description) VALUES
           ('starlink_telemetry_enabled', 'false', 'boolean', 'Poll Starlink native telemetry — drives whether a village counts as online')`
      );
    } catch (e) {
      log("seedDefaults failed:", e.message);
    }
  }

  async function readEnabled() {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'starlink_telemetry_enabled'"
    );
    const raw = rows[0]?.setting_value;
    // Absent means OFF. This opens a continuous session against Starlink, so a
    // missing row must never be read as consent to start.
    if (raw == null) return false;
    return String(raw).toLowerCase() === "true" || String(raw) === "1";
  }

  /** One stream read. Returns the number of device rows written. */
  async function pollOnce() {
    if (polling) return 0;
    polling = true;
    try {
      const cfg = await starlink.loadConfig(pool);
      if (!cfg) {
        lastError = "Starlink is not configured or is disabled in Settings";
        return 0;
      }
      const token = await starlink.getAccessToken(cfg);
      const base = String(cfg.api_base_url).replace(/\/+$/, "");
      const body = await starlink.starlinkRequest(`${base}/v2/telemetry/stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ batchSize: BATCH_SIZE, maxLingerMs: LINGER_MS }),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      const parsed = parseStreamResponse(body);
      lastPollAt = new Date();
      consecutiveErrors = 0;
      lastError = null;
      if (!parsed.length) return 0;

      const written = await persist(pool, parsed);
      devicesSeen = written;
      totalPersisted += written;
      lastPersistAt = new Date();
      return written;
    } catch (e) {
      consecutiveErrors++;
      lastError = starlink.describeError(e);
      log(`poll failed (${consecutiveErrors} in a row):`, lastError);
      return 0;
    } finally {
      polling = false;
    }
  }

  async function cleanup() {
    try {
      const [r] = await pool.query(
        "DELETE FROM starlink_telemetry WHERE recorded_at < NOW() - INTERVAL ? DAY",
        [RETENTION_DAYS]
      );
      if (r.affectedRows) log(`pruned ${r.affectedRows} rows older than ${RETENTION_DAYS} days`);
    } catch (e) {
      log("cleanup failed:", e.message);
    }
  }

  /**
   * Self-rescheduling rather than setInterval: the stream call blocks for up to
   * LINGER_MS, so a fixed interval would stack overlapping requests whenever
   * Starlink held one open longer than expected. Backs off on repeated failure
   * so a credential or outage problem does not hammer the API.
   */
  function arm(delayMs) {
    if (timer) clearTimeout(timer);
    if (stopped || !active || !enabled) {
      timer = null;
      return;
    }
    timer = setTimeout(tick, delayMs);
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    // Re-read each tick so an operator disabling it takes effect within one
    // cycle, even when changed directly in the database.
    let readOk = true;
    try {
      enabled = await readEnabled();
    } catch (e) {
      readOk = false;
      log("settings read failed — skipping this poll:", e.message);
    }
    if (!stopped && enabled && readOk) await pollOnce();
    // 15s normally; on a run of failures back off to a minute, capped, so a bad
    // credential costs four calls a minute instead of four a second.
    const backoff = consecutiveErrors >= 3 ? Math.min(60_000, 15_000 * consecutiveErrors) : 0;
    arm(Math.max(1_000, backoff || LINGER_MS));
  }

  return {
    async start() {
      active = true;
      await seedDefaults();
      try {
        enabled = await readEnabled();
      } catch (e) {
        log("initial settings read failed:", e.message);
      }
      log(`enabled=${enabled} linger=${LINGER_MS / 1000}s retention=${RETENTION_DAYS}d`);
      if (enabled) {
        // Resolve device ids once at startup so a freshly-entered kit becomes
        // usable without waiting for an admin to press anything.
        resolveAllDeviceIds(pool).catch((e) => log("startup resolve failed:", e.message));
      }
      cleanup();
      cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
      arm(1_000);
    },
    async reload() {
      try {
        enabled = await readEnabled();
      } catch (e) {
        log("reload read failed:", e.message);
      }
      log(`reloaded enabled=${enabled}`);
      if (enabled) resolveAllDeviceIds(pool).catch(() => {});
      arm(1_000);
      return this.status();
    },
    /** Manual "poll now", for the Settings page. */
    async pollNow() {
      await resolveAllDeviceIds(pool).catch(() => {});
      const written = await pollOnce();
      return { written, ...this.status() };
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (cleanupTimer) clearInterval(cleanupTimer);
      timer = cleanupTimer = null;
    },
    status() {
      return {
        enabled,
        running: timer !== null,
        lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
        lastPersistAt: lastPersistAt ? lastPersistAt.toISOString() : null,
        devicesSeen,
        totalPersisted,
        consecutiveErrors,
        lastError,
        lingerSeconds: LINGER_MS / 1000,
        retentionDays: RETENTION_DAYS,
      };
    },
  };
}
