// services/ruijieAuth.js
//
// Deduplicating wrapper around Ruijie's /api/auth/general endpoint.
//
// Ruijie rate-limits auth per sessionId: two calls for the SAME session within
// ~100ms come back as "request limited". In the captive-portal flow the same
// session reaches auth more than once and none of it is caught by the
// frontend's per-page guard, because that guard is a module variable that
// resets on every full-page navigation:
//
//   • the CNA mini-browser (iOS/Android) double-loads the portal URL
//   • the base-HTML → portal → logonUrl redirect chain reloads the JS bundle
//     at each hop, resetting the frontend `_reAuthInFlight` guard to null
//   • browser / network retries
//   • the post-payment auto-auth (paymentController) racing the PortalGate
//     re-auth (authController) for the same session + voucher
//
// This module is the one shared place that survives across all of those. It is
// required by BOTH controllers so the in-flight map and success cache are truly
// shared between the two auth paths:
//
//   • in-flight map  — collapses concurrent calls onto a single upstream request
//   • success cache  — serves rapid repeats (within a short TTL) without
//                       re-hitting Ruijie, so the duplicate never reaches the
//                       rate limiter in the first place
//
// Failures are never cached, so a genuine retry can immediately reach Ruijie.

const axios = require('axios');

const log = (...m) => console.log(new Date().toISOString(), '[ruijieAuth]', ...m);

// How long a successful auth result is served from cache before another
// upstream call is permitted for the same session + voucher. The CNA
// double-load window is ~1–2s; 10s comfortably covers it. Configurable.
const SUCCESS_CACHE_TTL_MS = Number(process.env.RUIJIE_AUTH_CACHE_TTL_MS || 10000);

const _inFlight = new Map(); // key -> Promise<{ data, status }>
const _cache = new Map();    // key -> { value: { data, status }, expiresAt }

const keyFor = (sessionId, voucherCode) =>
  `${String(sessionId || '').trim()}::${String(voucherCode || '').trim()}`;

// Ruijie marks an auth successful when success is truthy AND
// result.authResult === 1 (string or number). Mirrors both controllers.
function isSuccessfulAuth(data) {
  if (!data) return false;
  const successFlag =
    data.success === true ||
    data.success === 'true' ||
    data.success === 1 ||
    data.success === '1';
  const ar = data.result && data.result.authResult;
  return successFlag && (ar === '1' || ar === 1 || ar === true);
}

// Opportunistic prune so the cache can't grow unbounded over a long uptime.
function prune(now) {
  if (_cache.size < 256) return;
  for (const [k, v] of _cache) {
    if (v.expiresAt <= now) _cache.delete(k);
  }
}

/**
 * POST to Ruijie's auth endpoint, deduplicated per (sessionId, voucherCode).
 *
 * Concurrent callers share a single upstream request; rapid repeat callers
 * within SUCCESS_CACHE_TTL_MS get the cached successful result. Anything that
 * isn't a clean success (non-200, auth failure, thrown network error) is NOT
 * cached, so the next attempt reaches Ruijie normally.
 *
 * Returns the same shape as `axios.post`'s resolved value subset used by the
 * controllers: `{ data, status }`. Network errors reject exactly as axios
 * would, so existing try/catch blocks keep working unchanged.
 *
 * @param {object}  opts
 * @param {string}  opts.sessionId
 * @param {string}  opts.voucherCode
 * @param {object}  opts.payload      Body sent to Ruijie.
 * @param {string}  opts.authUrl      Ruijie auth endpoint.
 * @param {number} [opts.timeout=15000]
 * @returns {Promise<{ data: any, status: number }>}
 */
async function ruijieAuthDeduped({ sessionId, voucherCode, payload, authUrl, timeout = 15000 }) {
  const key = keyFor(sessionId, voucherCode);
  const now = Date.now();

  // 1. Fresh successful result cached → serve it, no upstream call.
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) {
    log('cache hit — skipping Ruijie call for', key);
    return cached.value;
  }
  if (cached) _cache.delete(key);

  // 2. An identical request is already running → piggyback on it.
  const existing = _inFlight.get(key);
  if (existing) {
    log('joined in-flight Ruijie call for', key);
    return existing;
  }

  // 3. Make the real upstream call.
  const p = (async () => {
    try {
      const { data, status } = await axios.post(authUrl, payload, {
        timeout,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const value = { data, status };
      if (status === 200 && isSuccessfulAuth(data)) {
        _cache.set(key, { value, expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS });
        prune(Date.now());
      }
      return value;
    } finally {
      _inFlight.delete(key);
    }
  })();

  _inFlight.set(key, p);
  return p;
}

module.exports = { ruijieAuthDeduped, isSuccessfulAuth };
