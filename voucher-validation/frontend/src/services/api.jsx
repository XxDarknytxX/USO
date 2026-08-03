// src/services/api.js
// Resolves the backend base URL.
//   - Production: VITE_API_URL is unset; Nginx proxies `/api/*` to the
//     backend on the same origin, so we return "/api" (relative).
//   - Dev: set VITE_API_URL=http://localhost:4001/api (or use Vite proxy).
const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? authHeader() : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// Voucher API helpers
export const voucherApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers${qs ? `?${qs}` : ""}`);
  },
  detail: (uuid) => api(`/vouchers/${uuid}`),
  create: (body) => api("/vouchers", { method: "POST", body }),
  update: (uuid, body) => api(`/vouchers/${uuid}`, { method: "PUT", body }),
  remove: (uuid) => api(`/vouchers/${uuid}`, { method: "DELETE" }),
  toggle: (uuid) => api(`/vouchers/${uuid}/toggle`, { method: "PATCH" }),
  bulk: (action, uuids) => api("/vouchers/bulk", { method: "POST", body: { action, uuids } }),
  search: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/search${qs ? `?${qs}` : ""}`);
  },
  stats: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/stats${qs ? `?${qs}` : ""}`);
  },
  userGroups: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/user-groups${qs ? `?${qs}` : ""}`);
  },
  historical: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/historical${qs ? `?${qs}` : ""}`);
  },
  restore: (uuid) => api(`/vouchers/restore/${uuid}`, { method: "POST" }),
  sync: () => api("/vouchers/sync", { method: "POST" }),
  testConnection: () => api("/vouchers/test-connection"),
  // params: { page, limit, type: 'manual'|'auto' } — omit type for all.
  syncLogs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/sync-logs${qs ? `?${qs}` : ""}`);
  },
  // The sync now runs in the background; poll the sync log until this run's row
  // reports a terminal status. Resolves with the completed log row, or null on
  // timeout (the sync may still be finishing). Only hits the local sync-log
  // endpoint — no Ruijie calls.
  waitForSync: async (syncId, { intervalMs = 3000, timeoutMs = 420000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      let logs = [];
      try {
        ({ logs = [] } = await api("/vouchers/sync-logs"));
      } catch { /* transient — keep polling */ continue; }
      const log = logs.find((l) => l.id === syncId);
      if (log && (log.status === "completed" || log.status === "failed")) return log;
    }
    return null;
  },
  activity: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/activity${qs ? `?${qs}` : ""}`);
  },
};

// Settings API helpers
export const settingsApi = {
  get: () => api("/settings"),
  update: (key, value, type = "string") =>
    api("/settings", { method: "PUT", body: { key, value, type } }),
  syncStatus: () => api("/settings/sync-status"),
  // Atomic schedule update — both keys committed together server-side, single reload.
  updateSync: (enabled, intervalMinutes) =>
    api("/settings/sync", { method: "PUT", body: { enabled, intervalMinutes } }),
};

// Portal Audit Log API helpers
export const portalAuditApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/audit-logs${qs ? `?${qs}` : ""}`);
  },
  transactionFlows: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/transaction-flows${qs ? `?${qs}` : ""}`);
  },
};

// Portal Config API helpers
export const portalConfigApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/plans${qs ? `?${qs}` : ""}`);
  },
  detail: (id) => api(`/portal-config/plans/${id}`),
  create: (body) => api("/portal-config/plans", { method: "POST", body }),
  update: (id, body) => api(`/portal-config/plans/${id}`, { method: "PUT", body }),
  remove: (id) => api(`/portal-config/plans/${id}`, { method: "DELETE" }),
  revenue: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/revenue${qs ? `?${qs}` : ""}`);
  },
  manualAssistance: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/manual-assistance${qs ? `?${qs}` : ""}`);
  },
  resolveManualAssistance: (transactionId) =>
    api(`/portal-config/manual-assistance/${encodeURIComponent(transactionId)}/resolve`, { method: "POST" }),
};

// Network monitoring API helpers
export const networkApi = {
  projects: () => api("/network/projects"),
  overview: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/network/overview${qs ? `?${qs}` : ""}`);
  },
  trend: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/network/overview/history${qs ? `?${qs}` : ""}`);
  },
  discoverGroups: () => api("/network/discover"),
  createProject: (body) => api("/network/projects", { method: "POST", body }),
  updateProject: (id, body) => api(`/network/projects/${id}`, { method: "PUT", body }),
  removeProject: (id) => api(`/network/projects/${id}`, { method: "DELETE" }),
  // Plain call = cached snapshot (no Ruijie). { refresh: true } = live fetch,
  // only ever triggered by an explicit Refresh click.
  health: (id, { refresh } = {}) => api(`/network/projects/${id}/health${refresh ? "?refresh=1" : ""}`),
};

// User management API helpers
export const userApi = {
  me: () => api("/me"),
  list: () => api("/users"),
  create: (body) => api("/users", { method: "POST", body }),
  update: (id, body) => api(`/users/${id}`, { method: "PUT", body }),
  remove: (id) => api(`/users/${id}`, { method: "DELETE" }),
};

// M-PAiSA number→email mapping. `upload` sends the report as decoded text.
export const mpaisaApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/mpaisa${qs ? `?${qs}` : ""}`);
  },
  upload: (content) => api("/mpaisa/upload", { method: "POST", body: { content } }),
};
