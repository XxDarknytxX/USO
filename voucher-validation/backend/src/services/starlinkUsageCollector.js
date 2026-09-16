// src/services/starlinkUsageCollector.js
// Background job: pull each village's current-cycle Starlink data usage and
// store it in starlink_status, so the Overview meter and the Dashboard's
// "Starlink data" column read one indexed row instead of calling Starlink.
//
// WHY THIS IS SEPARATE FROM THE TELEMETRY POLLER. Telemetry answers "is the
// dish up" and arrives on an account-wide stream — one call covers every
// village. Usage answers "how much has it carried this cycle" and is a
// per-service-line request: getUsage() is one live call PER VILLAGE, with no
// cache (starlinkService.js is explicit about this — it polls the same way the
// Starlink app does). So the two jobs have completely different cost shapes and
// completely different sensible cadences, and collapsing them into one would
// mean either polling usage every 15 seconds or checking liveness once a day.
//
// COST: 1 token exchange (shared, cached) + 1 call per village per cycle. Daily
// over ~31 villages is ~31 calls/day, which is nothing. There is no reason to
// run it often: a billing cycle moves slowly and the figure is a running total.
//
// Spacing between villages is deliberate. starlinkService has no limiter and no
// circuit breaker — 31 back-to-back requests is rude to an API we do not own,
// and this job is never in a hurry.

import * as starlink from "./starlinkService.js";

const SPACING_MS = 750;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString(), "[StarlinkUsage]", ...m);

const round3 = (n) => (n == null ? null : Math.round(Number(n) * 1000) / 1000);
const dateOnly = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

let _collecting = false;
export const isCollectingUsage = () => _collecting;

/**
 * One pass over every active village that has a service line.
 *
 * A village's failure is recorded and stepped over, never thrown: one expired
 * subscription or one timeout must not cost the other thirty their refresh.
 * fetch_ok is what keeps "the dish reported nothing" distinguishable from "we
 * could not reach Starlink" — without it an API outage would look like thirty
 * villages using no data.
 */
export async function collectUsageOnce(pool) {
  const cfg = await starlink.loadConfig(pool);
  if (!cfg) {
    log("Starlink is not configured or is disabled — nothing to collect");
    return { ok: 0, total: 0, skipped: "not configured" };
  }

  const [projects] = await pool.query(
    `SELECT id, name, starlink_service_line_number
       FROM network_projects
      WHERE is_active = 1 AND starlink_service_line_number IS NOT NULL
      ORDER BY sort_order, name`
  );
  if (!projects.length) {
    log("no village has a Starlink service line number set");
    return { ok: 0, total: 0 };
  }

  let ok = 0;
  for (const p of projects) {
    const line = p.starlink_service_line_number;
    try {
      // getServiceLine is cheap and tells us whether the line is even active;
      // a suspended line explains an empty usage response that would otherwise
      // look like a fault.
      const [usageRes, lineRes] = await Promise.allSettled([
        starlink.getUsage(cfg, line),
        starlink.getServiceLine(cfg, line),
      ]);

      if (usageRes.status !== "fulfilled") {
        const detail = starlink.describeError(usageRes.reason);
        await writeRow(pool, p.id, line, null, null, false, detail);
        log(`${p.name}: usage failed — ${detail}`);
        continue;
      }

      const cycle = usageRes.value?.cycles?.[0] || null;
      const meta = lineRes.status === "fulfilled" ? lineRes.value : null;
      await writeRow(pool, p.id, line, cycle, meta, true, usageRes.value?.reason || null);
      ok++;
      const t = cycle?.totals;
      log(
        `${p.name}: ${t ? `${t.totalUsed} GB used, cap ${t.baseCap} (${cycle.capSource})` : "no cycle data"}`
      );
    } catch (e) {
      const detail = starlink.describeError(e);
      await writeRow(pool, p.id, line, null, null, false, detail).catch(() => {});
      log(`${p.name}: ${detail}`);
    }
    await sleep(SPACING_MS);
  }

  log(`cycle done: ${ok}/${projects.length} villages`);
  return { ok, total: projects.length };
}

async function writeRow(pool, projectId, line, cycle, meta, fetchOk, errorText) {
  const t = cycle?.totals || {};
  // The allowance is base + any top-up blocks bought on top. Zero means
  // Starlink published no cap for this cycle, which the UI renders as "no cap"
  // rather than as a limit of nothing.
  const allowance =
    cycle == null ? null : round3((Number(t.baseCap) || 0) + (Number(t.topCap) || 0));
  // Metered consumption only — standardUsed is uncapped, so including it would
  // let used/allowance exceed 1 on a village that never touched its cap.
  const metered =
    cycle == null ? null : round3((Number(t.baseUsed) || 0) + (Number(t.topUsed) || 0));

  await pool.query(
    `INSERT INTO starlink_status
       (project_id, service_line_number, total_used_gb, metered_gb, allowance_gb,
        standard_used_gb, cap_source, cycle_start, cycle_end, line_active,
        nickname, fetch_ok, error_text, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       service_line_number = VALUES(service_line_number),
       total_used_gb = VALUES(total_used_gb),
       metered_gb = VALUES(metered_gb),
       allowance_gb = VALUES(allowance_gb),
       standard_used_gb = VALUES(standard_used_gb),
       cap_source = VALUES(cap_source),
       cycle_start = VALUES(cycle_start),
       cycle_end = VALUES(cycle_end),
       line_active = VALUES(line_active),
       nickname = VALUES(nickname),
       fetch_ok = VALUES(fetch_ok),
       error_text = VALUES(error_text),
       checked_at = NOW()`,
    [
      projectId,
      line,
      cycle == null ? null : round3(t.totalUsed),
      metered,
      allowance,
      cycle == null ? null : round3(t.standardUsed),
      cycle?.capSource || null,
      dateOnly(cycle?.startDate),
      dateOnly(cycle?.endDate),
      meta?.active == null ? null : meta.active ? 1 : 0,
      meta?.nickname || null,
      fetchOk ? 1 : 0,
      errorText ? String(errorText).slice(0, 500) : null,
    ]
  );
}

/** Single-flighted, so a manual refresh landing on a scheduled tick joins it. */
export async function collectUsageGuarded(pool) {
  if (_collecting) {
    log("already collecting — joining the run in progress");
    return { ok: null, total: null, joined: true };
  }
  _collecting = true;
  try {
    return await collectUsageOnce(pool);
  } finally {
    _collecting = false;
  }
}

/* ------------------------------------------------------------------ schedule */

const DEFAULT_INTERVAL_MIN = 720; // twice a day — a billing total moves slowly
const MIN_INTERVAL_MIN = 60;
const MAX_INTERVAL_MIN = 10080;

const clamp = (n) =>
  !Number.isFinite(n)
    ? DEFAULT_INTERVAL_MIN
    : Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(n)));

/**
 * Mirrors makeNetworkCollectScheduler: settings in app_settings, a
 * self-rescheduling timeout so a slow run never overlaps the next tick, and a
 * re-read each tick so a change takes effect without a restart.
 */
export function makeStarlinkUsageScheduler({ pool }) {
  let timer = null;
  let stopped = false;
  let active = false;
  let enabled = false;
  let intervalMs = DEFAULT_INTERVAL_MIN * 60 * 1000;
  let nextRunAt = null;
  let lastRun = null;

  async function seedDefaults() {
    try {
      await pool.query(
        `INSERT IGNORE INTO app_settings (setting_key, setting_value, setting_type, description) VALUES
           ('starlink_usage_enabled', 'false', 'boolean', 'Collect per-village Starlink data usage for the dashboard'),
           ('starlink_usage_interval_minutes', ?, 'number', 'Minutes between Starlink usage collections (minimum ${MIN_INTERVAL_MIN})')`,
        [String(DEFAULT_INTERVAL_MIN)]
      );
    } catch (e) {
      log("seedDefaults failed:", e.message);
    }
  }

  async function readSettings() {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key IN ('starlink_usage_enabled', 'starlink_usage_interval_minutes')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const raw = map.starlink_usage_enabled;
    // Absent means OFF — this spends calls against an API we do not own, so a
    // missing row must never be read as consent.
    const on = raw == null ? false : String(raw).toLowerCase() === "true" || String(raw) === "1";
    return { enabled: on, intervalMs: clamp(Number(map.starlink_usage_interval_minutes)) * 60000 };
  }

  function arm() {
    if (timer) clearTimeout(timer);
    if (stopped || !active || !enabled) {
      timer = null;
      nextRunAt = null;
      return;
    }
    nextRunAt = Date.now() + intervalMs;
    timer = setTimeout(tick, intervalMs);
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    let readOk = true;
    try {
      ({ enabled, intervalMs } = await readSettings());
    } catch (e) {
      readOk = false;
      log("settings read failed — skipping this run:", e.message);
    }
    if (!stopped && enabled && readOk) {
      try {
        const r = await collectUsageGuarded(pool);
        lastRun = { at: new Date().toISOString(), ok: r.ok, total: r.total, error: null };
      } catch (e) {
        lastRun = { at: new Date().toISOString(), ok: null, total: null, error: e.message };
        log("run error:", e.message);
      }
    }
    arm();
  }

  return {
    async start() {
      active = true;
      await seedDefaults();
      try {
        ({ enabled, intervalMs } = await readSettings());
      } catch (e) {
        log("initial settings read failed:", e.message);
      }
      log(`enabled=${enabled} interval=${intervalMs / 60000}min`);
      // First run shortly after boot rather than one full interval later: an
      // empty dashboard for twelve hours after enabling is not a useful state.
      if (enabled) setTimeout(() => collectUsageGuarded(pool).catch(() => {}), 20_000);
      arm();
    },
    async reload() {
      try {
        ({ enabled, intervalMs } = await readSettings());
      } catch (e) {
        log("reload read failed:", e.message);
      }
      log(`reloaded enabled=${enabled} interval=${intervalMs / 60000}min`);
      arm();
      return this.status();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    status() {
      return {
        enabled,
        intervalMinutes: intervalMs / 60000,
        minIntervalMinutes: MIN_INTERVAL_MIN,
        nextRunAt,
        lastRun,
        collecting: _collecting,
      };
    },
  };
}
