// src/services/networkCollector.js
// Background job: every few minutes, poll each village's live health from Ruijie
// Cloud and store (a) the latest snapshot in network_status and (b) a history
// sample in network_status_history — so the Overview page has uptime % + trends.

import RuijieService from './ruijieService.js';
import { fetchProjectHealth } from './networkHealth.js';
import { setHealthSnapshot } from './networkHealthStore.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bool = (v) => (v == null ? null : v ? 1 : 0);

export async function collectOnce(pool, ruijie) {
  const [projects] = await pool.query(
    'SELECT * FROM network_projects WHERE is_active = 1 ORDER BY sort_order, name'
  );
  let ok = 0;
  for (const project of projects) {
    try {
      const h = await fetchProjectHealth(ruijie, project);
      // Cache the full payload (devices + topology) for the on-demand health
      // endpoint so opening the diagram reads this instead of hitting Ruijie
      // live. Only store good data — keep the last-known-good during an outage.
      if (h.cloudSync) setHealthSnapshot(project.id, h);
      const s = h.summary || {};
      const gatewayOnline = s.gatewayTotal > 0 ? (s.gatewayOnline > 0 ? 1 : 0) : null;
      const internetUp = bool(h.internet?.up);
      const usage = h.usageBytes == null ? null : Math.round(h.usageBytes);

      await pool.query(
        `INSERT INTO network_status
           (project_id, gateway_online, internet_up, aps_total, aps_online,
            switches_total, switches_online, clients, usage_bytes, public_ip, cloud_sync, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           gateway_online=VALUES(gateway_online), internet_up=VALUES(internet_up),
           aps_total=VALUES(aps_total), aps_online=VALUES(aps_online),
           switches_total=VALUES(switches_total), switches_online=VALUES(switches_online),
           clients=VALUES(clients), usage_bytes=VALUES(usage_bytes),
           public_ip=VALUES(public_ip), cloud_sync=VALUES(cloud_sync), checked_at=NOW()`,
        [project.id, gatewayOnline, internetUp, s.apTotal || 0, s.apOnline || 0,
         s.switchTotal || 0, s.switchOnline || 0, s.clients || 0, usage,
         h.internet?.publicIp || null, h.cloudSync ? 1 : 0]
      );

      // Only record a history sample when we actually reached the cloud, so a
      // transient API failure doesn't get logged as "down" and skew uptime.
      if (h.cloudSync) {
        await pool.query(
          `INSERT INTO network_status_history
             (project_id, gateway_online, internet_up, aps_total, aps_online, clients, usage_bytes, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [project.id, gatewayOnline, internetUp, s.apTotal || 0, s.apOnline || 0, s.clients || 0, usage]
        );
      }
      ok++;
    } catch (e) {
      console.warn(`[collector] project ${project.id} (${project.name}) failed:`, e.message);
    }
    await sleep(400); // gentle pacing between villages (don't hammer Ruijie)
  }

  // Keep history bounded.
  try {
    await pool.query('DELETE FROM network_status_history WHERE checked_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
  } catch { /* ignore */ }

  console.log(`[collector] cycle done: ${ok}/${projects.length} villages updated`);
  return ok;
}

let timer = null;
export function startCollector(pool, { intervalMs = 5 * 60 * 1000 } = {}) {
  if (timer) return timer;
  const ruijie = new RuijieService();
  const run = () => collectOnce(pool, ruijie).catch((e) => console.error('[collector] cycle error:', e.message));
  setTimeout(run, 8000); // first run shortly after boot
  timer = setInterval(run, intervalMs);
  console.log(`[collector] started — every ${Math.round(intervalMs / 60000)} min`);
  return timer;
}
