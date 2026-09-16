/**
 * starlink-control.mjs — turn the Starlink jobs on or off, and see where they
 * stand. Uses the app's own database credentials from .env, so there is no
 * password to type and no chance of pasting one wrong.
 *
 *   node scripts/starlink-control.mjs                  status only
 *   node scripts/starlink-control.mjs on               both jobs on
 *   node scripts/starlink-control.mjs off              both jobs off
 *   node scripts/starlink-control.mjs on telemetry     just the liveness poller
 *   node scripts/starlink-control.mjs on usage         just the data collector
 *
 * Changing a setting here does NOT restart anything: both jobs re-read their
 * setting on their own next tick, and the server exposes reload endpoints. A
 * pm2 restart is the fastest way to see the change immediately.
 *
 * The two jobs are separate on purpose. Telemetry is ONE account-wide stream
 * answering "is the dish up", polled continuously. Usage is one live request
 * PER SERVICE LINE answering "how much has it carried this cycle". Different
 * costs, different cadences, different switches.
 */

import { openPool } from "./_db.mjs";

const KEYS = {
  telemetry: "starlink_telemetry_enabled",
  usage: "starlink_usage_enabled",
};

const [, , action, which] = process.argv;

function usage(msg) {
  if (msg) console.error(`\n${msg}`);
  console.error(
    "\nUsage:\n" +
      "  node scripts/starlink-control.mjs                 show status\n" +
      "  node scripts/starlink-control.mjs on|off          both jobs\n" +
      "  node scripts/starlink-control.mjs on|off telemetry\n" +
      "  node scripts/starlink-control.mjs on|off usage\n"
  );
  process.exit(msg ? 1 : 0);
}

const pool = openPool();

try {
  if (action && !["on", "off", "status"].includes(action)) usage(`Unknown action "${action}".`);
  if (which && !KEYS[which]) usage(`Unknown job "${which}". Use telemetry or usage.`);

  if (action === "on" || action === "off") {
    const targets = which ? [which] : Object.keys(KEYS);
    const value = action === "on" ? "true" : "false";
    for (const t of targets) {
      // INSERT … ON DUPLICATE so this works before the server has ever seeded
      // the row, which is the state right after a first deploy.
      await pool.query(
        `INSERT INTO app_settings (setting_key, setting_value, setting_type, description)
         VALUES (?, ?, 'boolean', 'Starlink job toggle')
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [KEYS[t], value]
      );
      console.log(`${t.padEnd(10)} -> ${value}`);
    }
    console.log("");
  }

  /* ----------------------------------------------------------------- status */

  const [settings] = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)`,
    [KEYS.telemetry, KEYS.usage]
  );
  const map = Object.fromEntries(settings.map((r) => [r.setting_key, r.setting_value]));
  const on = (k) => {
    const v = map[k];
    if (v == null) return "not set (treated as OFF)";
    return String(v).toLowerCase() === "true" || String(v) === "1" ? "ON" : "OFF";
  };

  console.log("SETTINGS");
  console.log(`  telemetry (is the dish up)        ${on(KEYS.telemetry)}`);
  console.log(`  usage (how much has it carried)   ${on(KEYS.usage)}`);

  // Coverage: a village with no device id silently falls back to the Ruijie
  // signal, which is the single most common reason for "no telemetry".
  const [[cov]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(starlink_device_id IS NOT NULL OR starlink_kit_id IS NOT NULL) AS identified,
            SUM(starlink_service_line_number IS NOT NULL) AS lined,
            SUM(starlink_device_id LIKE 'ut%') AS canonical
       FROM network_projects WHERE is_active = 1`
  );
  console.log("\nCOVERAGE");
  console.log(`  active villages                   ${cov.total}`);
  console.log(`  with a kit / device id            ${cov.identified}   (telemetry needs this)`);
  console.log(`  with a service line number        ${cov.lined}   (usage needs this)`);
  console.log(
    `  device ids already canonical      ${cov.canonical}` +
      (Number(cov.canonical) < Number(cov.identified)
        ? `   <- the rest get the ut prefix on the next poll`
        : "")
  );

  const table = async (name, sql) => {
    try {
      const [[r]] = await pool.query(sql);
      return r;
    } catch {
      return null; // table not created yet — normal before the first deploy
    }
  };

  const tel = await table(
    "starlink_device_latest",
    `SELECT COUNT(*) AS devices, MAX(last_seen_at) AS newest FROM starlink_device_latest`
  );
  const use = await table(
    "starlink_status",
    `SELECT COUNT(*) AS villages, SUM(fetch_ok = 1) AS ok, MAX(checked_at) AS newest,
            ROUND(SUM(total_used_gb), 1) AS used_gb FROM starlink_status`
  );

  console.log("\nSTORED DATA");
  if (!tel) console.log("  telemetry   table not created yet — deploy and restart once");
  else if (!Number(tel.devices)) console.log("  telemetry   no rows yet");
  else console.log(`  telemetry   ${tel.devices} device(s), newest ${tel.newest}`);

  if (!use) console.log("  usage       table not created yet — deploy and restart once");
  else if (!Number(use.villages)) console.log("  usage       no rows yet");
  else
    console.log(
      `  usage       ${use.ok}/${use.villages} village(s) ok, ${use.used_gb} GB total, newest ${use.newest}`
    );

  if (action === "on") {
    console.log(
      "\nNow restart so both jobs pick this up immediately:\n" +
        "  pm2 restart voucher-validation\n" +
        "Then watch them work:\n" +
        "  pm2 logs voucher-validation --lines 40 --nostream | grep -E 'Telemetry|StarlinkUsage'"
    );
  }
} catch (e) {
  console.error("\nFailed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
