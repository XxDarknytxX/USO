// src/services/starlinkService.js
// Reads data usage from the Starlink Enterprise v2 API for one service line.
//
// Ported from the Starlink WebApp Production Build (routes/usage.js,
// services/telemetryPoller.js), but deliberately NOT a straight copy. That app
// authenticates and fetches live on every request with no cache and no pacing.
// This codebase has already paid for that pattern once: Ruijie Cloud returns
// `code: 44` ("Too many requests") at the ACCOUNT level and stays throttled for
// a long window, and retrying amplifies it. So everything here is built to make
// as few outbound calls as possible:
//
//   * ONE call returns THREE billing cycles, so the Current/Previous/2-ago
//     selector is sliced from a single cached response and costs nothing extra.
//   * A 15-minute fresh cache, and a 24-hour stale cache that is served (marked
//     stale) rather than erroring when the API is down.
//   * Single-flight: N dashboards opening the same village collapse into one
//     request.
//   * A process-wide serialized limiter with >=300ms spacing. NO RETRY anywhere
//     — retrying a throttled account is what made code:44 worse.
//   * A circuit breaker: on 429, or 3 consecutive failures, stop calling for
//     10 minutes and serve cache.
//
// There is no background poller and no all-villages aggregate. Never add a loop
// that iterates villages calling this; that is exactly the mistake that took
// the Ruijie integration down.
//
// State is module-level, which is sound because voucher-validation runs as a
// single PM2 process (instances: 1, exec_mode 'fork' in
// deploy/ecosystem.config.cjs). Under cluster mode each worker would get its
// own limiter and the effective outbound rate would multiply.

// node-fetch, not axios: axios is not a dependency of this backend, and
// ruijieService.js (the module this one is modelled on) already uses node-fetch.
import fetch from "node-fetch";

const log = (...m) => console.log(new Date().toISOString(), "[Starlink]", ...m);

/** fetch with a timeout, since node-fetch has no built-in one. */
async function fetchJson(url, { timeoutMs = 60000, ...options } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from Starlink`);
      err.status = res.status;
      err.body = json ?? text?.slice(0, 300);
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const FRESH_MS = 15 * 60 * 1000; // serve from cache without calling
const STALE_MS = 24 * 60 * 60 * 1000; // serve stale rather than fail
const LINE_TTL_MS = 6 * 60 * 60 * 1000; // kit metadata barely changes
const MIN_GAP_MS = 300; // spacing between outbound calls
const CIRCUIT_MS = 10 * 60 * 1000; // cool-off after throttling
const CONFIG_TTL_MS = 60 * 1000; // re-read credentials at most once a minute

let _config = null;
let _configAt = 0;
let _token = null;
let _tokenExpiresAt = 0;

const _limiter = { chain: Promise.resolve(), lastAt: 0 };
const _circuit = { openUntil: 0, consecutiveErrors: 0 };
const _usageCache = new Map(); // serviceLineNumber -> { at, payload }
const _lineCache = new Map(); // serviceLineNumber -> { at, payload }
const _inflight = new Map(); // key -> Promise

/** Thrown when we refuse to call out (circuit open) or the call failed. */
class StarlinkError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Drop cached credentials + token, e.g. after the admin saves new settings. */
export function invalidateConfig() {
  _config = null;
  _configAt = 0;
  _token = null;
  _tokenExpiresAt = 0;
}

/**
 * The saved Starlink credentials, or null when the feature is off or the row is
 * incomplete. Memoised briefly so a dashboard open does not re-query per call.
 */
export async function loadConfig(pool) {
  if (_config && Date.now() - _configAt < CONFIG_TTL_MS) return _config;
  const [rows] = await pool.query("SELECT * FROM starlink_settings WHERE id = 1");
  const c = rows[0];
  const usable =
    c && c.enabled && c.token_url && c.api_base_url && c.client_id && c.client_secret;
  _config = usable ? c : null;
  _configAt = Date.now();
  return _config;
}

/**
 * Every outbound Starlink request goes through here: serialized, paced, and
 * refused outright while the circuit is open. No retry — see the file header.
 */
function starlinkFetch(doRequest) {
  const run = async () => {
    if (Date.now() < _circuit.openUntil) {
      const secs = Math.ceil((_circuit.openUntil - Date.now()) / 1000);
      throw new StarlinkError(`Starlink calls paused for ${secs}s after throttling`, "circuit_open");
    }
    const wait = Math.max(0, _limiter.lastAt + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    _limiter.lastAt = Date.now();

    try {
      const out = await doRequest();
      _circuit.consecutiveErrors = 0;
      return out;
    } catch (e) {
      const status = e.status;
      if (status === 401 || status === 403) {
        // Stale token: clear it so the next call re-authenticates. Not counted
        // as a throttling signal.
        _token = null;
        _tokenExpiresAt = 0;
        throw e;
      }
      _circuit.consecutiveErrors += 1;
      if (status === 429 || _circuit.consecutiveErrors >= 3) {
        _circuit.openUntil = Date.now() + CIRCUIT_MS;
        _circuit.consecutiveErrors = 0;
        log(`circuit OPEN for ${CIRCUIT_MS / 60000} min (status ${status || "n/a"})`);
      }
      throw e;
    }
  };

  // Chain so only one Starlink conversation happens at a time process-wide.
  const next = _limiter.chain.then(run, run);
  _limiter.chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** OAuth2 client-credentials token, cached until shortly before it expires. */
async function getToken(cfg) {
  if (_token && Date.now() < _tokenExpiresAt) return _token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
  });
  const data = await starlinkFetch(() =>
    fetchJson(cfg.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs: 30000,
    })
  );
  if (!data?.access_token) throw new StarlinkError("No access_token in token response", "auth");
  _token = data.access_token;
  // 60s safety margin; 14 min fallback when the server omits expires_in.
  const ttl = Number(data.expires_in) > 0 ? Number(data.expires_in) : 900;
  _tokenExpiresAt = Date.now() + Math.max(30, ttl - 60) * 1000;
  return _token;
}

/**
 * The Starlink envelope carries `isValid: false` with HTTP 200, so the status
 * code alone is not enough to know a call succeeded.
 */
function unwrap(data, what) {
  if (data?.isValid !== true) {
    throw new StarlinkError(
      `Starlink rejected the ${what} request: ${JSON.stringify(data?.errors ?? data)}`,
      "invalid"
    );
  }
  return data.content;
}

/** Collapse concurrent identical fetches into one outbound request. */
function singleFlight(key, fn) {
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

/* ------------------------------------------------------------- normalising */

const gb = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM-DD in UTC, the key the daily buckets are indexed by. */
function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Turn one billing cycle into chart-ready daily buckets.
 *
 * NOTE: the source app bins days with getDaysInMonthManually(cycleStartMonth),
 * so a cycle that straddles two months is plotted against the wrong day
 * numbers. This walks the cycle's ACTUAL start->end range instead, and labels
 * each point with a real date.
 */
function normalizeCycle(cycle, servicePlan) {
  const start = cycle?.startDate ? new Date(cycle.startDate) : null;
  const end = cycle?.endDate ? new Date(cycle.endDate) : null;

  // Daily rows live on the CYCLE (routes/usage.js:396 reads
  // targetCycle.dailyDataUsage). The dataPoolUsage fallback is defensive only.
  const rawDaily = cycle?.dailyDataUsage?.length
    ? cycle.dailyDataUsage
    : (cycle?.dataPoolUsage ?? []).flatMap((p) => p?.dailyDataUsage ?? []);

  const byDay = new Map();
  for (const row of rawDaily) {
    const k = row?.date ? dayKey(row.date) : null;
    if (!k) continue;
    const prev = byDay.get(k) || { priority: 0, standard: 0 };
    byDay.set(k, {
      priority: prev.priority + gb(row.priorityGB ?? row.priorityGb),
      standard: prev.standard + gb(row.standardGB ?? row.standardGb),
    });
  }

  // Caps split priority usage into "included" vs "top-up". Read from the FIRST
  // data pool (routes/usage.js:336), falling back to the service plan's limit.
  let baseCap = 0;
  let topCap = 0;
  for (const b of cycle?.dataPoolUsage?.[0]?.dataBlocks ?? []) {
    const amount = gb(b.totalGB ?? b.gbIncluded ?? b.amountGB);
    if (b.dataBlockType === "RecurringPerBillingCycle") baseCap += amount;
    else if (b.dataBlockType === "Overage" || b.dataBlockType === "OneTimePurchase") topCap += amount;
  }
  if (baseCap === 0 && servicePlan?.usageLimitGB) baseCap = gb(servicePlan.usageLimitGB);

  // Walk the real date range so gaps are zero-filled and labels are honest.
  const days = [];
  let baseLeft = baseCap;
  let topLeft = topCap;
  let baseUsed = 0;
  let topUsed = 0;
  let standardUsed = 0;

  // The source emits a FULL MONTH (routes/usage.js:408, `for day = 1..
  // daysInMonth`) so the chart always shows a complete month rather than only
  // the days that happened to report. We keep that, but walk the cycle's real
  // start->end range instead of the start month's calendar: a Starlink cycle is
  // a full month anyway, and this also places usage correctly when a cycle
  // straddles two months (which the source's day-of-month indexing gets wrong).
  const keys = (() => {
    if (!start) return [...byDay.keys()].sort();
    // If the API omitted endDate, fall back to a month from the start.
    const last = end || new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()
    ));
    const out = [];
    for (let d = new Date(start); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(dayKey(d));
      if (out.length > 400) break; // guard against a bad date range
    }
    return out;
  })();

  for (const k of keys) {
    const row = byDay.get(k) || { priority: 0, standard: 0 };
    let base = 0;
    let topup = 0;
    if (baseCap > 0 || topCap > 0) {
      base = Math.min(row.priority, Math.max(0, baseLeft));
      baseLeft -= base;
      topup = Math.min(row.priority - base, Math.max(0, topLeft));
      topLeft -= topup;
      // Anything past both caps still happened; show it rather than drop it.
      base += row.priority - base - topup;
    } else {
      base = row.priority;
    }
    baseUsed += base;
    topUsed += topup;
    standardUsed += row.standard;
    days.push({
      d: String(Number(k.slice(8, 10))), // day-of-month, like the source's axis
      date: k,
      base: +base.toFixed(3),
      topup: +topup.toFixed(3),
      standard: +row.standard.toFixed(3),
    });
  }

  return {
    startDate: start ? start.toISOString() : null,
    endDate: end ? end.toISOString() : null,
    days,
    totals: {
      baseUsed: +baseUsed.toFixed(2),
      baseCap: +baseCap.toFixed(2),
      topUsed: +topUsed.toFixed(2),
      topCap: +topCap.toFixed(2),
      standardUsed: +standardUsed.toFixed(2),
      totalUsed: +(baseUsed + topUsed + standardUsed).toFixed(2),
    },
  };
}

/* ------------------------------------------------------------------ public */

/**
 * Data usage for one service line: the current cycle plus the two before it,
 * normalised and cached. Returns { cycles: [newest..oldest], fetchedAt, stale }.
 */
export async function getUsage(cfg, serviceLineNumber) {
  const key = `usage:${serviceLineNumber}`;
  const hit = _usageCache.get(serviceLineNumber);
  if (hit && Date.now() - hit.at < FRESH_MS) {
    return { ...hit.payload, fetchedAt: hit.at, stale: false };
  }

  try {
    const payload = await singleFlight(key, async () => {
      const token = await getToken(cfg);
      const url = `${String(cfg.api_base_url).replace(/\/$/, "")}/v2/data-usage/query?page=0`;
      const data = await starlinkFetch(() =>
        fetchJson(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            serviceLineNumbers: [serviceLineNumber],
            previousBillingCycles: 2,
            activeServiceLinesOnly: true,
          }),
          timeoutMs: 60000,
        })
      );
      const content = unwrap(data, "data-usage");
      // An empty result is NORMAL for a new or idle line, not an error.
      const raw = content?.results?.[0]?.billingCycles ?? [];
      // The API returns cycles oldest-first; newest first is what the UI wants.
      const servicePlan = content?.results?.[0]?.servicePlan ?? null;
      const cycles = raw.map((c) => normalizeCycle(c, servicePlan)).reverse();
      return { cycles };
    });

    _usageCache.set(serviceLineNumber, { at: Date.now(), payload });
    return { ...payload, fetchedAt: Date.now(), stale: false };
  } catch (e) {
    // Serve stale rather than showing the operator nothing.
    if (hit && Date.now() - hit.at < STALE_MS) {
      log(`serving stale usage for ${serviceLineNumber}: ${e.message}`);
      return { ...hit.payload, fetchedAt: hit.at, stale: true };
    }
    throw e;
  }
}

/** Kit metadata for the service line (nickname, plan, active). Cached 6h. */
export async function getServiceLine(cfg, serviceLineNumber) {
  const hit = _lineCache.get(serviceLineNumber);
  if (hit && Date.now() - hit.at < LINE_TTL_MS) return hit.payload;

  const payload = await singleFlight(`line:${serviceLineNumber}`, async () => {
    const token = await getToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/$/, "");
    const url = `${base}/v2/service-lines/${encodeURIComponent(serviceLineNumber)}`;
    const data = await starlinkFetch(() =>
      fetchJson(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeoutMs: 60000,
      })
    );
    const c = unwrap(data, "service-line");
    return {
      serviceLineNumber: c?.serviceLineNumber || serviceLineNumber,
      nickname: c?.nickname || null,
      active: c?.active ?? null,
      startDate: c?.startDate || null,
      productReferenceId: c?.productReferenceId || null,
    };
  });

  _lineCache.set(serviceLineNumber, { at: Date.now(), payload });
  return payload;
}

/** Debug view of the limiter/circuit state. */
export function getStatus() {
  return {
    circuitOpenUntil: _circuit.openUntil || null,
    cachedUsageLines: _usageCache.size,
    cachedServiceLines: _lineCache.size,
    tokenCached: !!_token,
  };
}
