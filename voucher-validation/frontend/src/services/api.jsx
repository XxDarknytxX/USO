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

/**
 * `headers` exists for one case: two-factor enrolment during login, which holds
 * a short-lived setup token that has deliberately NOT been stored as the
 * session. Passing it explicitly is the only way to use it — anything spread
 * after the default auth header wins, so the caller's Authorization replaces
 * the stored one rather than being quietly ignored.
 */
export async function api(path, { method = "GET", body, auth = true, headers } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? authHeader() : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The status travels with the error. A caller that can only see the message
    // cannot tell "that link is not valid" (400) from "the server is down"
    // (5xx, or no response) — and told someone their link had expired when it
    // was the network that failed.
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    // The parsed body rides along too, for the few endpoints whose error says
    // more than a sentence — a campaign send refused with 409 carries the
    // audience's NEW size, which the confirmation has to show before asking
    // again. `{}` when the response had no JSON body.
    err.data = data;
    throw err;
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
  // Same shape for the network-health collection schedule.
  updateNetworkCollect: (enabled, intervalMinutes) =>
    api("/settings/network-collect", { method: "PUT", body: { enabled, intervalMinutes } }),
  // SMTP (outgoing email) config. getSmtp never returns the password (only
  // hasPassword); leave the password field blank on save to keep the stored one.
  getSmtp: () => api("/settings/smtp"),
  updateSmtp: (config) => api("/settings/smtp", { method: "PUT", body: config }),
  testSmtp: (to, template = "connection") =>
    api("/settings/smtp/test", { method: "POST", body: { to, template } }),

  // Starlink API credentials, shared across every village. getStarlink never
  // returns the client secret, only hasClientSecret; leave the secret field
  // blank on save to keep the stored one.
  getStarlink: () => api("/settings/starlink"),
  updateStarlink: (config) => api("/settings/starlink", { method: "PUT", body: config }),
  // Diagnoses the saved config step by step: credentials, token, real query.
  testStarlink: (serviceLineNumber) =>
    api("/settings/starlink/test", { method: "POST", body: { serviceLineNumber } }),
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
  // Everything about one month in a single call (totals + all series).
  breakdown: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/portal-config/breakdown${qs ? `?${qs}` : ""}`);
  },
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
  // body.email overrides the M-PAiSA mapping; omit it to use the mapped address.
  emailManualAssistance: (transactionId, body = {}) =>
    api(`/portal-config/manual-assistance/${encodeURIComponent(transactionId)}/email`, { method: "POST", body }),
  // Re-renders what was sent, for one *_email_sent audit row.
  emailPreview: (logId) => api(`/portal-config/email-preview/${encodeURIComponent(logId)}`),
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
  // Refresh every village's health now (admin). Costs Ruijie quota; the server
  // single-flights it, so a double click joins the run in progress.
  collectNow: () => api("/network/collect", { method: "POST" }),
  collectStatus: () => api("/network/collect/status"),
  createProject: (body) => api("/network/projects", { method: "POST", body }),
  updateProject: (id, body) => api(`/network/projects/${id}`, { method: "PUT", body }),
  removeProject: (id) => api(`/network/projects/${id}`, { method: "DELETE" }),
  // Plain call = cached snapshot (no Ruijie). { refresh: true } = live fetch,
  // only ever triggered by an explicit Refresh click.
  health: (id, { refresh } = {}) => api(`/network/projects/${id}/health${refresh ? "?refresh=1" : ""}`),
  // Starlink data usage for one village. One backend call covers three billing
  // cycles, so switching cycle never costs another Starlink request.
  starlink: (id, { cycle = "A" } = {}) => api(`/network/projects/${id}/starlink?cycle=${cycle}`),
};

// User management API helpers
export const userApi = {
  me: () => api("/me"),
  // Per-user UI preferences (village display filter, active scope) — synced
  // across the user's devices instead of living in one browser's localStorage.
  preferences: () => api("/me/preferences"),
  savePreferences: (prefs) => api("/me/preferences", { method: "PUT", body: { prefs } }),
  list: () => api("/users"),
  create: (body) => api("/users", { method: "POST", body }),
  update: (id, body) => api(`/users/${id}`, { method: "PUT", body }),
  remove: (id) => api(`/users/${id}`, { method: "DELETE" }),

  // Admin rescue. Returns { emailed, emailError, expiresHours }. Reset and
  // onboarding each email a one-time link — there is no password in any
  // response — and a link that could not be emailed is discarded server-side.
  resetPassword: (id) => api(`/users/${id}/reset-password`, { method: "POST", body: {} }),
  resetTwoFactor: (id) => api(`/users/${id}/reset-2fa`, { method: "POST", body: {} }),
  resendOnboarding: (id) => api(`/users/${id}/resend-onboarding`, { method: "POST", body: {} }),

  // Invitations. resendInvite replaces any outstanding one, so it covers both
  // "they never opened it" and "it went stale".
  resendInvite: (id) => api(`/users/${id}/invite`, { method: "POST", body: {} }),
  revokeInvite: (id) => api(`/users/${id}/invite`, { method: "DELETE" }),
};

// The invite link's own endpoints. Unauthenticated — whoever follows the link
// has no account to sign in with yet, so `auth: false` is the point, not an
// oversight.
export const inviteApi = {
  check: (token) => api("/invite/check", { method: "POST", body: { token }, auth: false }),
  accept: (token, password) =>
    api("/invite/accept", { method: "POST", body: { token, password }, auth: false }),
};

// Monthly billing against the per-village target. Admin only.
export const billingApi = {
  get: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/billing${qs ? `?${qs}` : ""}`);
  },
  setTarget: (target) => api("/billing/target", { method: "PUT", body: { target } }),
};

// Two-factor, for the current account and (policy) for the estate.
export const twoFactorApi = {
  status: () => api("/2fa/status"),
  disable: (password) => api("/2fa/disable", { method: "POST", body: { password } }),
  // A fresh set of ten, replacing whatever the account holds. The way back for
  // someone low on codes when the policy forbids disabling and re-enrolling.
  regenerateBackupCodes: (password) =>
    api("/2fa/backup-codes", { method: "POST", body: { password } }),
  policy: () => api("/2fa/policy"),
  // The audit trail. An admin gets the estate; anyone else gets their own rows
  // — the server decides, not the caller.
  events: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/2fa/events${qs ? `?${qs}` : ""}`);
  },
  setPolicy: (required) => api("/2fa/policy", { method: "PUT", body: { required } }),
  changePassword: (currentPassword, newPassword) =>
    api("/me/password", { method: "POST", body: { currentPassword, newPassword } }),
};

// M-PAiSA number→email mapping. `upload` sends the report as decoded text.
export const mpaisaApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/mpaisa${qs ? `?${qs}` : ""}`);
  },
  upload: (content) => api("/mpaisa/upload", { method: "POST", body: { content } }),
  // Paid transactions whose number has no mapping. Pass all: 1 for the CSV.
  unmapped: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/mpaisa/unmapped${qs ? `?${qs}` : ""}`);
  },
  create: (row) => api("/mpaisa", { method: "POST", body: row }),
  // `original` is the number of the row being edited; `row.number` may differ
  // (the number is the primary key and is itself editable).
  update: (original, row) =>
    api(`/mpaisa/${encodeURIComponent(original)}`, { method: "PUT", body: row }),
};

// Email campaigns. Admin only; the recipients are the inboxes in the M-PAiSA
// mapping, deduplicated by address. Blank filters are dropped from the query
// string so "any" is never sent as an empty `search=` the server has to guess
// about.
function campaignQuery(params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  const qs = new URLSearchParams(clean).toString();
  return qs ? `?${qs}` : "";
}

const campaignPath = (id, tail = "") => `/campaigns/${encodeURIComponent(id)}${tail}`;

export const campaignApi = {
  // params: { status: 'all'|'draft'|'active'|'done', search }
  list: (params = {}) => api(`/campaigns${campaignQuery(params)}`),
  // { contacts, purchasers, suppressed, sendPerMinute, smtp: { configured, enabled, from } }
  stats: () => api("/campaigns/stats"),
  create: (body = {}) => api("/campaigns", { method: "POST", body }),
  get: (id) => api(campaignPath(id)),
  // Drafts only — anything else is refused with 409.
  update: (id, body) => api(campaignPath(id), { method: "PUT", body }),
  remove: (id) => api(campaignPath(id), { method: "DELETE" }),
  duplicate: (id) => api(campaignPath(id, "/duplicate"), { method: "POST", body: {} }),

  // Renders unsaved content for a sample contact. Not tied to a campaign id, so
  // the editor can preview what is on screen rather than what was last saved.
  preview: (content) => api("/campaigns/preview", { method: "POST", body: content }),
  // params: { search, purchasersOnly, groupIds: string[], page, pageSize }
  contacts: (params = {}) => api(`/campaigns/contacts${campaignQuery(params)}`),
  // Who would receive it right now: { count, suppressedExcluded, sample }
  audienceCount: (audience) =>
    api("/campaigns/audience-count", { method: "POST", body: { audience } }),

  // Sends the SAVED draft to 1-5 addresses. 502 when every address failed.
  testSend: (id, to) => api(campaignPath(id, "/test"), { method: "POST", body: { to } }),
  // expectedCount is the number the admin confirmed. If the audience resolves to
  // anything else by now the server answers 409 with `{ error, count }` (see
  // err.data) instead of sending to people nobody agreed to.
  send: (id, expectedCount) =>
    api(campaignPath(id, "/send"), { method: "POST", body: { expectedCount } }),
  pause: (id) => api(campaignPath(id, "/pause"), { method: "POST", body: {} }),
  resume: (id) => api(campaignPath(id, "/resume"), { method: "POST", body: {} }),
  cancel: (id) => api(campaignPath(id, "/cancel"), { method: "POST", body: {} }),
  retryFailed: (id) => api(campaignPath(id, "/retry-failed"), { method: "POST", body: {} }),
  // params: { status: 'all'|'queued'|'sent'|'failed'|'skipped', search, page, pageSize }
  recipients: (id, params = {}) => api(campaignPath(id, `/recipients${campaignQuery(params)}`)),

  // The suppression list: addresses no campaign will ever send to.
  suppressions: (params = {}) => api(`/campaigns/suppressions${campaignQuery(params)}`),
  addSuppression: (email, note) => api("/campaigns/suppressions", { method: "POST", body: { email, note } }),
  removeSuppression: (email) =>
    api(`/campaigns/suppressions/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

// Service maintenance API. Photos go up base64 in the JSON body, already
// downscaled in the browser — see downscaleImage below.
export const maintenanceApi = {
  components: () => api("/maintenance/components"),
  villageProfile: (projectId) => api(`/maintenance/villages/${projectId}/profile`),
  // Uploads the File itself as the request body — see uploadDocument.
  addDocument: (projectId, file, meta = {}) => uploadDocument(projectId, file, meta),
  deleteDocument: (id) => api(`/maintenance/documents/${id}`, { method: "DELETE" }),

  // Site media — photos and video of the village itself.
  addMedia: (projectId, file, meta = {}) => uploadMedia(projectId, file, meta),
  // A five-minute pass so <img> and <video> can load without a header.
  mediaTicket: (projectId) => api(`/maintenance/villages/${projectId}/media/ticket`),
  mediaUrl: (id, ticket) => `${API_BASE_URL}/maintenance/media/${id}${ticket ? `?t=${encodeURIComponent(ticket)}` : ""}`,
  deleteMedia: (id) => api(`/maintenance/media/${id}`, { method: "DELETE" }),
  documentUrl: (id) => `${API_BASE_URL}/maintenance/documents/${id}`,
  schedule: () => api("/maintenance/schedule"),
  visits: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/maintenance/visits${qs ? `?${qs}` : ""}`);
  },
  visit: (id) => api(`/maintenance/visits/${id}`),
  createVisit: (body) => api("/maintenance/visits", { method: "POST", body }),
  updateVisit: (id, body) => api(`/maintenance/visits/${id}`, { method: "PUT", body }),
  submitVisit: (id) => api(`/maintenance/visits/${id}/submit`, { method: "POST" }),
  deleteVisit: (id) => api(`/maintenance/visits/${id}`, { method: "DELETE" }),
  // File one component at a time — the normal path.
  submitCheck: (visitId, key) =>
    api(`/maintenance/visits/${visitId}/checks/${key}/submit`, { method: "POST" }),
  reopenCheck: (visitId, key, reason) =>
    api(`/maintenance/visits/${visitId}/checks/${key}/reopen`, { method: "POST", body: { reason } }),
  submissions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/maintenance/submissions${qs ? `?${qs}` : ""}`);
  },
  reopenVisit: (id, reason) => api(`/maintenance/visits/${id}/reopen`, { method: "POST", body: { reason } }),
  addPhoto: (visitId, body) => api(`/maintenance/visits/${visitId}/photos`, { method: "POST", body }),
  deletePhoto: (photoId) => api(`/maintenance/photos/${photoId}`, { method: "DELETE" }),
  // The <img> src for a stored photo. It is behind auth, so it cannot be a bare
  // URL in an <img> tag — the component fetches it as a blob instead.
  photoUrl: (photoId) => `${API_BASE_URL}/maintenance/photos/${photoId}`,
};

/**
 * Fetch an authenticated photo as an object URL. The photo route needs the
 * Bearer token, which a plain <img src> cannot send.
 * Caller must URL.revokeObjectURL when done.
 */
export async function fetchPhotoObjectUrl(photoId) {
  const res = await fetch(maintenanceApi.photoUrl(photoId), { headers: { ...authHeader() } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Open an authenticated document in a new tab. Documents sit behind the API, so
 * a plain link cannot carry the Bearer token — fetch it, then hand the browser
 * a blob URL. Revoked on a timer rather than immediately: revoking straight
 * away races the tab that is still loading it.
 */
export async function openDocument(documentId) {
  const res = await fetch(maintenanceApi.documentUrl(documentId), { headers: { ...authHeader() } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Upload a site document. The File goes up as the raw request body with its own
 * Content-Type; the metadata rides in the query string.
 *
 * Not base64-in-JSON like the photos: base64 costs 4/3, so a 100 MB handover
 * pack would become a ~133 MB string in the browser AND a ~133 MB body the
 * server holds in memory before decoding. Sending the File directly streams it
 * on both ends.
 */
/** Site media, uploaded the same way a document is: the body IS the file. */
export async function uploadMedia(projectId, file, { title, notes } = {}) {
  const qs = new URLSearchParams({
    fileName: file.name,
    title: title || "",
    notes: notes || "",
  });
  const res = await fetch(`${API_BASE_URL}/maintenance/villages/${projectId}/media?${qs}`, {
    method: "POST",
    headers: {
      ...authHeader(),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error("The server rejected the upload as too large (nginx client_max_body_size).");
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function uploadDocument(projectId, file, { title, category, notes } = {}) {
  const qs = new URLSearchParams({
    fileName: file.name,
    title: title || "",
    category: category || "other",
    notes: notes || "",
  });
  const res = await fetch(
    `${API_BASE_URL}/maintenance/villages/${projectId}/documents?${qs}`,
    {
      method: "POST",
      headers: {
        ...authHeader(),
        // The browser would otherwise guess; the server allow-lists this value.
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 413 comes from nginx, not the app, so it has no JSON body to explain itself.
    if (res.status === 413) {
      throw new Error("The server rejected the upload as too large (nginx client_max_body_size).");
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Downscale a camera photo in the browser before upload.
 *
 * A phone photo is 3-5 MB; these are filed from village Wi-Fi or mobile data,
 * where that is the difference between a report submitted and a report
 * abandoned. 1600px on the long edge at q0.8 is ~200-400 KB and still shows a
 * corroded connector clearly.
 */
export async function downscaleImage(file, { maxEdge = 1600, quality = 0.8 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { mimeType: "image/jpeg", dataBase64: dataUrl.split(",")[1], width: w, height: h };
}
