// src/services/starlinkService.js
// Reads data usage from the Starlink Enterprise v2 API for one service line.
//
// Ported from the Starlink WebApp Production Build (routes/usage.js), and it
// now polls the SAME WAY that app does: live on every request, no response
// cache, no pacing, no circuit breaker.
//
// An earlier version of this file carried the defences built for Ruijie Cloud
// (15-minute cache, serialized limiter, 10-minute circuit breaker after three
// failures). Those exist because Ruijie throttles at the ACCOUNT level with
// `code: 44` and stays throttled for a long window. Starlink's Enterprise API
// does not behave that way, and the caching actively hurt: a first fetch made
// against a wrong base URL tripped the breaker, and the dashboard then reported
// "unavailable" for ten minutes even after the URL was corrected, while an
// empty result stayed pinned for fifteen.
//
// Two things are deliberately KEPT, because neither delays or staleness data:
//   * Token caching — a bearer token is reused until it is nearly expired
//     rather than re-authenticating on every call (the source's telemetry
//     poller does the same; its usage route re-auths each time, wastefully).
//   * Single-flight — N dashboards opening the SAME village at the SAME moment
//     collapse into one in-flight request. This cannot serve stale data; it
//     only avoids firing identical simultaneous calls.
//
// Still no retry: a failed call fails and the UI says so, rather than
// multiplying load. And still no background poller and no loop over villages —
// one dashboard open is one service line.

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

const CONFIG_TTL_MS = 15 * 1000; // re-read saved credentials at most this often

let _config = null;
let _configAt = 0;
let _token = null;
let _tokenExpiresAt = 0;

const _inflight = new Map(); // key -> Promise (single-flight only, no caching)

/** Thrown when a Starlink call fails or the API rejects the request. */
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
 * Runs one Starlink request. No pacing, no breaker, no retry — the same way the
 * Starlink portal calls this API. The only special handling is that a 401/403
 * drops the cached token so the next call re-authenticates.
 */
async function starlinkFetch(doRequest) {
  try {
    return await doRequest();
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      _token = null;
      _tokenExpiresAt = 0;
    }
    throw e;
  }
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
  let capSource = "none";
  for (const b of cycle?.dataPoolUsage?.[0]?.dataBlocks ?? []) {
    const amount = gb(b.totalGB ?? b.gbIncluded ?? b.amountGB);
    if (b.dataBlockType === "RecurringPerBillingCycle") { baseCap += amount; capSource = "dataBlocks"; }
    else if (b.dataBlockType === "Overage" || b.dataBlockType === "OneTimePurchase") topCap += amount;
  }
  if (baseCap === 0 && servicePlan?.usageLimitGB) {
    baseCap = gb(servicePlan.usageLimitGB);
    capSource = "servicePlan.usageLimitGB";
  }

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
    // Where the allowance figure came from. Both are Starlink's own numbers —
    // nothing here invents a cap — but knowing which field answered is the
    // difference between "your plan says 5 TB" and "this cycle's data block
    // says 5 TB", so it is recorded rather than guessed at later.
    capSource,
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
  // Live every time, like the Starlink portal. singleFlight only merges calls
  // that are genuinely simultaneous for the same service line.
  const payload = await singleFlight(`usage:${serviceLineNumber}`, async () => {
    const token = await getToken(cfg);
    // Matches Starlink's own documented call:
    //   POST https://starlink.com/api/public/v2/data-usage/query?page=0&limit=50
    // A trailing slash on the configured base is stripped so the path cannot
    // end up doubled (…/public//v2/…), which some gateways 404.
    const url = `${String(cfg.api_base_url).replace(/\/+$/, "")}/v2/data-usage/query?page=0&limit=50`;
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
    const result = content?.results?.[0] ?? null;
    const raw = result?.billingCycles ?? [];
    // Cycles arrive OLDEST-first (the source picks index 2 for the current
    // one); the UI wants newest first.
    const cycles = raw.map((c) => normalizeCycle(c, result?.servicePlan ?? null)).reverse();
    // `reason` explains an empty chart instead of leaving it silently blank.
    const reason = !result
      ? "Starlink returned no results for this service line. Check the number, and that the line is active."
      : raw.length === 0
        ? "Starlink returned no billing cycles for this service line yet."
        : null;
    const cur = cycles[0];
    log(
      `usage ${serviceLineNumber}: ${raw.length} cycle(s)` +
        (cur ? `, allowance ${cur.totals.baseCap} GB from ${cur.capSource}` : "") +
        (reason ? ` — ${reason}` : "")
    );
    return { cycles, reason };
  });

  return { ...payload, fetchedAt: Date.now(), stale: false };
}

/** Kit metadata for the service line (nickname, plan, active). Fetched live. */
export async function getServiceLine(cfg, serviceLineNumber) {
  return singleFlight(`line:${serviceLineNumber}`, async () => {
    const token = await getToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/+$/, "");
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
}

/** Small debug view, used only for diagnostics. */
export function getStatus() {
  return { tokenCached: !!_token, inFlight: _inflight.size };
}

/**
 * A human-readable description of a failed Starlink call, safe to show an
 * admin. Includes the HTTP status and whatever the API said, so a
 * misconfiguration is diagnosable without reading server logs. Never contains
 * the client secret or the bearer token — neither is echoed in a response body,
 * and we only ever surface `status` + the parsed error payload.
 */
export function describeError(e) {
  if (!e) return "Unknown error";
  const parts = [];
  if (e.status) parts.push(`HTTP ${e.status}`);
  if (e.code === "invalid") return e.message; // already carries Starlink's errors
  if (e.body != null) {
    const b = typeof e.body === "string" ? e.body : JSON.stringify(e.body);
    if (b && b !== "{}") parts.push(b.slice(0, 300));
  }
  if (!parts.length) parts.push(e.message || String(e));
  return parts.join(" — ");
}

/**
 * Exercises the saved configuration end to end and reports each step, so the
 * admin can see exactly where it breaks: credentials, then the token exchange,
 * then (optionally) a real data-usage call for one service line.
 */
export async function testConnection(cfg, serviceLineNumber) {
  const steps = [];
  const push = (name, ok, detail) => steps.push({ name, ok, detail });

  // Step 0: report the SHAPE of the stored credentials, never their values.
  // `invalid_client` is almost always a secret that was pasted truncated or
  // with stray whitespace, and a length is enough to spot that without ever
  // echoing the secret back.
  const idLen = String(cfg.client_id || "").length;
  const secret = String(cfg.client_secret || "");
  const ws = secret !== secret.trim();
  push(
    "Stored credentials",
    !ws && idLen > 0 && secret.length > 0,
    `Client ID ${idLen} chars, secret ${secret.length} chars` +
      (ws ? " — the stored secret has leading/trailing whitespace, re-save it" : "")
  );

  // Step 1: token exchange.
  _token = null;
  _tokenExpiresAt = 0;
  let token = null;
  try {
    token = await getToken(cfg);
    push("Authenticate", true, "Access token received");
  } catch (e) {
    const detail = describeError(e);
    push(
      "Authenticate",
      false,
      /invalid_client/i.test(detail)
        ? `${detail} — Starlink rejected the client ID/secret pair. The ID above looks right if it is 36 characters; re-enter the client secret (it is write-only, so saving other fields never changes it).`
        : detail
    );
    return { ok: false, steps };
  }

  // Step 2: a real usage query, if a service line was supplied.
  if (!serviceLineNumber) {
    push("Data usage", false, "Add a service line number to a village to test a usage query");
    return { ok: true, steps };
  }

  const url = `${String(cfg.api_base_url).replace(/\/+$/, "")}/v2/data-usage/query?page=0&limit=50`;
  try {
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
    const result = content?.results?.[0] ?? null;
    const cycles = result?.billingCycles?.length ?? 0;
    if (!result) {
      push(
        "Data usage",
        false,
        `Authenticated fine, but Starlink returned no results for ${serviceLineNumber}. Check the number, and note that activeServiceLinesOnly excludes inactive lines.`
      );
    } else {
      push("Data usage", true, `${cycles} billing cycle(s) returned for ${serviceLineNumber}`);
    }
  } catch (e) {
    push("Data usage", false, describeError(e));
    return { ok: false, steps };
  }

  return { ok: steps.every((s) => s.ok), steps };
}
