// controllers/statusController.js
const vvClient = require('../services/voucherValidationClient');

const log = (...m) => console.log(new Date().toISOString(), '[Status]', ...m);

const getVoucherStatus = async (req, res) => {
  const { voucherCode } = req.params;

  if (!voucherCode || voucherCode.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Voucher code is required' });
  }

  const code = voucherCode.trim();

  try {
    const data = await vvClient.fetchVoucherStatus(code);

    // "Time remaining" countdown. Ruijie's own timer runs wall-clock from first
    // login, and its synced expiry_time is AUTHORITATIVE (it's what the admin portal
    // uses to expire the voucher). So we count down to that. Priority:
    //   1. Ruijie expiry_time (authoritative — matches the main portal)
    //   2. Ruijie first-login (login_time) + plan period
    //   3. our own auth record (transactions.auth_completed_at) + period — ONLY when
    //      the voucher hasn't been synced yet (no login_time/expiry_time).
    // NOTE: auth_completed_at was previously used first, but it can differ from
    // Ruijie's real activation (re-auths / clock differences), which made the timer
    // read time-left on an already-expired voucher. It's now the last resort.
    // Null for unlimited-time plans (periodMin 0) with no expiry_time.
    const periodMin = Number(data.timePeriod) || 0;
    const toMs = (v) => { const n = Number(v); return n > 0 ? (n < 1e12 ? n * 1000 : n) : null; };

    // Activation basis (also drives the "Activated" label) = Ruijie's first login.
    let activatedAt = toMs(data.loginTime);
    if (!activatedAt) {
      try {
        const { pool } = require('../config/db');
        // UNIX_TIMESTAMP on the TIMESTAMP column returns the true UTC epoch regardless
        // of the DB/connection timezone (pool is '+00:00').
        const [rows] = await pool.execute(
          `SELECT UNIX_TIMESTAMP(MIN(auth_completed_at)) AS activated_s
           FROM transactions
           WHERE voucher_code = ? AND auth_success = 1 AND auth_completed_at IS NOT NULL`,
          [code]
        );
        const s = rows[0] && rows[0].activated_s;
        if (s) activatedAt = Number(s) * 1000;
      } catch (e) {
        log('Activation lookup failed:', e.message);
      }
    }

    // Expiry: authoritative expiry_time first, else activation + period.
    let expiresAt = toMs(data.expiryTime);
    if (!expiresAt && activatedAt && periodMin > 0) {
      expiresAt = activatedAt + periodMin * 60 * 1000;
    }

    return res.json({ ok: true, ...data, activatedAt, expiresAt });
  } catch (err) {
    log('Failed to fetch voucher status:', err.message);

    if (err.response?.status === 404) {
      return res.status(404).json({ ok: false, error: 'Voucher not found' });
    }

    return res.status(503).json({
      ok: false,
      error: 'Voucher status service unavailable',
      detail: err.message,
    });
  }
};

/**
 * GET /api/latest-voucher
 * Returns the most recently authenticated voucher code.
 * Used by /status redirect when no voucher code is in the URL.
 */
const getLatestVoucher = async (req, res) => {
  // This used to answer with the most recent authenticated voucher in the whole
  // transactions table, ignoring the caller entirely. Any device that reached
  // /status without a MAC or a cached code was handed whoever authenticated
  // last on this instance — a live voucher belonging to a stranger, often in
  // another village, which the status page then cached as the caller's own.
  //
  // The caller must now identify itself, and the row must match that identity.
  // With no identity there is no correct answer, so 404 and let the caller fall
  // through to its existing "No Voucher Found" screen.
  const sessionId = String(req.query.sessionId || '').trim();
  const clientMac = String(req.query.clientMac || '').trim();
  if (!sessionId && !clientMac) {
    return res.status(400).json({ ok: false, error: 'sessionId or clientMac is required' });
  }

  try {
    const { pool } = require('../config/db');
    const [rows] = await pool.execute(`
      SELECT voucher_code
      FROM transactions
      WHERE auth_success = 1 AND voucher_code IS NOT NULL
        AND (
          (? <> '' AND session_id = ?)
          OR (? <> '' AND client_mac IS NOT NULL AND client_mac = ?)
        )
      ORDER BY auth_completed_at DESC
      LIMIT 1
    `, [sessionId, sessionId, clientMac, clientMac]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No recent voucher found' });
    }

    return res.json({ ok: true, voucherCode: rows[0].voucher_code });
  } catch (err) {
    log('Failed to get latest voucher:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/voucher-by-mac/:mac
 * Looks up the most recently authenticated voucher for a given device MAC address.
 * Used by the /status redirect when Ruijie forwards the client MAC in the post_url.
 */
const getVoucherByMac = async (req, res) => {
  const mac = (req.params.mac || '').trim();

  if (!mac) {
    return res.status(400).json({ ok: false, error: 'MAC address is required' });
  }

  log(`Looking up voucher for MAC: ${mac}`);

  try {
    const { pool } = require('../config/db');

    // Look up the most recent successfully authenticated transaction for this MAC
    const [rows] = await pool.execute(`
      SELECT voucher_code, auth_completed_at
      FROM transactions
      WHERE client_mac = ? AND auth_success = 1 AND voucher_code IS NOT NULL
      ORDER BY auth_completed_at DESC
      LIMIT 1
    `, [mac]);

    if (rows.length === 0) {
      // Fallback: check the sessions table (MAC might be there even if transaction wasn't updated)
      const [sessionRows] = await pool.execute(`
        SELECT voucher_code
        FROM sessions
        WHERE client_mac = ? AND is_authenticated = 1 AND voucher_code IS NOT NULL
        ORDER BY last_activity DESC
        LIMIT 1
      `, [mac]);

      if (sessionRows.length === 0) {
        log(`No voucher found for MAC: ${mac}`);
        return res.status(404).json({ ok: false, error: 'No voucher found for this device' });
      }

      log(`Found voucher ${sessionRows[0].voucher_code} for MAC ${mac} (from sessions)`);
      return res.json({ ok: true, voucherCode: sessionRows[0].voucher_code });
    }

    log(`Found voucher ${rows[0].voucher_code} for MAC ${mac} (from transactions)`);
    return res.json({ ok: true, voucherCode: rows[0].voucher_code });
  } catch (err) {
    log('Failed to get voucher by MAC:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};

module.exports = { getVoucherStatus, getLatestVoucher, getVoucherByMac };
