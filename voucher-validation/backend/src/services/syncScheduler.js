// src/services/syncScheduler.js
// Drives the automatic Excel voucher sync on a configurable interval.
//
// Settings live in app_settings and are edited from the admin Settings page:
//   - sync_enabled          boolean  master on/off
//   - sync_interval_minutes number   minutes between automatic syncs
// updateSetting calls reload() so changes take effect WITHOUT a service restart.
//
// A self-rescheduling setTimeout (not setInterval) is used so a long-running sync
// never overlaps the next tick and an interval change re-arms cleanly. Single-flight
// is still guaranteed by the GET_LOCK advisory lock inside runGuardedSync, so a
// manual sync + a scheduled tick can never double-run.
//
// This runs in the single voucher-validation process only (not the per-site uso
// instances), so exactly one scheduler exists per deployment.

const DEFAULT_INTERVAL_MIN = 10;
const MIN_INTERVAL_MIN = 5;    // floor — protects the Ruijie account-wide code:44 quota
const MAX_INTERVAL_MIN = 1440; // 24h ceiling

const log = (...m) => console.log(new Date().toISOString(), '[SyncScheduler]', ...m);

function clampMinutes(n) {
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MIN;
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(n)));
}

export function makeSyncScheduler({ pool, runGuardedSync }) {
  let timer = null;
  let stopped = false;
  let active = false; // true only after start() — gates arm() so a non-primary
                      // instance (whose start() was never called) never schedules,
                      // even if updateSetting triggers reload() on it.
  let enabled = true;
  let intervalMs = DEFAULT_INTERVAL_MIN * 60 * 1000;
  let nextRunAt = null;

  async function seedDefaults() {
    try {
      await pool.query(
        `INSERT IGNORE INTO app_settings (setting_key, setting_value, setting_type, description) VALUES
           ('sync_enabled', 'true', 'boolean', 'Automatically sync vouchers from Ruijie on a schedule'),
           ('sync_interval_minutes', ?, 'number', 'Minutes between automatic voucher syncs (minimum ${MIN_INTERVAL_MIN})')`,
        [String(DEFAULT_INTERVAL_MIN)]
      );
    } catch (e) { log('seedDefaults failed:', e.message); }
  }

  async function readSettings() {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('sync_enabled', 'sync_interval_minutes')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const rawEnabled = map.sync_enabled;
    const nextEnabled =
      rawEnabled == null ? true : (String(rawEnabled).toLowerCase() === 'true' || String(rawEnabled) === '1');
    const minutes = clampMinutes(Number(map.sync_interval_minutes));
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
    // Re-read each tick so a change made directly in the DB (not via updateSetting)
    // is still honored, and so a disable mid-cycle stops the next run.
    let readOk = true;
    try { ({ enabled, intervalMs } = await readSettings()); }
    catch (e) { readOk = false; log('settings read failed — skipping this run:', e.message); }

    // FAIL SAFE: only fire when the current enabled state was confirmed THIS cycle.
    // If the read failed, `enabled` may be a stale `true` after an operator disabled
    // it via a direct DB edit — so we skip the Ruijie sync (but still re-arm below).
    if (!stopped && enabled && readOk) {
      try {
        const r = await runGuardedSync(null);
        if (r?.status === 'already-running') log(`skipped — a sync (#${r.syncId ?? '?'}) is already running`);
        else if (r?.status === 'started') log(`started sync #${r.syncId}`);
        else if (r?.status === 'error') log('start error:', r.error);
      } catch (e) { log('run error:', e.message); }
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
      return { enabled, intervalMinutes: intervalMs / 60000, nextRunAt };
    },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    status() { return { enabled, intervalMinutes: intervalMs / 60000, nextRunAt }; },
  };
}
