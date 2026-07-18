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

    // Live expiry, computed locally so "time remaining" counts down in real time
    // and does NOT depend on a voucher sync. Ruijie time passes are wall-clock from
    // first login, so: expiry = (first time we authenticated this voucher) + the
    // plan's time period. We record that activation as transactions.auth_completed_at
    // when the customer connects. Falls back to Ruijie's synced login/expiry when we
    // have no local auth record (e.g. an admin-issued voucher), and stays null for
    // unlimited-time plans (timePeriod = 0).
    let activatedAt = null;
    let expiresAt = null;
    try {
      const { pool } = require('../config/db');
      // UNIX_TIMESTAMP on the TIMESTAMP column returns the true UTC epoch (seconds)
      // regardless of the DB/connection timezone — avoids the mysql2 Date-parsing
      // timezone ambiguity (the pool is configured '+00:00').
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

    // Fallback to Ruijie's synced first-login (ms) if we have no local auth record.
    if (!activatedAt && data.loginTime) {
      const lt = Number(data.loginTime);
      if (lt > 0) activatedAt = lt < 1e12 ? lt * 1000 : lt;
    }

    const periodMin = Number(data.timePeriod) || 0;
    if (activatedAt && periodMin > 0) {
      expiresAt = activatedAt + periodMin * 60 * 1000;
    } else if (data.expiryTime) {
      // No activation/period to compute from → use Ruijie's synced expiry if present.
      const et = Number(data.expiryTime);
      if (et > 0) expiresAt = et < 1e12 ? et * 1000 : et;
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
const getLatestVoucher = async (_req, res) => {
  try {
    const { pool } = require('../config/db');
    const [rows] = await pool.execute(`
      SELECT voucher_code
      FROM transactions
      WHERE auth_success = 1 AND voucher_code IS NOT NULL
      ORDER BY auth_completed_at DESC
      LIMIT 1
    `);

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
