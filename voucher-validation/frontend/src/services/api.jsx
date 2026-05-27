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
  stats: () => api("/vouchers/stats"),
  userGroups: () => api("/vouchers/user-groups"),
  historical: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/vouchers/historical${qs ? `?${qs}` : ""}`);
  },
  restore: (uuid) => api(`/vouchers/restore/${uuid}`, { method: "POST" }),
  sync: () => api("/vouchers/sync", { method: "POST" }),
  testConnection: () => api("/vouchers/test-connection"),
  syncLogs: () => api("/vouchers/sync-logs"),
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
};

// User management API helpers
export const userApi = {
  me: () => api("/me"),
  list: () => api("/users"),
  create: (body) => api("/users", { method: "POST", body }),
  update: (id, body) => api(`/users/${id}`, { method: "PUT", body }),
  remove: (id) => api(`/users/${id}`, { method: "DELETE" }),
};
