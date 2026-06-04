// src/controllers/networkController.js
// Network monitoring: named "projects" (each = a Ruijie Cloud network) and
// per-project device health + topology pulled from the Ruijie Cloud Open API.

import RuijieService from "../services/ruijieService.js";

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

    // GET /api/network/projects/:id/health
    // Returns device health + a derived topology (internet → gateway → APs).
    getProjectHealth: async (req, res) => {
      try {
        const [rows] = await pool.query("SELECT * FROM network_projects WHERE id = ?", [req.params.id]);
        const project = rows[0];
        if (!project) return send.notFound(res, "Project not found");

        const opts = {
          groupId: project.ruijie_group_id,
          tenantId: project.ruijie_tenant_id,
        };
        const { cloudSync, devices, error, reason } = await ruijie.getDevices(opts);

        // Pull current online clients and attach per-AP counts.
        let clientTotal = 0;
        if (cloudSync) {
          const { total, byDeviceSn } = await ruijie.getClients(opts);
          clientTotal = total;
          for (const d of devices) {
            if (byDeviceSn[d.sn] != null) d.clientCount = byDeviceSn[d.sn];
          }
        }

        const gateways = devices.filter((d) => d.type === "gateway");
        const aps = devices.filter((d) => d.type === "ap");
        const switches = devices.filter((d) => d.type === "switch");
        const others = devices.filter((d) => d.type === "other");

        const onlineCount = (arr) => arr.filter((d) => d.online).length;
        const onlineGw = gateways.find((g) => g.online);

        const summary = {
          totalDevices: devices.length,
          onlineDevices: onlineCount(devices),
          offlineDevices: devices.length - onlineCount(devices),
          apTotal: aps.length,
          apOnline: onlineCount(aps),
          gatewayTotal: gateways.length,
          gatewayOnline: onlineCount(gateways),
          switchTotal: switches.length,
          switchOnline: onlineCount(switches),
          clients: clientTotal || aps.reduce((s, a) => s + (a.clientCount || 0), 0),
        };

        // Internet status from the gateway's real WAN port (Ruijie API 2.6.4).
        // Fall back to "is a gateway online" only if the WAN query is unavailable.
        let internet = {
          up: gateways.length > 0 ? gateways.some((g) => g.online) : null,
          publicIp: onlineGw?.publicIp || null,
        };
        if (cloudSync && onlineGw) {
          const wan = await ruijie.getGatewayInterfaces(onlineGw.sn);
          if (wan && wan.internetUp !== null && wan.internetUp !== undefined) {
            internet = { up: wan.internetUp, publicIp: wan.wanIp || onlineGw.publicIp || null };
            onlineGw.publicIp = wan.wanIp || onlineGw.publicIp;
            onlineGw.wanUp = wan.internetUp;
          }
        }

        return send.ok(res, {
          project: mapProject(project),
          cloudSync,
          // surfaced so the UI can explain an empty result (scope not enabled, etc.)
          notice: cloudSync ? null : reason || error || "Device data unavailable",
          summary,
          internet,
          topology: { internet, gateways, aps, switches, others },
          devices,
        });
      } catch (e) {
        console.error(e);
        return send.serverErr(res);
      }
    },
  };
}
