// src/services/networkCollectScheduler.js
// Drives the periodic all-villages network-health collection on a configurable
// interval — the same shape as syncScheduler, deliberately.
//
// Settings live in app_settings and are edited from the admin Settings page:
//   - network_collect_enabled          boolean  master on/off
//   - network_collect_interval_minutes number   minutes between collections
// updateSetting calls reload() so changes take effect WITHOUT a service restart.
//
// WHY THE FLOOR IS AN HOUR AND NOT FIVE MINUTES. This job used to run every 5
// minutes and was the dominant driver of Ruijie's account-wide `code: 44`
// throttle: fetchProjectHealth costs up to 4 Ruijie calls per village, so ~30
// villages is ~120 calls per cycle. Every 5 minutes that is ~34,000 calls/day
// against a ~5,000/day quota, which is why it was switched off entirely. Daily
// is ~120/day (~2.4%); 6-hourly is ~480/day (~10%). The floor keeps a mis-typed
// interval from re-creating the outage.
//
// A self-rescheduling setTimeout (not setInterval) is used so a long collection
// never overlaps the next tick and an interval change re-arms cleanly. Overlap
// with a manual "Refresh all" is prevented by the single-flight guard in
// networkCollector.collectOnceGuarded, not by this timer.
//
// This runs in the single voucher-validation process only (not the per-site uso
// instances), so exactly one scheduler exists per deployment.

const DEFAULT_INTERVAL_MIN = 1440; // daily
const MIN_INTERVAL_MIN = 60;       // floor — protects the Ruijie code:44 quota
const MAX_INTERVAL_MIN = 10080;    // 7 days

const log = (...m) => console.log(new Date().toISOString(), '[NetCollect]', ...m);

function clampMinutes(n) {
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MIN;
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(n)));
}

export function makeNetworkCollectScheduler({ pool, runCollect }) {
  let timer = null;
  let stopped = false;
  let active = false; // true only after start() — gates arm() so a non-primary
                      // instance never schedules, even if reload() reaches it.
  let enabled = false;
  let intervalMs = DEFAULT_INTERVAL_MIN * 60 * 1000;
  let nextRunAt = null;
  let lastRun = null; // { at, ok, total, error }

  async function seedDefaults() {
    try {
      await pool.query(
        `INSERT IGNORE INTO app_settings (setting_key, setting_value, setting_type, description) VALUES
           ('network_collect_enabled', 'false', 'boolean', 'Periodically collect every village network health from Ruijie'),
           ('network_collect_interval_minutes', ?, 'number', 'Minutes between network health collections (minimum ${MIN_INTERVAL_MIN})')`,
        [String(DEFAULT_INTERVAL_MIN)]
      );
    } catch (e) { log('seedDefaults failed:', e.message); }
  }

  async function readSettings() {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key IN ('network_collect_enabled', 'network_collect_interval_minutes')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    // Defaults to OFF when the row is missing: this job spends Ruijie quota, so
    // an absent setting must never be read as consent to start polling.
    const raw = map.network_collect_enabled;
    const nextEnabled = raw == null
      ? false
      : (String(raw).toLowerCase() === 'true' || String(raw) === '1');
    const minutes = clampMinutes(Number(map.network_collect_interval_minutes));
    return { enabled: nextEnabled, intervalMs: minutes * 60 * 1000 };
  }

  function arm() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (stopped || !active || !enabled) { nextRunAt = null; return; }
    nextRunAt = Date.now() + intervalMs;
    timer = setTimeout(tick, intervalMs);
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    // Re-read each tick so a change made directly in the DB (not via
    // updateSetting) is still honoured, and a disable mid-cycle stops the next.
    let readOk = true;
    try { ({ enabled, intervalMs } = await readSettings()); }
    catch (e) { readOk = false; log('settings read failed — skipping this run:', e.message); }

    // FAIL SAFE: only spend Ruijie calls when the enabled state was confirmed
    // THIS cycle. A failed read may leave a stale `true` after an operator
    // disabled it by a direct DB edit, so skip the collection (but re-arm).
    if (!stopped && enabled && readOk) {
      try {
        const r = await runCollect();
        lastRun = { at: new Date().toISOString(), ok: r?.ok ?? null, total: r?.total ?? null, error: null };
        log(`cycle done: ${r?.ok ?? '?'}/${r?.total ?? '?'} villages`);
      } catch (e) {
        lastRun = { at: new Date().toISOString(), ok: null, total: null, error: e.message };
        log('run error:', e.message);
      }
    }
    arm();
  }

  return {
    async start() {
      active = true;
      await seedDefaults();
      try { ({ enabled, intervalMs } = await readSettings()); }
      catch (e) { log('initial settings read failed:', e.message); }
      log(`enabled=${enabled} interval=${intervalMs / 60000}min`);
      arm();
    },
    async reload() {
      try { ({ enabled, intervalMs } = await readSettings()); }
      catch (e) { log('reload read failed:', e.message); }
      log(`reloaded enabled=${enabled} interval=${intervalMs / 60000}min`);
      arm();
      return { enabled, intervalMinutes: intervalMs / 60000, nextRunAt, lastRun };
    },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    status() { return { enabled, intervalMinutes: intervalMs / 60000, nextRunAt, lastRun, minIntervalMinutes: MIN_INTERVAL_MIN }; },
  };
}
