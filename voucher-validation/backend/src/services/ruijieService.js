// src/services/ruijieService.js
import fetch from 'node-fetch';

// ── Process-wide Ruijie Cloud request limiter + circuit breaker ───────────
// Ruijie Cloud enforces an account-level quota; over-calling returns
// { code: 44, msg: "Too many requests." } (HTTP 200) or HTTP 429, and stays
// throttled until the quota recovers. RETRYING makes it worse (each retry
// burns more of an exhausted quota), so we DON'T retry. Instead:
//   • all calls are serialized + spaced ≥ MIN_GAP through one shared gate;
//   • when Ruijie throttles, we OPEN a circuit and SKIP the non-critical
//     network-monitoring calls for a cooldown so the quota can recover — while
//     the customer-critical voucher/auth calls still go through.
const RUIJIE_MIN_GAP_MS = 220;                       // min spacing between calls
const RUIJIE_CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;   // pause monitoring on throttle
const _limiter = { chain: Promise.resolve(), lastAt: 0 };
const _circuit = { openUntil: 0 };

// Non-critical, high-volume monitoring endpoints (device list, live clients,
// gateway port info, gateway usage). These are the ones we skip while throttled.
const _MONITORING_RE = /\/maint\/devices|\/current-user|\/gateway\/intf\/info|\/appflow\//;

function _rateLimited(status, body) {
  if (status === 429) return true;
  if (body?.code === 44) return true; // Ruijie "Too many requests."
  const msg = (body?.msg ?? body?.message ?? '').toString().toLowerCase();
  return /too many|request limited|too frequent|rate.?limit|限流|频繁/.test(msg);
}

// Synthetic reply returned (instantly, no network) while the circuit is open.
function _throttledResponse() {
  const body = { code: 44, msg: 'Too many requests. (Ruijie cooldown active — call skipped)' };
  const text = JSON.stringify(body);
  return {
    ok: false, status: 429, statusText: 'Too Many Requests',
    headers: { get: () => null },
    json: async () => body,
    text: async () => text,
  };
}

// Drop-in replacement for fetch(): serialized, spaced, circuit-breaking, and
// NON-retrying. Reads the body once (no clone/tee) and returns a Response-like
// object ({ ok, status, statusText, headers, json(), text() }) so callers keep
// using response.ok / await response.json() unchanged.
// NOTE: this MUST call the real node-fetch `fetch` internally, never itself.
function ruijieFetch(url, options) {
  const run = _limiter.chain.then(async () => {
    // While Ruijie is throttling, skip the non-critical monitoring calls
    // entirely so the quota recovers and nothing stalls the shared gate.
    if (_MONITORING_RE.test(String(url)) && Date.now() < _circuit.openUntil) {
      return _throttledResponse();
    }

    const wait = Math.max(0, _limiter.lastAt + RUIJIE_MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));

    let status, statusText, ok, headers, text = '';
    try {
      const res = await fetch(url, options);
      ({ status, statusText, ok, headers } = res);
      text = await res.text();
    } finally {
      _limiter.lastAt = Date.now();
    }

    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    if (_rateLimited(status, body)) {
      // Any throttle signal (from any call) pauses monitoring — no retry.
      if (Date.now() >= _circuit.openUntil) {
        console.warn(`[ruijie] rate-limited (code=${body?.code ?? status}) — pausing monitoring calls for ${Math.round(RUIJIE_CIRCUIT_COOLDOWN_MS / 60000)} min`);
      }
      _circuit.openUntil = Date.now() + RUIJIE_CIRCUIT_COOLDOWN_MS;
    }

    return {
      ok, status, statusText, headers,
      json: async () => JSON.parse(text),   // throws on non-JSON, like Response.json()
      text: async () => text,
    };
  });
  // Keep the shared chain alive even if this call rejects.
  _limiter.chain = run.then(() => {}, () => {});
  return run;
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// True when a download response body is an actual Excel file (vs. a JSON
// "not ready"/error body the report endpoint returns before the file exists).
function _isExcelContentType(contentType) {
  const v = String(contentType || '').toLowerCase();
  return (
    v.startsWith('application/vnd.ms-excel') ||
    v.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
    v.startsWith('application/octet-stream') ||
    v.includes('spreadsheetml')
  );
}

// .xlsx is a ZIP container, so real bytes start with the ZIP magic "PK" (50 4B).
// Sniffing this lets us accept a valid file even when the server sends a blank/
// missing content-type (the vendor reference explicitly treats blank as valid).
function _looksLikeXlsx(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

// Binary-aware sibling of ruijieFetch, for the xlsx report download. Shares the
// same serialized + spaced gate and circuit breaker, but reads the body as raw
// BYTES (ruijieFetch reads text(), which corrupts binary). Returns the Buffer
// plus contentType, and — when the body is JSON (error / not-ready / throttle) —
// the parsed body so the caller can branch and so a throttle still trips the
// circuit. Non-retrying at this layer; the caller decides whether to poll.
function ruijieFetchBinary(url, options) {
  const run = _limiter.chain.then(async () => {
    const wait = Math.max(0, _limiter.lastAt + RUIJIE_MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));

    let status, statusText, ok, headers, buffer = Buffer.alloc(0);
    try {
      const res = await fetch(url, options);
      ({ status, statusText, ok, headers } = res);
      buffer = Buffer.from(await res.arrayBuffer());
    } finally {
      _limiter.lastAt = Date.now();
    }

    const contentType = (headers?.get?.('content-type') || '').toLowerCase();

    // Only try to JSON-parse when it clearly isn't an xlsx (by content-type AND
    // by magic bytes) — stringifying/parsing megabytes of binary just to throw
    // would waste time, and a valid file can arrive with a blank content-type.
    let body = null;
    if (!_isExcelContentType(contentType) && !_looksLikeXlsx(buffer)) {
      try { body = JSON.parse(buffer.toString('utf8')); } catch { /* non-JSON body */ }
    }

    if (_rateLimited(status, body)) {
      if (Date.now() >= _circuit.openUntil) {
        console.warn(`[ruijie] rate-limited (code=${body?.code ?? status}) on download — pausing monitoring calls for ${Math.round(RUIJIE_CIRCUIT_COOLDOWN_MS / 60000)} min`);
      }
      _circuit.openUntil = Date.now() + RUIJIE_CIRCUIT_COOLDOWN_MS;
    }

    return { ok, status, statusText, contentType, body, buffer };
  });
  _limiter.chain = run.then(() => {}, () => {});
  return run;
}

class RuijieService {
  constructor() {
    this.baseUrl = process.env.RUIJIE_API_BASE_URL;
    this.appId = process.env.RUIJIE_APP_ID;
    this.appSecret = process.env.RUIJIE_APP_SECRET;
    this.groupId = process.env.RUIJIE_GROUP_ID;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  buildUrl(path) {
    const base = this.baseUrl?.replace(/\/+$/, '') || '';
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  // True while the shared circuit breaker is open (Ruijie recently returned a
  // throttle). Lets callers proactively skip work rather than fire calls that are
  // guaranteed to fail into an already-exhausted quota.
  isThrottled() {
    return Date.now() < _circuit.openUntil;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const tokenUrl = this.buildUrl(
        `/oauth20/client/access_token?token=d63dss0a81e4415a889ac5b78fsc904a`
      );

      const response = await ruijieFetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: this.appId, secret: this.appSecret }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const data = await response.json();

      const okCode = data?.code === 0 || data?.code === 200;

      const token =
        data?.data?.access_token ??
        data?.access_token ??
        data?.accessToken ??
        null;

      if (!okCode || !token) {
        console.error('Unexpected token payload:', JSON.stringify(data));
        throw new Error('Token response missing access token');
      }

      this.accessToken = token;

      const ttlSec =
        data?.data?.expires_in ??
        data?.expires_in ??
        data?.expireIn ??
        7200;
      this.tokenExpiry = Date.now() + ttlSec * 1000;

      return this.accessToken;
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw error;
    }
  }

  // ── Read APIs (documented & working) ────────────────────────

  /**
   * 2.3.3 Query Voucher List
   * GET /open/auth/voucher/getList/{groupId}
   */
  async getVouchers(start = 0, pageSize = 100, opts = {}, _retried = false) {
    try {
      const accessToken = await this.getAccessToken();
      const gid = opts.groupId || this.groupId;
      const tid = opts.tenantId || process.env.RUIJIE_TENANT_ID;

      const voucherUrl = this.buildUrl(`/open/auth/voucher/getList/${gid}`);
      const url = new URL(voucherUrl);
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('start', String(start));
      url.searchParams.append('pageSize', String(pageSize));
      if (tid) url.searchParams.append('tenantId', String(tid));

      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) {
        // code 3 = "Login timeout" — token expired, clear cache and retry once
        if (this.isTokenExpired(data) && !_retried) {
          console.log('Ruijie token expired (Login timeout) in getVouchers, refreshing...');
          this.invalidateToken();
          return this.getVouchers(start, pageSize, opts, true);
        }
        console.error('Voucher list payload not OK:', JSON.stringify(data));
        throw new Error(data?.msg || 'Voucher list error');
      }

      const list = data?.list ?? data?.voucherData?.list ?? [];
      const count = data?.count ?? data?.voucherData?.count ?? 0;
      return { vouchers: list, total: count, hasMore: start + pageSize < count };
    } catch (error) {
      console.error('Failed to fetch vouchers:', error);
      throw error;
    }
  }

  /** Fetch every voucher for a site (groupId). Defaults to the env group. */
  async getAllVouchers(opts = {}) {
    const allVouchers = [];
    let start = 0;
    const pageSize = 100;
    let hasMore = true;
    while (hasMore) {
      const result = await this.getVouchers(start, pageSize, opts);
      allVouchers.push(...result.vouchers);
      hasMore = result.hasMore;
      start += pageSize;
      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }
    return allVouchers;
  }

  // ── Excel export flow (voucher usage sync — ONE API call for ALL vouchers) ──
  // Replaces the paginated getAllVouchers() polling for the sync job. Ruijie
  // generates an .xlsx server-side; we fetch the whole voucher list in a single
  // export call (pageSize=0) instead of N paged getList calls, which is the
  // capacity fix for the account-wide code:44 throttle.

  /**
   * Request a full voucher export for a site and return the generated fileName.
   * GET /intlSamVoucher/export/{groupId}?pageSize=0  → { code:0, fileName }.
   * pageSize=0 = ALL vouchers in one call. JSON response (via ruijieFetch).
   */
  async exportVouchersExcel(opts = {}, _retried = false) {
    const accessToken = await this.getAccessToken();
    const gid = opts.groupId || this.groupId;
    if (!gid) throw new Error('exportVouchersExcel: missing groupId');

    const url = new URL(this.buildUrl(`/intlSamVoucher/export/${gid}`));
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('ishttps', 'false');
    url.searchParams.set('start', '0');
    url.searchParams.set('pageSize', '0');          // 0 = export every voucher
    url.searchParams.set('lang', 'en');
    url.searchParams.set('createBegin', opts.createBegin || '');
    url.searchParams.set('createEnd', opts.createEnd || '');
    url.searchParams.set('name', opts.name || '');
    url.searchParams.set('status', opts.status || '');
    url.searchParams.set('userMac', opts.userMac || '');

    const response = await ruijieFetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!response.ok) throw new Error(`Voucher export HTTP ${response.status} ${response.statusText}`);

    const data = await response.json();
    if (data?.code !== 0) {
      // code 3/4 = token expired → refresh once, mirroring getVouchers().
      if (this.isTokenExpired(data) && !_retried) {
        console.log('Ruijie token expired in exportVouchersExcel, refreshing...');
        this.invalidateToken();
        return this.exportVouchersExcel(opts, true);
      }
      throw new Error(`Voucher export failed: code=${data?.code} ${data?.msg || ''}`);
    }
    if (!data?.fileName) throw new Error('Voucher export returned no fileName');
    return data.fileName;
  }

  /**
   * Download a previously-exported voucher .xlsx as a Buffer. The report is
   * generated asynchronously, so we poll until the bytes are ready. A JSON body
   * means "not ready"/error; a throttle (code 44 / HTTP 429) aborts immediately —
   * retrying would burn more quota. The poll window (default 10 × 12s = 120s)
   * matches the vendor's expectation that large-site reports can take a while.
   * GET /report?path={fileName}.
   */
  async downloadVoucherExcel(fileName, { attempts = 10, intervalMs = 12000 } = {}) {
    const accessToken = await this.getAccessToken();
    const url = new URL(this.buildUrl('/report'));
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('ishttps', 'false');
    url.searchParams.set('path', fileName);

    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const r = await ruijieFetchBinary(url.toString(), { method: 'GET', headers: { Accept: '*/*' } });

      // Accept when the bytes are Excel by content-type OR by the .xlsx/ZIP magic
      // "PK" — the report can arrive with a blank content-type (which the vendor
      // reference treats as valid), so don't reject on content-type alone.
      if (r.ok && r.buffer.length > 0 && (_isExcelContentType(r.contentType) || _looksLikeXlsx(r.buffer))) {
        return r.buffer;
      }
      if (_rateLimited(r.status, r.body)) {
        throw new Error(`Voucher report download throttled (code=${r.body?.code ?? r.status}) — aborting to protect quota`);
      }
      lastErr = new Error(
        `Voucher report not ready (attempt ${attempt}/${attempts}, status=${r.status}, contentType=${r.contentType || 'none'}, code=${r.body?.code ?? ''})`
      );
      if (attempt < attempts) await _sleep(intervalMs);
    }
    throw lastErr;
  }

  /** Convenience: export a site's vouchers and download the file. */
  async exportAndDownloadVoucherExcel(opts = {}) {
    const fileName = await this.exportVouchersExcel(opts);
    const buffer = await this.downloadVoucherExcel(fileName, opts.download);
    return { fileName, buffer };
  }

  /**
   * Enumerate all network groups (sites/projects) under this account.
   * Ruijie Cloud API §2.2.1: GET /service/api/group/single/tree?depth=DEVICE
   * Returns a flat list { groupId, name, type, parentName } for the
   * "Add site" picker. Each groupId is a site vouchers can be scoped to.
   */
  async getNetworkGroups(_retried = false) {
    try {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl('/group/single/tree'));
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('depth', 'DEVICE');

      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));

      if (this.isTokenExpired(data) && !_retried) {
        this.invalidateToken();
        return this.getNetworkGroups(true);
      }
      const okCode = data?.code === 0 || data?.code === 200 || data?.code === undefined;
      if (!okCode) return { groups: [], error: data?.msg };

      const out = [];
      const walk = (node, parentName) => {
        if (!node) return;
        const gid = node.groupId;
        if (gid !== undefined && gid !== null && String(gid) !== '0') {
          out.push({
            groupId: String(gid),
            name: node.name,
            type: node.type || null,
            parentName: parentName || null,
          });
        }
        for (const sub of node.subGroups || []) walk(sub, node.name);
      };
      walk(data?.groups, null);
      return { groups: out };
    } catch (error) {
      console.error('Failed to fetch network groups:', error.message);
      return { groups: [], error: error.message };
    }
  }

  /**
   * Get User Group List (profiles)
   * GET /intl/usergroup/list/{groupId}?pageIndex=0&pageSize=100&access_token=...
   * Returns profiles with id (userGroupId) and authProfileId (profile UUID for voucher creation)
   */
  /**
   * Invalidate the cached token so the next call to getAccessToken() fetches a fresh one.
   * Call this when the Ruijie API returns code 3 ("Login timeout").
   */
  invalidateToken() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Check if an API response indicates an expired/invalid token.
   */
  isTokenExpired(data) {
    // Per the Ruijie Cloud manual §Appendix: code 3 = "Token is invalid",
    // code 4 = "Token is overdued" (expired). Both mean re-auth. (The 30-day
    // token also silently expires after 30 min of inactivity → code 4.)
    const code = data?.code;
    const msg = (data?.msg || '').toLowerCase();
    return code === 3 || code === 4
      || msg.includes('login timeout')
      || msg.includes('token is invalid')
      || msg.includes('overdue');
  }

  async getUserGroups(opts = {}, _retried = false) {
    try {
      const accessToken = await this.getAccessToken();
      const gid = opts.groupId || this.groupId;
      const url = new URL(this.buildUrl(`/intl/usergroup/list/${gid}`));
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('pageIndex', '0');
      url.searchParams.append('pageSize', '100');

      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) {
        if (this.isTokenExpired(data) && !_retried) {
          console.log('Ruijie token expired (Login timeout) in getUserGroups, refreshing...');
          this.invalidateToken();
          return this.getUserGroups(opts, true);
        }
        throw new Error(data?.msg || 'Get user groups failed');
      }

      const list = data?.data ?? [];
      return { cloudSync: true, data: list };
    } catch (error) {
      console.error('Failed to fetch user groups:', error);
      return { cloudSync: false, data: [] };
    }
  }

  async testConnection() {
    try {
      const token = await this.getAccessToken();
      return { success: true, hasToken: !!token, message: 'API connection successful' };
    } catch (error) {
      return { success: false, error: error.message, message: 'API connection failed' };
    }
  }

  // ── Device health / network monitoring ─────────────────────

  /**
   * Device list + status for network-health monitoring.
   * Ruijie Cloud API §2.6.1.1 "AP / Switch List":
   *   GET /service/api/maint/devices
   *   QueryParams: access_token, group_id, common_type (AP|Switch|Gateway),
   *                page (record offset, 0-based), per_page
   *   Response: { code, msg, deviceList:[...], totalCount }
   *
   * IMPORTANT: params are snake_case (group_id, common_type) — passing
   * camelCase groupId is what produced "Parameter groupId is null".
   * common_type is mandatory and selects ONE class, so we loop AP/Switch/
   * Gateway and merge, paginating by record offset. Never throws — returns
   * { cloudSync, devices, reason? } so the dashboard degrades gracefully.
   *
   * @param {{ groupId?: string|number, tenantId?: string }} [opts]
   */
  async getDevices({ groupId, tenantId } = {}, _retried = false) {
    // || (not ??) so an empty-string project value falls back to the same
    // RUIJIE_GROUP_ID the voucher/usergroup APIs already use.
    const gid = groupId || this.groupId;
    const tid = tenantId || process.env.RUIJIE_TENANT_ID;
    if (!gid) {
      console.warn('getDevices: no group_id available (project + RUIJIE_GROUP_ID both empty)');
      return { cloudSync: false, devices: [], reason: 'No Ruijie group ID configured' };
    }

    const PER_PAGE = 100;
    try {
      const accessToken = await this.getAccessToken();
      const merged = [];
      let anyOk = false;
      let lastMsg = null;

      for (const commonType of ['AP', 'Switch', 'Gateway']) {
        let offset = 0;
        for (let guard = 0; guard < 50; guard++) {
          const url = new URL(this.buildUrl('/maint/devices'));
          url.searchParams.append('access_token', accessToken);
          url.searchParams.append('group_id', String(gid));
          url.searchParams.append('common_type', commonType);
          url.searchParams.append('page', String(offset));      // record offset, 0-based
          url.searchParams.append('per_page', String(PER_PAGE));
          if (tid) url.searchParams.append('tenantId', String(tid));

          const response = await ruijieFetch(url.toString(), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await response.json().catch(() => ({}));

          if (this.isTokenExpired(data) && !_retried) {
            this.invalidateToken();
            return this.getDevices({ groupId, tenantId }, true);
          }

          const okCode = data?.code === 0 || data?.code === 200 || data?.code === undefined;
          if (!response.ok || !okCode) {
            lastMsg = data?.msg || `HTTP ${response.status}`;
            console.warn(`getDevices ${commonType}: code=${data?.code} msg=${data?.msg} status=${response.status}`);
            break; // skip this device class, continue with the next
          }

          anyOk = true;
          const list = data?.deviceList || data?.data?.deviceList || [];
          for (const d of list) merged.push({ ...d, commonType: d.commonType || commonType });
          const total = Number(data?.totalCount ?? list.length);
          offset += PER_PAGE;
          if (offset >= total || list.length === 0) break;
        }
      }

      // Reyee gateways (EG/EGW) sometimes aren't returned under
      // common_type=Gateway on the "AP/Switch list" endpoint. If no gateway
      // came back, retry with product_type=EGW (2.6.1.1 alternate param).
      const hasGateway = merged.some((d) =>
        /gateway|egw|router|\beg\b/i.test(`${d.commonType || ''} ${d.productType || ''} ${d.productClass || ''}`)
      );
      if (!hasGateway) {
        try {
          const url = new URL(this.buildUrl('/maint/devices'));
          url.searchParams.append('access_token', accessToken);
          url.searchParams.append('group_id', String(gid));
          url.searchParams.append('product_type', 'EGW');
          url.searchParams.append('page', '0');
          url.searchParams.append('per_page', String(PER_PAGE));
          if (tid) url.searchParams.append('tenantId', String(tid));
          const response = await ruijieFetch(url.toString(), { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          const data = await response.json().catch(() => ({}));
          const list = data?.deviceList || data?.data?.deviceList || [];
          for (const d of list) merged.push({ ...d, commonType: d.commonType || 'Gateway' });
          if (list.length) anyOk = true;
          console.log(`getDevices EGW-fallback group ${gid}: ${list.length} gateway(s) (code=${data?.code} msg=${data?.msg ?? ''})`);
        } catch (e) { console.warn('getDevices EGW fallback failed:', e.message); }
      }

      const counts = merged.reduce((m, d) => { const t = d.commonType || '?'; m[t] = (m[t] || 0) + 1; return m; }, {});
      console.log(`getDevices group ${gid}: ${merged.length} device(s)`, JSON.stringify(counts));

      if (!anyOk) {
        return { cloudSync: false, devices: [], reason: lastMsg || 'Device API returned no data' };
      }
      return { cloudSync: true, devices: merged.map((d) => this._normalizeDevice(d)) };
    } catch (error) {
      console.error('Failed to fetch devices:', error.message);
      return { cloudSync: false, devices: [], error: error.message };
    }
  }

  /**
   * Current online clients (Ruijie Cloud API §3.0):
   *   GET /service/api/open/v1/dev/user/current-user
   *   QueryParams: access_token, group_id, page_index, page_size
   *   Response: { code, list:[{ mac, linkedDevice(SN), deviceName }], totalCount }
   * Returns { total, byDeviceSn } so APs get per-device client counts.
   */
  async getClients({ groupId, tenantId } = {}, _retried = false) {
    const gid = groupId || this.groupId;
    const tid = tenantId || process.env.RUIJIE_TENANT_ID;
    if (!gid) return { total: 0, byDeviceSn: {} };
    try {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl('/open/v1/dev/user/current-user'));
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('group_id', String(gid));
      url.searchParams.append('page_index', '0');
      url.searchParams.append('page_size', '1000');
      if (tid) url.searchParams.append('tenantId', String(tid));

      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));

      if (this.isTokenExpired(data) && !_retried) {
        this.invalidateToken();
        return this.getClients({ groupId, tenantId }, true);
      }

      const list = data?.list || [];
      const byDeviceSn = {};
      for (const c of list) {
        const sn = c.linkedDevice || c.sn;
        if (sn) {
          const key = String(sn).toUpperCase();   // match APs case-insensitively
          byDeviceSn[key] = (byDeviceSn[key] || 0) + 1;
        }
      }
      const total = Number(data?.totalCount ?? list.length);
      console.log(`getClients group ${gid}: total=${total} list=${list.length} linkedTo=${JSON.stringify(Object.keys(byDeviceSn).slice(0, 8))} (code=${data?.code} msg=${data?.msg ?? ''})`);
      return { total, byDeviceSn };
    } catch (error) {
      console.error('Failed to fetch clients:', error.message);
      return { total: 0, byDeviceSn: {} };
    }
  }

  /**
   * Gateway port / WAN status (Ruijie Cloud API §2.6.4):
   *   GET /service/api/gateway/intf/info/{sn}?access_token=
   *   Response: { code, data:[{ type:"WAN"|"LAN", linestatus, ipAddr, ... }] }
   * The WAN port's linestatus is the REAL "internet up" indicator that the
   * Ruijie Cloud topology shows — not just "is the gateway online".
   */
  async getGatewayInterfaces(sn, _retried = false) {
    if (!sn) return null;
    try {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/gateway/intf/info/${encodeURIComponent(sn)}`));
      url.searchParams.append('access_token', accessToken);
      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (this.isTokenExpired(data) && !_retried) {
        this.invalidateToken();
        return this.getGatewayInterfaces(sn, true);
      }
      const okCode = data?.code === 0 || data?.code === 200 || data?.code === undefined;
      if (!response.ok || !okCode) {
        console.warn(`getGatewayInterfaces ${sn}: code=${data?.code} msg=${data?.msg}`);
        return { ok: false, internetUp: null, wanIp: null };
      }
      const ports = Array.isArray(data?.data) ? data.data : [];
      const isUp = (p) => p && (p.linestatus === true || String(p.linestatus) === 'true');
      // Prefer an up WAN port; else any WAN port.
      const wanPorts = ports.filter((p) => String(p.type).toUpperCase() === 'WAN');
      const wan = wanPorts.find(isUp) || wanPorts[0] || null;
      return {
        ok: true,
        internetUp: wan ? isUp(wan) : null,
        wanIp: wan?.ipAddr || null,
        ports,
      };
    } catch (error) {
      console.error('Failed to fetch gateway interfaces:', error.message);
      return null;
    }
  }

  /**
   * Gateway total usage today (Ruijie Cloud API §2.9.2):
   *   GET /service/api/open/v1/dev/eg/appflow/data-day/appgroup
   *   Query: group_id, sn, intfName=all, start_time/end_time (YYYYMMDD), size
   * Sums upDownFlow across application groups → total bytes through the WAN today.
   */
  async getGatewayUsage(sn, groupId, _retried = false) {
    if (!sn) return { bytes: null };
    try {
      const accessToken = await this.getAccessToken();
      const gid = groupId || this.groupId;
      const d = new Date();
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const url = new URL(this.buildUrl('/open/v1/dev/eg/appflow/data-day/appgroup'));
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('group_id', String(gid));
      url.searchParams.append('sn', sn);
      url.searchParams.append('intfName', 'all');
      url.searchParams.append('start_time', ymd);
      url.searchParams.append('end_time', ymd);
      url.searchParams.append('size', '1000');
      const response = await ruijieFetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (this.isTokenExpired(data) && !_retried) {
        this.invalidateToken();
        return this.getGatewayUsage(sn, groupId, true);
      }
      const list = Array.isArray(data?.list) ? data.list : [];
      const bytes = list.reduce((s, x) => s + Number(x.upDownFlow || 0), 0);
      return { ok: data?.code === 0, bytes: list.length ? bytes : null };
    } catch (error) {
      console.error('Failed to fetch gateway usage:', error.message);
      return { bytes: null };
    }
  }

  /** Normalize a raw maint/devices record into a stable shape. */
  _normalizeDevice(d = {}) {
    const pick = (...keys) => {
      for (const k of keys) {
        if (d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k];
      }
      return undefined;
    };
    const rawStatus = pick('onlineStatus', 'status', 'online', 'isOnline', 'state');
    const su = String(rawStatus).toUpperCase();
    const online =
      su === 'ON' || su === 'ONLINE' ||
      rawStatus === 1 || rawStatus === '1' || rawStatus === true;
    const sn = pick('serialNumber', 'sn', 'serialNum', 'deviceSn');
    const rawType = String(pick('commonType', 'common_type', 'productType', 'deviceType', 'type') || '');
    return {
      sn: sn || pick('mac', 'macAddress') || `dev-${Math.random().toString(36).slice(2, 8)}`,
      name: pick('aliasName', 'name', 'deviceName', 'hostname') || sn || 'Unknown device',
      type: this._classifyType(rawType, pick('productClass', 'model', 'deviceModel')),
      rawType,
      online,
      model: pick('productClass', 'model', 'deviceModel', 'productModel') || '—',
      mac: pick('mac', 'macAddress') || '—',
      mgmtIp: pick('localIp', 'managementIp', 'manageIp', 'ip', 'lanIp') || '—',
      publicIp: pick('cpeIp', 'publicIp', 'egressIp', 'wanIp', 'outerIp') || null,
      clientCount: Number(pick('clientCount', 'staCount', 'userCount', 'clients') || 0),
      firmware: pick('softwareVersion', 'firmware', 'version', 'swVersion') || '—',
      offlineTime: !online ? (pick('lastOnline', 'offlineTime', 'lastOfflineTime') || null) : null,
    };
  }

  /** Bucket a device into gateway | ap | switch | other from its type/model. */
  _classifyType(rawType, model) {
    const s = `${rawType} ${model || ''}`.toLowerCase();
    if (s.includes('gateway') || s.includes('egw') || s.includes('router') || /\b(eg|nbr)\b/.test(s)) return 'gateway';
    if (s.includes('switch') || /\b(nbs|msw|es|xs|esw)\b/.test(s)) return 'switch';
    if (s.includes('access') || s.includes('ap') || /\b(rap|eap|wap)\b/.test(s)) return 'ap';
    return 'other';
  }

  // ── Write APIs ──────────────────────────────────────────────

  /**
   * Wrapper for cloud write operations.
   * If the endpoint doesn't exist (404/405), falls back gracefully.
   */
  async _tryCloudOperation(operationName, fn, _retried = false) {
    try {
      const result = await fn();
      return { cloudSync: true, ...result };
    } catch (error) {
      const msg = error.message || '';
      // Retry once on token expiry
      if ((msg.toLowerCase().includes('login timeout') || msg.includes('code 3')) && !_retried) {
        console.log(`Ruijie token expired in ${operationName}, refreshing and retrying...`);
        this.invalidateToken();
        return this._tryCloudOperation(operationName, fn, true);
      }
      if (msg.includes('404') || msg.includes('405') || msg.includes('Not Found') || msg.includes('Method Not Allowed')) {
        console.warn(`Ruijie API does not support "${operationName}", operating locally only`);
        return { cloudSync: false, localOnly: true };
      }
      throw error;
    }
  }

  /**
   * 2.3.1 Generate Voucher
   * POST /open/auth/voucher/create/{groupId}
   * Body: { quantity, profile, userGroupId, firstName?, lastName?, email?, phone?, comment? }
   */
  async createVoucher(payload) {
    return this._tryCloudOperation('createVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/create/${payload.groupId || this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      // API requires: quantity, profile (profileId UUID), userGroupId
      const body = {
        quantity: payload.quantity || 1,
        profile: payload.profile,
        userGroupId: payload.userGroupId,
      };
      // Optional user fields
      if (payload.firstName) body.firstName = payload.firstName;
      if (payload.lastName) body.lastName = payload.lastName;
      if (payload.email) body.email = payload.email;
      if (payload.phone) body.phone = payload.phone;
      if (payload.comment) body.comment = payload.comment;

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Create voucher failed');

      // Response: { voucherData: { count, list: [{ uuid, codeNo, status, profileId, expiryTime, limitClients, ... }] } }
      const voucherData = data?.voucherData ?? data;
      return { data: voucherData };
    });
  }

  /**
   * 2.3.2 Receive Customized Voucher
   * POST /open/auth/voucher/customerCreate/{groupId}/{code}
   * Body: { groupId, profile, userGroupId }
   */
  async createCustomVoucher(code, payload) {
    return this._tryCloudOperation('createCustomVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/customerCreate/${payload.groupId || this.groupId}/${code}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const body = {
        groupId: String(payload.groupId || this.groupId),
        profile: payload.profile,
        userGroupId: payload.userGroupId,
      };

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Create custom voucher failed');
      return { data };
    });
  }

  // ── Speculative APIs (not in docs, graceful fallback) ──────

  async updateVoucher(uuid, payload) {
    return this._tryCloudOperation('updateVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/update/${payload.groupId || this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, ...payload }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Update voucher failed');
      return { data };
    });
  }

  async deleteVouchers(uuids, groupId) {
    return this._tryCloudOperation('deleteVouchers', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/delete/${groupId || this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuids }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Delete vouchers failed');
      return { data };
    });
  }

  async disableVoucher(uuid, groupId) {
    return this._tryCloudOperation('disableVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/disable/${groupId || this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Disable voucher failed');
      return { data };
    });
  }

  async enableVoucher(uuid, groupId) {
    return this._tryCloudOperation('enableVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/enable/${groupId || this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await ruijieFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Enable voucher failed');
      return { data };
    });
  }
}

export default RuijieService;
