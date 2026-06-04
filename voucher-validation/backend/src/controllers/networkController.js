// src/controllers/networkController.js
// Network monitoring: named "projects" (each = a Ruijie Cloud network) and
// per-project device health + topology pulled from the Ruijie Cloud Open API.

import RuijieService from "../services/ruijieService.js";
import { fetchProjectHealth } from "../services/networkHealth.js";

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
  isActive: !!r.is_active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

export function makeNetworkController(pool) {
  const ruijie = new RuijieService();

  return {
    // GET /api/network/projects
    listProjects: async (_req, res) => {
      try {
        const [rows] = await pool.query(
          "SELECT * FROM network_projects ORDER BY sort_order, name"
        );
        return send.ok(res, { projects: rows.map(mapProject) });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
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
          is_active: "isActive",
          sort_order: "sortOrder",
        };
        const set = [];
        const vals = [];
        for (const [col, key] of Object.entries(fields)) {
          if (req.body[key] !== undefined) {
            set.push(`${col} = ?`);
            vals.push(col === "is_active" ? (req.body[key] ? 1 : 0) : req.body[key]);
          }
        }
        if (set.length === 0) return send.ok(res, { success: true, message: "No changes" });
        vals.push(req.params.id);
        await pool.query(`UPDATE network_projects SET ${set.join(", ")} WHERE id = ?`, vals);

        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
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

    // GET /api/network/projects/:id/health — live, per project (Ruijie Cloud).
    getProjectHealth: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        const project = rows[0];
        if (!project) return send.notFound(res, "Project not found");
        const h = await fetchProjectHealth(ruijie, project);
        return send.ok(res, {
          project: mapProject(project),
          cloudSync: h.cloudSync,
          notice: h.cloudSync ? null : h.reason,
          summary: h.summary,
          internet: h.internet,
          usageBytes: h.usageBytes,
          topology: h.topology,
          devices: h.devices,
        });
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
        const [projects] = await pool.query(
          "SELECT * FROM network_projects WHERE is_active = 1 ORDER BY sort_order, name"
        );
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

        const sites = projects.map((p) => {
          const s = statusByProject[p.id] || {};
          const u = upByProject[p.id];
          const uptimePct =
            u && u.samples > 0 ? Math.round((u.up_samples / u.samples) * 1000) / 10 : null;
          return {
            id: p.id,
            name: p.name,
            hostname: p.hostname,
            groupId: p.ruijie_group_id,
            online: s.internet_up == null ? null : !!s.internet_up,
            gatewayOnline: s.gateway_online == null ? null : !!s.gateway_online,
            internetUp: s.internet_up == null ? null : !!s.internet_up,
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
  };
}
