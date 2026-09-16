// src/services/systemHealth.js
// The host this console runs on: processors, memory, disk, and how much of the
// database each table is actually using.
//
// WHY IT MATTERS HERE. This one VM runs thirty-three PM2 processes, a MySQL
// instance, and — since telemetry landed — a job writing roughly 180,000 rows a
// day. That last one is new, and a table growing quietly until the disk fills
// is the kind of failure that takes a service down at 3am with no warning.
// This makes it visible before it becomes an incident.
//
// Everything here is read-only, and every probe degrades on its own: a metric
// that cannot be read comes back null rather than failing the request, because
// a monitoring page that 500s when one number is unavailable is worse than one
// that says "unknown" for that number.

import os from "node:os";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------- cpu */

/** Cumulative busy/idle jiffies per core, which only mean something as a delta. */
function cpuSample() {
  return os.cpus().map((c) => {
    const t = c.times;
    const idle = t.idle;
    const total = t.user + t.nice + t.sys + t.irq + idle;
    return { idle, total, model: c.model, speedMhz: c.speed };
  });
}

/**
 * Per-core utilisation.
 *
 * os.cpus() reports time SINCE BOOT, so a single reading gives the average
 * since the machine started — which on a box up for weeks is a flat, useless
 * number that never moves. Two readings a moment apart give the utilisation
 * right now, which is the thing anyone opening this page is asking about.
 */
export async function cpuUsage(sampleMs = 250) {
  const a = cpuSample();
  await sleep(sampleMs);
  const b = cpuSample();

  const cores = a.map((prev, i) => {
    const cur = b[i];
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    // A core that recorded no time at all in the window tells us nothing; say
    // so rather than reporting a 0% that looks like an idle core.
    const pct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : null;
    return { core: i, pct: pct == null ? null : Math.round(pct * 10) / 10, speedMhz: cur.speedMhz };
  });

  const usable = cores.filter((c) => c.pct != null);
  return {
    model: a[0]?.model || null,
    count: cores.length,
    cores,
    overallPct: usable.length
      ? Math.round((usable.reduce((s, c) => s + c.pct, 0) / usable.length) * 10) / 10
      : null,
    // Load average is per-core-queue depth, not a percentage: on an 8-core box
    // a load of 8 is fully busy, not 800% of anything. Both are reported
    // because they answer different questions — utilisation is now, load is the
    // trend over 1/5/15 minutes.
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    loadPerCore: cores.length
      ? Math.round((os.loadavg()[0] / cores.length) * 1000) / 10
      : null,
  };
}

/* ---------------------------------------------------------------- memory */

export function memoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    usedPct: total ? Math.round((used / total) * 1000) / 10 : null,
  };
}

/* ------------------------------------------------------------------ disk */

/**
 * Free space on the filesystems that matter.
 *
 * /data is called out separately because it holds the maintenance photographs
 * and handover documents — the only data in this system that cannot be
 * regenerated from somewhere else if it is lost.
 */
export async function diskUsage(paths = ["/", "/var/www", "/data"]) {
  const out = [];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const s = fs.statfsSync(p);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize; // bavail, not bfree: bfree counts blocks
      const used = total - s.bfree * s.bsize; // reserved for root that we cannot use
      if (!total) continue;
      out.push({
        path: p,
        totalBytes: total,
        freeBytes: free,
        usedBytes: used,
        usedPct: Math.round((used / total) * 1000) / 10,
      });
    } catch {
      // A path we cannot stat simply is not reported.
    }
  }
  // The same device mounted twice would be listed twice and read as more
  // capacity than exists.
  const seen = new Set();
  return out.filter((d) => {
    const key = `${d.totalBytes}:${d.freeBytes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------- database */

/**
 * Size per table. Included because this console's own jobs are what grow it:
 * telemetry writes ~180k rows/day and the voucher mirror is large, so "which
 * table is eating the disk" is a question an operator here will actually ask.
 */
export async function databaseUsage(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT table_name AS name,
              table_rows AS approx_rows,
              (data_length + index_length) AS bytes
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
        LIMIT 25`
    );
    return {
      tables: rows.map((r) => ({
        name: r.name,
        // information_schema row counts are an estimate for InnoDB, not a
        // count(*), and saying so stops anyone reconciling them against a real
        // total and concluding something is broken.
        approxRows: Number(r.approx_rows || 0),
        bytes: Number(r.bytes || 0),
      })),
      totalBytes: rows.reduce((a, r) => a + Number(r.bytes || 0), 0),
    };
  } catch (e) {
    return { tables: [], totalBytes: null, error: e.message };
  }
}

/* --------------------------------------------------------------- process */

export function processInfo() {
  const m = process.memoryUsage();
  return {
    pid: process.pid,
    nodeVersion: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    rssBytes: m.rss,
    heapUsedBytes: m.heapUsed,
    heapTotalBytes: m.heapTotal,
  };
}

/**
 * The PM2 fleet, if pm2 is on the PATH. Thirty-three processes is a lot to eye
 * over ssh, and a restart count climbing is the earliest sign a village site is
 * crash-looping.
 *
 * Shells out deliberately: the alternative is depending on pm2 as a library
 * inside the very process pm2 manages. Times out, and its absence is not an
 * error — this console also runs in places where pm2 is not the supervisor.
 */
export async function pm2Processes() {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const list = JSON.parse(stdout);
    return list.map((p) => ({
      name: p.name,
      status: p.pm2_env?.status || null,
      restarts: Number(p.pm2_env?.restart_time || 0),
      unstableRestarts: Number(p.pm2_env?.unstable_restarts || 0),
      cpuPct: Number(p.monit?.cpu ?? 0),
      memoryBytes: Number(p.monit?.memory ?? 0),
      uptimeSeconds: p.pm2_env?.pm_uptime
        ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000)
        : null,
    }));
  } catch {
    return null; // pm2 not present, not on PATH, or slow — all fine
  }
}

/* ----------------------------------------------------------------- whole */

export async function collectSystemHealth(pool) {
  const [cpu, disks, db, pm2] = await Promise.all([
    cpuUsage(),
    diskUsage(),
    databaseUsage(pool),
    pm2Processes(),
  ]);
  return {
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      uptimeSeconds: Math.round(os.uptime()),
    },
    cpu,
    memory: memoryUsage(),
    disks,
    database: db,
    process: processInfo(),
    pm2,
    collectedAt: new Date().toISOString(),
  };
}
