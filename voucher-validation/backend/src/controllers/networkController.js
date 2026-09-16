// src/controllers/networkController.js
// Network monitoring: named "projects" (each = a Ruijie Cloud network) and
// per-project device health + topology pulled from the Ruijie Cloud Open API.

import RuijieService from "../services/ruijieService.js";
import { fetchProjectHealth } from "../services/networkHealth.js";
import { getHealthSnapshot, setHealthSnapshot } from "../services/networkHealthStore.js";
import * as starlink from "../services/starlinkService.js";
import { collectOnceGuarded, isCollecting } from "../services/networkCollector.js";
import { resolveDeviceId, normalizeDeviceId } from "../services/starlinkTelemetry.js";
import { collectUsageGuarded } from "../services/starlinkUsageCollector.js";

/**
 * The form an operator reads and types: the kit id as the Starlink console
 * shows it, with no "ut" prefix. Storage keeps the canonical prefixed form
 * because that is what the telemetry stream uses as a key.
 */
const displayDeviceId = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.toLowerCase().startsWith("ut") ? s.slice(2) : s;
};

const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

const mapProject = (r) => ({
  id: r.id,
  name: r.name,
  hostname: r.hostname,
  ruijieGroupId: r.ruijie_group_id,
  ruijieTenantId: r.ruijie_tenant_id,
  // Starlink identifiers, not secrets: the service line number drives the usage
  // graph, the device id is user-terminal kit info. Viewers only ever see
  // projects inside their own scope.
  starlinkServiceLineNumber: r.starlink_service_line_number || null,
  // Shown WITHOUT the "ut" prefix, which is how the Starlink console displays a
  // terminal and therefore how an admin reads it off the kit. The prefix is a
  // wire detail of the telemetry stream: the backend adds it when matching and
  // strips it again here, so it never has to be typed or seen.
  starlinkDeviceId: displayDeviceId(r.starlink_device_id),
  starlinkKitId: displayDeviceId(r.starlink_kit_id),
  isActive: !!r.is_active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

/* ------------------------------------------------- Starlink-derived online */

// A dish reports every few seconds, so these windows are generous rather than
// tight: 10 minutes is ~40 missed samples, which is a real outage and not a
// hiccup. The middle band exists because "we have not heard from it in a
// quarter of an hour" is genuinely not the same claim as "it is down", and
// showing an amber unknown is honest where a red cross would not be.
const ONLINE_WITHIN_MS = 10 * 60 * 1000;
const UNKNOWN_WITHIN_MS = 30 * 60 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;
const numOrNull = (v) => (v == null ? null : Number(v));

async function isTelemetryEnabled(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'starlink_telemetry_enabled'"
    );
    const raw = rows[0]?.setting_value;
    return raw != null && (String(raw).toLowerCase() === "true" || String(raw) === "1");
  } catch {
    return false;
  }
}

/**
 * Whether a village has internet, and on whose word.
 *
 * Falls back to the Ruijie gateway whenever Starlink cannot answer — telemetry
 * switched off, or no device id resolved for this village. That fallback is
 * reported in `source` rather than hidden, because an operator reading a green
 * dot deserves to know which layer vouched for it.
 */
function deriveOnline({ telemetryEnabled, tel, ruijieUp, nowMs }) {
  if (!telemetryEnabled || !tel || !tel.last_seen_at) {
    return { online: ruijieUp, source: ruijieUp == null ? null : "ruijie" };
  }
  const age = nowMs - new Date(tel.last_seen_at).getTime();
  if (age <= ONLINE_WITHIN_MS) return { online: true, source: "telemetry" };
  if (age <= UNKNOWN_WITHIN_MS) return { online: null, source: "telemetry" };
  return { online: false, source: "telemetry" };
}

/** The per-village Starlink block: live link quality, plus cycle consumption. */
function buildStarlink({ project, devId, tel, use, nowMs }) {
  const allowance =
    use && use.allowance_gb != null && Number(use.allowance_gb) > 0
      ? Number(use.allowance_gb)
      : null; // 0 means "Starlink published no cap", never "no data allowed"
  return {
    // A village counts as configured when we have an id in either field — the
    // kit alone is enough, because the device id is only ever derived from it.
    configured: !!devId,
    lastSeenAt: tel?.last_seen_at ? new Date(tel.last_seen_at).toISOString() : null,
    ageSeconds: tel?.last_seen_at
      ? Math.max(0, Math.round((nowMs - new Date(tel.last_seen_at).getTime()) / 1000))
      : null,
    downlinkMbps: numOrNull(tel?.downlink_mbps),
    uplinkMbps: numOrNull(tel?.uplink_mbps),
    latencyMs: numOrNull(tel?.latency_ms),
    dropRate: numOrNull(tel?.drop_rate),
    signalQuality: numOrNull(tel?.signal_quality),
    obstructionPct: numOrNull(tel?.obstruction_pct),
    uptimeSeconds: numOrNull(tel?.uptime_seconds),
    usedGb: numOrNull(use?.total_used_gb),
    allowanceGb: allowance,
  };
}

// Live health is expensive (~6–7 Ruijie Cloud calls per project) and Ruijie
// rate-limits hard. It is fetched ONLY on an explicit manual refresh
// (GET .../health?refresh=1) — never on a plain page load. Concurrent refreshes
// collapse into one in-flight fetch.
const _healthInflight = new Map();  // projectId -> Promise<payload>

export function makeNetworkController(pool) {
  // Set from server.js once the scheduler exists (it needs this controller first).
  let collectScheduler = null;
  let telemetryPoller = null;
  let usageScheduler = null;
  const ruijie = new RuijieService();

  return {
    // GET /api/network/projects
    listProjects: async (req, res) => {
      try {
        const scope = req.scope || { isViewer: false };
        let sql = "SELECT * FROM network_projects ORDER BY sort_order, name";
        let params = [];
        if (scope.isViewer) {
          const ids = scope.projectIds || [];
          if (!ids.length) return send.ok(res, { projects: [] });
          sql = `SELECT * FROM network_projects WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY sort_order, name`;
          params = ids;
        }
        const [rows] = await pool.query(sql, params);
        return send.ok(res, { projects: rows.map(mapProject) });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    setCollectScheduler: (s) => { collectScheduler = s; },
    setTelemetryPoller: (p) => { telemetryPoller = p; },
    setUsageScheduler: (s) => { usageScheduler = s; },

    // GET /api/network/projects/:id/telemetry?range=A|B|C
    //
    // The link's recent behaviour for one village: throughput, latency, packet
    // loss, signal quality and obstruction over time. Reads the stored
    // telemetry only — the poller owns every Starlink call, so opening this
    // costs nothing upstream however many people have it open.
    //
    // DOWNSAMPLED SERVER-SIDE. The poller writes a row roughly every 15s, so a
    // day is ~5,700 rows per village; sending those raw would be a megabyte of
    // JSON to draw a line a few hundred pixels wide. Each range buckets to
    // about 200 points, which is more than a chart that size can resolve.
    getProjectTelemetry: async (req, res) => {
      try {
        const RANGES = {
          A: { minutes: 15, bucketSec: 15, label: "15 minutes" },
          B: { minutes: 180, bucketSec: 60, label: "3 hours" },
          C: { minutes: 1440, bucketSec: 300, label: "24 hours" },
        };
        const r = RANGES[String(req.query.range || "B").toUpperCase()] || RANGES.B;

        const [[project]] = await pool.query(
          "SELECT id, name, starlink_device_id, starlink_kit_id FROM network_projects WHERE id = ?",
          [req.params.id]
        );
        if (!project) return send.notFound(res, "Village not found");

        const devId =
          normalizeDeviceId(project.starlink_device_id) ||
          normalizeDeviceId(project.starlink_kit_id);
        if (!devId) {
          // Not an error: most of the estate may simply have no kit recorded.
          return send.ok(res, {
            configured: false,
            range: r.label,
            points: [],
            stats: {},
            reason: "No Starlink kit is linked to this village.",
          });
        }

        const [rows] = await pool.query(
          `SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / ?) * ?) AS t,
                  AVG(downlink_mbps)   AS downlink,
                  AVG(uplink_mbps)     AS uplink,
                  AVG(latency_ms)      AS latency,
                  AVG(drop_rate)       AS drop_rate,
                  AVG(signal_quality)  AS signal_quality,
                  AVG(obstruction_pct) AS obstruction
             FROM starlink_telemetry
            WHERE device_id = ?
              AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
            GROUP BY t
            ORDER BY t ASC`,
          [r.bucketSec, r.bucketSec, devId, r.minutes]
        );

        // Throughput arrives in Mbps already; drop rate and signal quality are
        // 0..1 fractions and are sent as percentages so every chart on the page
        // shares one convention.
        const points = rows.map((x) => ({
          t: new Date(x.t).toISOString(),
          downlink: numOrNull(x.downlink),
          uplink: numOrNull(x.uplink),
          latency: numOrNull(x.latency),
          drop: x.drop_rate == null ? null : Number(x.drop_rate) * 100,
          signal: x.signal_quality == null ? null : Number(x.signal_quality) * 100,
          obstruction: numOrNull(x.obstruction),
        }));

        const stat = (key) => {
          const v = points.map((p) => p[key]).filter((n) => n != null && Number.isFinite(n));
          if (!v.length) return null;
          return {
            last: round2(v[v.length - 1]),
            min: round2(Math.min(...v)),
            max: round2(Math.max(...v)),
            avg: round2(v.reduce((a, b) => a + b, 0) / v.length),
          };
        };

        return send.ok(res, {
          configured: true,
          deviceId: devId,
          range: r.label,
          bucketSeconds: r.bucketSec,
          points,
          stats: {
            downlink: stat("downlink"),
            uplink: stat("uplink"),
            latency: stat("latency"),
            drop: stat("drop"),
            signal: stat("signal"),
            obstruction: stat("obstruction"),
          },
          // Distinguishes "the dish has been quiet" from "telemetry is switched
          // off", which look identical as an empty chart.
          telemetryEnabled: await isTelemetryEnabled(pool),
        });
      } catch (e) {
        console.error("[network] telemetry query failed:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/network/starlink/usage/status  (admin)
    // POST /api/network/starlink/usage/collect  (admin) — refresh every village
    // now. One Starlink call per village, single-flighted, so a double click
    // joins the run in progress rather than spending the calls twice.
    usageStatus: async (_req, res) => {
      try {
        const [[c]] = await pool.query(
          `SELECT COUNT(*) AS rows_stored,
                  SUM(fetch_ok = 1) AS ok,
                  MAX(checked_at) AS last_checked
             FROM starlink_status`
        );
        return send.ok(res, {
          scheduler: usageScheduler ? usageScheduler.status() : { enabled: false },
          stored: {
            villages: Number(c.rows_stored || 0),
            fetchOk: Number(c.ok || 0),
            lastChecked: c.last_checked || null,
          },
        });
      } catch (e) {
        // A missing table is the normal state before the first deploy of this
        // feature; say so plainly rather than returning a 500.
        return send.ok(res, {
          scheduler: usageScheduler ? usageScheduler.status() : { enabled: false },
          stored: { villages: 0, fetchOk: 0, lastChecked: null },
          error: e.message,
        });
      }
    },

    usageCollectNow: async (_req, res) => {
      try {
        const r = await collectUsageGuarded(pool);
        return send.ok(res, r);
      } catch (e) {
        console.error(e);
        return send.serverErr(res, e.message);
      }
    },

    usageReload: async (_req, res) => {
      try {
        if (!usageScheduler) return send.bad(res, "Usage scheduler is not running on this instance");
        return send.ok(res, await usageScheduler.reload());
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/network/telemetry/status  (admin)
    // What the poller is doing, plus how much of the estate it can actually
    // speak for — a village with no resolved device id falls back to the Ruijie
    // signal, and an operator should be able to see that at a glance rather
    // than wonder why a dot never turns green.
    telemetryStatus: async (_req, res) => {
      try {
        const [[counts]] = await pool.query(
          `SELECT COUNT(*) AS total,
                  SUM(starlink_device_id IS NOT NULL) AS resolved,
                  SUM(starlink_kit_id IS NOT NULL OR starlink_service_line_number IS NOT NULL) AS identified
             FROM network_projects WHERE is_active = 1`
        );
        return send.ok(res, {
          poller: telemetryPoller ? telemetryPoller.status() : { enabled: false, running: false },
          coverage: {
            villages: Number(counts.total || 0),
            withDeviceId: Number(counts.resolved || 0),
            withKitOrLine: Number(counts.identified || 0),
          },
        });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/network/telemetry/poll  (admin)
    // Resolve any outstanding kit ids, then read the stream once. Useful right
    // after entering a kit, so the village does not sit blank until the next
    // tick.
    telemetryPollNow: async (_req, res) => {
      try {
        if (!telemetryPoller) return send.bad(res, "Telemetry poller is not running on this instance");
        const r = await telemetryPoller.pollNow();
        return send.ok(res, r);
      } catch (e) {
        console.error(e);
        return send.serverErr(res, e.message);
      }
    },

    // POST /api/network/telemetry/reload  (admin)
    // Re-read the on/off setting without a restart, the same way the collect
    // scheduler reloads.
    telemetryReload: async (_req, res) => {
      try {
        if (!telemetryPoller) return send.bad(res, "Telemetry poller is not running on this instance");
        return send.ok(res, await telemetryPoller.reload());
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/network/collect  (admin)
    // Refresh EVERY village now. Deliberately not per-village: the Overview and
    // the dashboard both read one snapshot set, so a partial refresh would leave
    // the page comparing villages measured at different times.
    //
    // Costs up to 4 Ruijie calls per village, so it is single-flighted in the
    // collector — a double click, or a click landing on a scheduled tick, joins
    // the run already in progress instead of spending the quota twice.
    collectNow: async (_req, res) => {
      try {
        const already = isCollecting();
        const r = await collectOnceGuarded(pool, ruijie);
        return send.ok(res, {
          success: true,
          joinedExisting: already,
          villagesUpdated: r?.ok ?? null,
          villagesTotal: r?.total ?? null,
        });
      } catch (e) {
        console.error('[network] collectNow failed:', e.message);
        return send.serverErr(res, e.message);
      }
    },

    // GET /api/network/collect/status — scheduler state for the Settings page.
    collectStatus: async (_req, res) => {
      try {
        const s = typeof collectScheduler?.status === 'function' ? collectScheduler.status() : null;
        const [[row]] = await pool.query('SELECT MAX(checked_at) AS last FROM network_status');
        return send.ok(res, { ...(s || {}), running: isCollecting(), lastCollected: row?.last || null });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/network/discover  (admin)
    // Lists every Ruijie network group (project) so an admin can pick a
    // village when adding a site, instead of typing the group ID by hand.
    discoverGroups: async (_req, res) => {
      try {
        const { groups, error } = await ruijie.getNetworkGroups();
        return send.ok(res, { groups: groups || [], error: error || null });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // POST /api/network/projects  (admin)
    createProject: async (req, res) => {
      try {
        const { name, hostname, ruijieGroupId, ruijieTenantId, sortOrder } = req.body;
        if (!name || !String(name).trim()) return send.bad(res, "Project name is required");

        const [result] = await pool.query(
          `INSERT INTO network_projects (name, hostname, ruijie_group_id, ruijie_tenant_id, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [
            String(name).trim(),
            hostname?.trim() || null,
            ruijieGroupId?.toString().trim() || null,
            ruijieTenantId?.toString().trim() || null,
            Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
          ]
        );
        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [result.insertId]);
        return send.created(res, { success: true, project: mapProject(rows[0]) });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // PUT /api/network/projects/:id  (admin)
    updateProject: async (req, res) => {
      try {
        const [existing] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        if (!existing[0]) return send.notFound(res, "Project not found");

        const fields = {
          name: "name",
          hostname: "hostname",
          ruijie_group_id: "ruijieGroupId",
          ruijie_tenant_id: "ruijieTenantId",
          starlink_service_line_number: "starlinkServiceLineNumber",
          starlink_device_id: "starlinkDeviceId",
          starlink_kit_id: "starlinkKitId",
          is_active: "isActive",
          sort_order: "sortOrder",
        };
        // Columns where an empty string means "unset this", not "store ''" —
        // clearing a village's service line must actually disable its card.
        const nullable = new Set([
          "starlink_service_line_number",
          "starlink_device_id",
          "starlink_kit_id",
        ]);
        const set = [];
        const vals = [];
        for (const [col, key] of Object.entries(fields)) {
          if (req.body[key] !== undefined) {
            set.push(`${col} = ?`);
            let v = req.body[key];
            if (col === "is_active") v = v ? 1 : 0;
            else if (nullable.has(col)) v = String(v ?? "").trim() || null;
            // Normalise on the way IN as well as out, so whether the admin
            // pastes the bare kit id or one copied from somewhere that already
            // carries the prefix, storage ends up canonical and the telemetry
            // join matches either way.
            if (v && (col === "starlink_device_id" || col === "starlink_kit_id")) {
              v = normalizeDeviceId(v) || v;
            }
            vals.push(v);
          }
        }
        if (set.length === 0) return send.ok(res, { success: true, message: "No changes" });

        // Re-point the kit or the service line and the resolved device id is
        // stale — it still names the OLD dish, so telemetry would keep
        // reporting a terminal this village no longer has. Clear it unless the
        // caller set one explicitly, and let the poller resolve it again.
        const repointed =
          (req.body.starlinkKitId !== undefined ||
            req.body.starlinkServiceLineNumber !== undefined) &&
          req.body.starlinkDeviceId === undefined;
        if (repointed) set.push("starlink_device_id = NULL");

        vals.push(req.params.id);
        await pool.query(`UPDATE network_projects SET ${set.join(", ")} WHERE id = ?`, vals);

        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        // Best-effort: resolve the new kit straight away so the village is
        // live without waiting for the next poll. A failure here is not an
        // error — the poller retries on its own schedule.
        if (repointed) {
          resolveDeviceId(pool, rows[0])
            .then((id) =>
              id
                ? pool.query("UPDATE network_projects SET starlink_device_id = ? WHERE id = ?", [
                    id,
                    req.params.id,
                  ])
                : null
            )
            .catch(() => {});
        }
        return send.ok(res, { success: true, project: mapProject(rows[0]) });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // DELETE /api/network/projects/:id  (admin)
    deleteProject: async (req, res) => {
      try {
        const [existing] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        if (!existing[0]) return send.notFound(res, "Project not found");
        await pool.query("DELETE FROM network_projects WHERE id = ?", [req.params.id]);
        return send.ok(res, { success: true });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/network/projects/:id/starlink?cycle=A|B|C
    // Chart-ready data usage for one village's Starlink service line.
    //
    // Always HTTP 200. An unconfigured village and a temporarily unreachable
    // Starlink API are both NORMAL states here, not errors: the dashboard
    // simply hides the card or shows an empty chart. Returning 500 would make a
    // Starlink outage look like a broken admin portal.
    getProjectStarlink: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        const project = rows[0];
        if (!project) return send.notFound(res, "Project not found");

        const scope = req.scope || { isViewer: false };
        if (scope.isViewer && !(scope.projectIds || []).includes(Number(project.id))) {
          return send.notFound(res, "Project not found");
        }

        const serviceLine = project.starlink_service_line_number;
        const cfg = await starlink.loadConfig(pool);
        if (!cfg || !serviceLine) return send.ok(res, { configured: false });

        const cycleKey = ["A", "B", "C"].includes(req.query.cycle) ? req.query.cycle : "A";
        const cycleIndex = { A: 0, B: 1, C: 2 }[cycleKey];

        // Both are cached and single-flighted, so a warm dashboard makes zero
        // outbound calls. allSettled: kit metadata failing must not lose usage.
        const [usageRes, lineRes] = await Promise.allSettled([
          starlink.getUsage(cfg, serviceLine),
          starlink.getServiceLine(cfg, serviceLine),
        ]);

        const line = lineRes.status === "fulfilled" ? lineRes.value : null;
        const kit = {
          serviceLineNumber: serviceLine,
          deviceId: project.starlink_device_id || null,
          nickname: line?.nickname || null,
          active: line?.active ?? null,
          startDate: line?.startDate || null,
          productReferenceId: line?.productReferenceId || null,
        };

        if (usageRes.status !== "fulfilled") {
          const detail = starlink.describeError(usageRes.reason);
          console.error("[network] Starlink usage failed:", detail);
          return send.ok(res, {
            configured: true,
            kit,
            error: "Starlink data unavailable",
            // The real reason, so a misconfiguration is diagnosable from the
            // dashboard instead of only from the server log.
            reason: detail,
            days: [],
            cycles: [],
          });
        }

        const { cycles = [], fetchedAt, stale, reason } = usageRes.value;
        const cycle = cycles[cycleIndex] || null;
        return send.ok(res, {
          configured: true,
          kit,
          cycleKey,
          cycleCount: cycles.length,
          cycle: cycle ? { startDate: cycle.startDate, endDate: cycle.endDate } : null,
          days: cycle?.days || [],
          totals: cycle?.totals || null,
          // Why the chart is empty, when it is: "no results for this service
          // line" is a very different problem from "no usage yet this cycle".
          reason:
            reason ||
            (cycles.length && !cycle
              ? `Starlink only returned ${cycles.length} billing cycle(s), so this one is not available yet.`
              : null),
          fetchedAt,
          stale: !!stale,
        });
      } catch (e) {
        console.error("[network] Starlink endpoint error:", e.message);
        return send.ok(res, {
          configured: true,
          error: "Starlink data is temporarily unavailable",
          days: [],
          cycles: [],
        });
      }
    },

    // GET /api/network/projects/:id/health           → cached snapshot only
    // GET /api/network/projects/:id/health?refresh=1  → ONE live Ruijie fetch
    //
    // A plain page load NEVER calls Ruijie Cloud: it returns the last snapshot
    // (from the collector if enabled, or from the last manual refresh) or an
    // empty "no data yet" payload. Ruijie is hit only when the user explicitly
    // clicks Refresh (?refresh=1) — this keeps us off the `code: 44` throttle.
    getProjectHealth: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        const project = rows[0];
        if (!project) return send.notFound(res, "Project not found");

        // Viewer scope: a viewer may only see health for their assigned villages.
        // Return 404 (not 403) so we don't reveal that other projects exist.
        const scope = req.scope || { isViewer: false };
        if (scope.isViewer && !(scope.projectIds || []).includes(Number(project.id))) {
          return send.notFound(res, "Project not found");
        }

        const buildPayload = (h) => ({
          project: mapProject(project),
          cloudSync: h.cloudSync,
          notice: h.cloudSync ? null : h.reason,
          summary: h.summary,
          internet: h.internet,
          usageBytes: h.usageBytes,
          topology: h.topology,
          devices: h.devices,
        });

        const wantRefresh = String(req.query.refresh || "") === "1";

        // Plain page load: serve the cached snapshot, zero Ruijie calls.
        if (!wantRefresh) {
          const snap = getHealthSnapshot(project.id);
          if (snap) {
            return send.ok(res, {
              ...buildPayload(snap.health),
              source: "snapshot",
              collectedAt: new Date(snap.ts).toISOString(),
            });
          }
          // No snapshot yet and no explicit refresh → do NOT touch Ruijie.
          // Return an empty payload so the page renders a "click Refresh" state.
          return send.ok(res, {
            project: mapProject(project),
            cloudSync: false,
            notice: "No cached data yet — click Refresh to fetch live from Ruijie Cloud.",
            summary: null,
            internet: null,
            usageBytes: null,
            topology: null,
            devices: [],
            source: "none",
            collectedAt: null,
          });
        }

        // Manual refresh only: ONE live fetch, concurrent clicks deduped. The
        // fresh result becomes the new snapshot so later page loads serve it.
        const key = String(project.id);
        let inflight = _healthInflight.get(key);
        if (!inflight) {
          inflight = fetchProjectHealth(ruijie, project)
            .then((h) => {
              if (h.cloudSync) setHealthSnapshot(project.id, h);
              return { ...buildPayload(h), source: "live", collectedAt: new Date().toISOString() };
            })
            .finally(() => _healthInflight.delete(key));
          _healthInflight.set(key, inflight);
        }
        return send.ok(res, await inflight);
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/network/overview — all villages, from the collector snapshots.
    // ?uptimeHours=24 sets the window for the uptime %.
    getOverview: async (req, res) => {
      try {
        const uptimeHours = Math.min(720, Math.max(1, Number(req.query.uptimeHours) || 24));
        const scope = req.scope || { isViewer: false };
        // Scope to the viewer's villages. Empty set -> projects stays [] and the
        // normal path below yields an empty sites/summary of the correct shape
        // (never fall through to all villages).
        let projects = [];
        if (!scope.isViewer) {
          [projects] = await pool.query(
            "SELECT * FROM network_projects WHERE is_active = 1 ORDER BY sort_order, name"
          );
        } else {
          const ids = scope.projectIds || [];
          if (ids.length) {
            [projects] = await pool.query(
              `SELECT * FROM network_projects WHERE is_active = 1 AND id IN (${ids.map(() => "?").join(",")}) ORDER BY sort_order, name`,
              ids
            );
          }
        }
        const [statusRows] = await pool.query("SELECT * FROM network_status");
        const statusByProject = {};
        for (const s of statusRows) statusByProject[s.project_id] = s;

        // Uptime % per project = share of history samples with internet up, in window.
        const [uptimeRows] = await pool.query(
          `SELECT project_id,
                  COUNT(*) AS samples,
                  SUM(CASE WHEN internet_up = 1 THEN 1 ELSE 0 END) AS up_samples
             FROM network_status_history
            WHERE checked_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
            GROUP BY project_id`,
          [uptimeHours]
        );
        const upByProject = {};
        for (const u of uptimeRows) upByProject[u.project_id] = u;

        // Starlink telemetry — the newest sample per device, which is what
        // decides whether a village counts as online. One indexed read for the
        // whole estate; no Starlink call is made here, the poller owns that.
        const [telemetryRows] = await pool.query("SELECT * FROM starlink_device_latest");
        const telemetryByDevice = {};
        // Keyed on the canonical id on BOTH sides. Villages entered before the
        // backfill still hold the bare form the Starlink console shows, and
        // matching those against the stream's ut-prefixed key is precisely what
        // was silently sending every village to the Ruijie fallback.
        for (const t of telemetryRows) {
          telemetryByDevice[normalizeDeviceId(t.device_id) || t.device_id] = t;
        }

        // Current-cycle data usage, written by the usage collector. Separate
        // from telemetry: telemetry says whether the dish is up, this says how
        // much it has carried this month.
        // Do NOT swallow this. An earlier version caught and ignored the error,
        // which turned "the usage collector has never run" into every village
        // silently reporting no data and an estate meter reading 0 GB — a wrong
        // number is worse than a visible failure, because nobody goes looking
        // for the cause of a number that looks plausible.
        let usageByProject = {};
        let usageCollected = false;
        try {
          const [usageRows] = await pool.query("SELECT * FROM starlink_status");
          for (const u of usageRows) usageByProject[u.project_id] = u;
          usageCollected = usageRows.length > 0;
        } catch (e) {
          console.error(
            "[network] starlink_status unreadable — Starlink usage will show as unavailable:",
            e.message
          );
        }

        const telemetryEnabled = await isTelemetryEnabled(pool);
        const nowMs = Date.now();

        const sites = projects.map((p) => {
          const s = statusByProject[p.id] || {};
          const u = upByProject[p.id];
          const uptimePct =
            u && u.samples > 0 ? Math.round((u.up_samples / u.samples) * 1000) / 10 : null;
          const ruijieUp = s.internet_up == null ? null : !!s.internet_up;
          const devId = normalizeDeviceId(p.starlink_device_id) || normalizeDeviceId(p.starlink_kit_id);
          const tel = devId ? telemetryByDevice[devId] : null;
          const use = usageByProject[p.id] || null;
          const verdict = deriveOnline({ telemetryEnabled, tel, ruijieUp, nowMs });

          return {
            id: p.id,
            name: p.name,
            hostname: p.hostname,
            groupId: p.ruijie_group_id,
            // Starlink-led. `internetUp` below stays the Ruijie gateway's own
            // reading — a different question (the local link, one layer down),
            // which the topology view still needs.
            online: verdict.online,
            onlineSource: verdict.source,
            starlink: buildStarlink({ project: p, devId, tel, use, nowMs }),
            gatewayOnline: s.gateway_online == null ? null : !!s.gateway_online,
            internetUp: ruijieUp,
            apsOnline: Number(s.aps_online ?? 0),
            apsTotal: Number(s.aps_total ?? 0),
            clients: Number(s.clients ?? 0),
            usageBytes: s.usage_bytes == null ? null : Number(s.usage_bytes),
            publicIp: s.public_ip || null,
            cloudSync: !!s.cloud_sync,
            uptimePct,
            checkedAt: s.checked_at || null,
          };
        });

        const sum = (f) => sites.reduce((a, v) => a + (f(v) || 0), 0);
        const summary = {
          villagesTotal: sites.length,
          villagesUp: sites.filter((v) => v.online === true).length,
          villagesDown: sites.filter((v) => v.online === false).length,
          villagesUnknown: sites.filter((v) => v.online == null).length,
          apsOnline: sum((v) => v.apsOnline),
          apsTotal: sum((v) => v.apsTotal),
          clients: sum((v) => v.clients),
          usageBytes: sum((v) => v.usageBytes),
          // Estate-wide Starlink consumption. The allowance total deliberately
          // SKIPS villages Starlink publishes no cap for rather than adding a
          // zero — summing zeros would quietly understate the denominator and
          // make the estate look closer to its limit than it is. Null when no
          // village in scope has a published cap, so the UI can say so instead
          // of printing "0 GB".
          starlinkUsedGb: sites.some((v) => v.starlink?.usedGb != null)
            ? round2(sites.reduce((a, v) => a + (v.starlink?.usedGb || 0), 0))
            : null,
          starlinkAllowanceGb: sites.some((v) => v.starlink?.allowanceGb != null)
            ? round2(
                sites.reduce(
                  (a, v) => a + (v.starlink?.allowanceGb != null ? v.starlink.allowanceGb : 0),
                  0
                )
              )
            : null,
          telemetryEnabled,
          villagesWithTelemetry: sites.filter((v) => v.starlink?.configured).length,
          // So the UI can distinguish "this estate has used no data" from "the
          // usage collector has never run", which look identical otherwise.
          usageCollected,
        };
        const lastCollected = sites.reduce(
          (m, v) => (v.checkedAt && (!m || v.checkedAt > m) ? v.checkedAt : m),
          null
        );
        return send.ok(res, { summary, sites, uptimeHours, lastCollected });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },

    // GET /api/network/overview/history?hours=24&groupId=XXXX
    // Time-bucketed trend from network_status_history. Omit groupId for the
    // global (all-villages) trend; pass it for a single village. Read-only.
    getTrend: async (req, res) => {
      try {
        const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
        const groupId = req.query.groupId ? String(req.query.groupId) : null;
        const scope = req.scope || { isViewer: false };
        const bucketFmt = hours <= 168 ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d 00:00:00";
        const params = [hours];
        let projFilter = "";
        if (groupId) {
          // Viewer requesting a specific village must own it, else empty trend.
          if (scope.isViewer && !(scope.groupIds || []).map(String).includes(groupId)) {
            return send.ok(res, { points: [], hours, groupId });
          }
          projFilter =
            "AND h.project_id = (SELECT id FROM network_projects WHERE ruijie_group_id = ? LIMIT 1)";
          params.push(groupId);
        } else if (scope.isViewer) {
          // Aggregate trend across the viewer's villages only (never all).
          const ids = scope.projectIds || [];
          if (!ids.length) return send.ok(res, { points: [], hours, groupId: null });
          projFilter = `AND h.project_id IN (${ids.map(() => "?").join(",")})`;
          params.push(...ids);
        }
        const [rows] = await pool.query(
          `SELECT bucket,
                  ROUND(SUM(clients)) AS clients,
                  SUM(usage_bytes)    AS usageBytes,
                  ROUND(AVG(up) * 100, 1) AS internetPct
             FROM (
               SELECT DATE_FORMAT(h.checked_at, '${bucketFmt}') AS bucket,
                      h.project_id,
                      AVG(h.clients)     AS clients,
                      MAX(h.usage_bytes) AS usage_bytes,
                      AVG(h.internet_up) AS up
                 FROM network_status_history h
                WHERE h.checked_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
                  ${projFilter}
                GROUP BY bucket, h.project_id
             ) t
            GROUP BY bucket
            ORDER BY bucket ASC`,
          params
        );
        const points = rows.map((r) => ({
          t: r.bucket,
          clients: Number(r.clients ?? 0),
          usageBytes: r.usageBytes == null ? null : Number(r.usageBytes),
          internetPct: r.internetPct == null ? null : Number(r.internetPct),
        }));
        return send.ok(res, { points, hours, groupId });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },
  };
}
