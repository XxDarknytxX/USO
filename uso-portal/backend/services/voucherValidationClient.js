// services/voucherValidationClient.js
// HTTP client for USO Portal → Voucher Validation API communication
const axios = require('axios');

const CACHE_TTL = 60000; // 60 seconds

const log = (...m) => console.log(new Date().toISOString(), '[VV-Client]', ...m);

// Per-site caches: key = the site hostname the customer is on
// (or '_all' for the unscoped internal lookup used by id-based plan fetches).
const plansCacheByHost = new Map();
const categoriesCacheByHost = new Map();
const siteKey = (hostname) => (hostname || '').toString().split(':')[0].toLowerCase() || '_all';

// Lazy-init: read env at call time, not module load time, so .env is guaranteed loaded
let _client = null;
function getClient() {
  if (!_client) {
    const API_URL = process.env.VOUCHER_VALIDATION_API_URL || 'http://localhost:4001';
    const API_SECRET = process.env.PORTAL_API_SECRET || '';
    log(`Initializing VV client → ${API_URL} (secret ${API_SECRET ? 'SET (' + API_SECRET.slice(0, 6) + '...)' : 'MISSING!'})`);
    _client = axios.create({
      baseURL: API_URL,
      timeout: 10000,
      headers: { 'X-Portal-Secret': API_SECRET },
    });
  }
  return _client;
}

/**
 * Fetch all active portal plans from Voucher Validation API.
 * Returns data in the exact shape the USO frontend expects.
 * Cached for 60 seconds.
 */
async function fetchPlans(hostname = '') {
  const key = siteKey(hostname);
  const cached = plansCacheByHost.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const path = key === '_all'
      ? '/api/portal/plans'
      : `/api/portal/plans?hostname=${encodeURIComponent(key)}`;
    const { data } = await getClient().get(path);
    plansCacheByHost.set(key, { data, timestamp: Date.now() });
    log(`Fetched ${data.length} plans from Voucher Validation API (site=${key})`);
    return data;
  } catch (err) {
    log('Failed to fetch plans:', err.message);
    // Return stale cache if available
    const stale = plansCacheByHost.get(key);
    if (stale && stale.data) {
      log('Returning stale cached plans');
      return stale.data;
    }
    throw err;
  }
}

/**
 * Fetch categories derived from active plans.
 * Returns data in the exact shape the USO frontend expects.
 * Cached for 60 seconds.
 */
async function fetchCategories(hostname = '') {
  const key = siteKey(hostname);
  const cached = categoriesCacheByHost.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const path = key === '_all'
      ? '/api/portal/categories'
      : `/api/portal/categories?hostname=${encodeURIComponent(key)}`;
    const { data } = await getClient().get(path);
    categoriesCacheByHost.set(key, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    log('Failed to fetch categories:', err.message);
    const stale = categoriesCacheByHost.get(key);
    if (stale && stale.data) {
      log('Returning stale cached categories');
      return stale.data;
    }
    throw err;
  }
}

/**
 * Claim an available voucher for a transaction.
 * Uses SELECT FOR UPDATE on VV side to prevent race conditions.
 * @returns {{ success: boolean, voucherCode?: string, voucherUuid?: string, claimId?: number, error?: string }}
 */
async function claimVoucher({ userGroupId, planConfigId, transactionId, sessionId, clientMac }) {
  try {
    const { data } = await getClient().post('/api/portal/claim-voucher', {
      userGroupId, planConfigId, transactionId, sessionId, clientMac,
    });
    if (data.success) {
      log(`Voucher ${data.voucherCode} claimed for transaction ${transactionId}`);
    } else {
      log(`Voucher claim failed for transaction ${transactionId}: ${data.error}`);
    }
    return data;
  } catch (err) {
    log('Voucher claim request failed:', err.message);
    return {
      success: false,
      error: 'voucher_service_unavailable',
      message: `Voucher validation service unavailable: ${err.message}`,
    };
  }
}

/**
 * Release a previously claimed voucher (e.g., when payment fails).
 */
async function releaseVoucher(transactionId, claimId) {
  try {
    const { data } = await getClient().post('/api/portal/release-voucher', {
      transactionId, claimId,
    });
    log(`Voucher released for transaction ${transactionId}`);
    return data;
  } catch (err) {
    log('Voucher release failed (non-fatal):', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Reserve a claimed voucher for a manual-assistance customer (paid but auth
 * failed) — keeps it out of the pool so they can redeem this exact code.
 */
async function reserveVoucherForManual(transactionId, claimId) {
  try {
    const { data } = await getClient().post('/api/portal/reserve-voucher', {
      transactionId, claimId,
    });
    log(`Voucher reserved (manually_assigned) for transaction ${transactionId}`);
    return data;
  } catch (err) {
    log('Voucher reserve failed (non-fatal):', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Mark a claimed voucher as used (after successful authentication).
 */
async function markVoucherUsed(transactionId) {
  try {
    const { data } = await getClient().post('/api/portal/mark-used', {
      transactionId,
    });
    return data;
  } catch (err) {
    log('Mark voucher used failed (non-fatal):', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send an audit log event to Voucher Validation.
 * Fire-and-forget: never blocks the caller, never throws.
 */
async function sendAuditLog(event) {
  const payload = {
    ...event,
    eventTimestamp: event.eventTimestamp || new Date().toISOString(),
  };

  log(`>> Sending audit log [${event.eventType}] txn=${event.transactionId || 'N/A'} session=${event.sessionId || 'N/A'}`);
  log(`   Payload:`, JSON.stringify(payload));

  try {
    const { data, status } = await getClient().post('/api/portal/audit-log', payload);
    log(`<< Audit log [${event.eventType}] sent OK (status=${status}, logId=${data?.logId || 'N/A'})`);
  } catch (err) {
    const respData = err.response?.data;
    const respStatus = err.response?.status;
    log(`XX Audit log [${event.eventType}] FAILED: status=${respStatus || 'N/A'} error=${err.message}`);
    if (respData) {
      log(`   Response body:`, JSON.stringify(respData));
    }
    // Check common issues
    if (respStatus === 401) {
      log(`   !! AUTH FAILED — check PORTAL_API_SECRET matches on both sides`);
    }
    if (!respStatus && err.code) {
      log(`   !! Network error code: ${err.code} — is Voucher Validation running on ${process.env.VOUCHER_VALIDATION_API_URL || 'http://localhost:4001'}?`);
    }
  }
}

/**
 * Fire a purchase-receipt email via Voucher Validation. VV looks up the
 * customer's email from the M-PAiSA mapping and only sends when the receipt
 * feature is enabled for this site. Best-effort — never throws.
 */
async function sendReceipt({ phone, voucherCode, host, planName, dataAllowance, amount }) {
  try {
    const { data } = await getClient().post('/api/portal/receipt', {
      phone, voucherCode, host, planName, dataAllowance, amount,
    });
    if (data?.sent) log(`Receipt emailed to ${data.to} for voucher ${voucherCode}`);
    else log(`Receipt not sent (${data?.reason || 'unknown'}) for voucher ${voucherCode}`);
    return data;
  } catch (err) {
    log('sendReceipt failed:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Fetch voucher usage status by voucher code.
 * Short cache (10s) since this is polled frequently from the status page.
 * Stale cache limited to 5 minutes max to prevent serving outdated data forever.
 * 404 errors are cached for 30s to prevent rapid-fire retries on non-existent vouchers.
 */
const voucherStatusCache = new Map();
const STATUS_CACHE_TTL = 10000; // 10 seconds
const STALE_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes max for stale data
const NOT_FOUND_CACHE_TTL = 30000; // cache 404s for 30 seconds

async function fetchVoucherStatus(voucherCode) {
  const cached = voucherStatusCache.get(voucherCode);

  // Return fresh cache
  if (cached && Date.now() - cached.timestamp < STATUS_CACHE_TTL) {
    // If cached as "not found", throw to propagate 404
    if (cached.notFound) {
      const err = new Error('Voucher not found');
      err.response = { status: 404 };
      throw err;
    }
    return cached.data;
  }

  try {
    const { data } = await getClient().get(`/api/portal/voucher-status/${encodeURIComponent(voucherCode)}`);
    voucherStatusCache.set(voucherCode, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    const is404 = err.response?.status === 404;

    // Cache 404 responses to prevent rapid-fire retries
    if (is404) {
      voucherStatusCache.set(voucherCode, { notFound: true, timestamp: Date.now() });
      log(`Voucher ${voucherCode} not found (404), cached for ${NOT_FOUND_CACHE_TTL / 1000}s`);
      throw err;
    }

    log('Failed to fetch voucher status:', err.message);
    // Return stale cache only if it's not too old
    if (cached && !cached.notFound && Date.now() - cached.timestamp < STALE_CACHE_MAX_AGE) {
      log('Returning stale cached voucher status');
      return cached.data;
    }
    throw err;
  }
}

/**
 * Invalidate the local cache (e.g., after plan config changes).
 */
function invalidateCache() {
  plansCacheByHost.clear();
  categoriesCacheByHost.clear();
}

module.exports = {
  fetchPlans,
  fetchCategories,
  claimVoucher,
  releaseVoucher,
  reserveVoucherForManual,
  markVoucherUsed,
  sendAuditLog,
  sendReceipt,
  invalidateCache,
  fetchVoucherStatus,
};
