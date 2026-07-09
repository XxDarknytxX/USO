// controllers/authController.js
const axios = require('axios');
const { TransactionDB } = require('../config/db');
const { ruijieAuthDeduped } = require('../services/ruijieAuth');

const log = (...messages) => console.log(new Date().toISOString(), ...messages);

const RUIJIE_AUTH_URL = process.env.RUIJIE_AUTH_URL || 'https://portal-ap.ruijienetworks.com/api/auth/general';

// Helper to get client info from request
const getClientInfo = (req) => ({
  clientIp: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
  userAgent: req.headers['user-agent'] || 'unknown'
});

// Lightweight in-memory brute-force guard for voucher auth. Codes are short and
// guessable, and the manual-login form makes rapid tries easy, so cap attempts
// per source IP. Legit auto-auth (one deduped call per page load) stays well
// under the cap.
const _authAttempts = new Map(); // ip -> { count, windowStart }
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_PER_WINDOW = 12;
const authRateLimited = (ip) => {
  const now = Date.now();
  if (_authAttempts.size > 5000) {
    for (const [k, v] of _authAttempts) if (now - v.windowStart > AUTH_WINDOW_MS) _authAttempts.delete(k);
  }
  const rec = _authAttempts.get(ip);
  if (!rec || now - rec.windowStart > AUTH_WINDOW_MS) {
    _authAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > AUTH_MAX_PER_WINDOW;
};

const authenticateVoucher = async (req, res) => {
  const { voucherCode, sessionId } = req.body;
  const clientInfo = getClientInfo(req);

  if (authRateLimited(clientInfo.clientIp)) {
    log('XXXX voucher auth rate-limited for', clientInfo.clientIp);
    return res.status(429).json({ ok: false, error: 'Too many attempts. Please wait a minute and try again.' });
  }

  if (!voucherCode) {
    return res.status(400).json({ ok: false, error: 'Voucher code is required' });
  }

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Session ID is required' });
  }

  const payload = {
    lang: "en_US",
    authType: "voucher",
    sessionId: sessionId.trim(),
    account: voucherCode.trim()
  };

  const authUrl = RUIJIE_AUTH_URL;
  
  log('>>>> VOUCHER AUTH POST', authUrl, payload);

  try {
    // Create or update session record
    const sessionData = await TransactionDB.createOrUpdateSession({
      sessionId: sessionId.trim(),
      clientIp: clientInfo.clientIp,
      userAgent: clientInfo.userAgent
    });

    // Deduplicated upstream call — collapses CNA double-loads, redirect-chain
    // reloads, retries, and the payment-path race onto a single Ruijie request
    // so the same session never trips Ruijie's "request limited" rate limiter.
    const { data, status } = await ruijieAuthDeduped({
      sessionId: sessionId.trim(),
      voucherCode: voucherCode.trim(),
      payload,
      authUrl,
      timeout: 15000,
    });

    log('     ↳ status', status, 'response', data);

    if (status === 200 && data) {
      // Check if authentication was successful
      const isSuccess = data.success === true && data.result && data.result.authResult === '1';
      
      if (isSuccess) {
        const logonUrl = data.result.logonUrl || null;
        
        // Update session with successful authentication
        await TransactionDB.updateSessionAuth(sessionId.trim(), {
          isAuthenticated: true,
          voucherCode: voucherCode.trim(),
          logonUrl: logonUrl
        });

        if (logonUrl) {
          return res.json({
            ok: true,
            sessionId: sessionId.trim(),
            voucherCode: voucherCode.trim(),
            logonUrl: logonUrl,
            authData: data,
            message: 'Voucher authenticated successfully - redirecting to login'
          });
        } else {
          return res.json({
            ok: true,
            sessionId: sessionId.trim(),
            voucherCode: voucherCode.trim(),
            authData: data,
            message: 'Voucher authenticated successfully'
          });
        }
      }
      
      // Authentication failed
      await TransactionDB.updateSessionAuth(sessionId.trim(), {
        isAuthenticated: false,
        voucherCode: voucherCode.trim(),
        logonUrl: null
      });
      
      return res.status(401).json({
        ok: false,
        error: 'Authentication failed',
        details: data,
        voucherCode: voucherCode.trim(),
        sessionId: sessionId.trim()
      });
    }
    
    return res.status(401).json({ 
      ok: false, 
      error: 'Authentication failed', 
      details: data,
      voucherCode: voucherCode.trim(),
      sessionId: sessionId.trim()
    });

  } catch (error) {
    log('XXXX VOUCHER AUTH FAIL', error.code || error.response?.status || error.message);
    
    // Update session with failed authentication
    try {
      await TransactionDB.updateSessionAuth(sessionId.trim(), {
        isAuthenticated: false,
        voucherCode: voucherCode.trim(),
        logonUrl: null
      });
    } catch (dbError) {
      log('XXXX Failed to update session after auth error', dbError.message);
    }
    
    return res.status(502).json({ 
      ok: false, 
      error: 'Voucher authentication service unavailable', 
      detail: error.message,
      statusCode: error.response?.status,
      voucherCode: voucherCode.trim(),
      sessionId: sessionId.trim()
    });
  }
};

const getSessionInfo = async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await TransactionDB.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Session not found' 
      });
    }

    return res.json({ 
      ok: true, 
      session: {
        sessionId: session.session_id,
        isAuthenticated: !!session.is_authenticated,
        voucherCode: session.voucher_code,
        logonUrl: session.logon_url,
        portalEntryTime: session.portal_entry_time,
        lastActivity: session.last_activity,
        clientIp: session.client_ip
      }
    });
    
  } catch (error) {
    log('XXXX Error getting session info', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const checkVoucherStatus = async (req, res) => {
  const { voucherCode } = req.params;
  
  // This is a lightweight check - doesn't require sessionId
  // Useful for validating voucher codes before attempting authentication
  
  const payload = {
    lang: "en_US",
    authType: "voucher",
    sessionId: "temp_check_" + Date.now(),
    account: voucherCode.trim()
  };

  const authUrl = RUIJIE_AUTH_URL;
  
  try {
    const { data, status } = await axios.post(authUrl, payload, { 
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    if (status === 200 && data) {
      const isValid = data.success === true;
      
      return res.json({
        ok: true,
        voucherCode: voucherCode.trim(),
        isValid: isValid,
        canAuthenticate: isValid && data.result && data.result.authResult !== '0',
        response: data
      });
    }
    
    return res.json({
      ok: true,
      voucherCode: voucherCode.trim(),
      isValid: false,
      canAuthenticate: false,
      response: data
    });
    
  } catch (error) {
    log('XXXX VOUCHER STATUS CHECK FAIL', error.message);
    
    return res.status(502).json({ 
      ok: false, 
      error: 'Voucher status check service unavailable', 
      detail: error.message,
      voucherCode: voucherCode.trim()
    });
  }
};

const logoutSession = async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await TransactionDB.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Session not found' 
      });
    }

    // Reset session authentication status
    await TransactionDB.updateSessionAuth(sessionId, {
      isAuthenticated: false,
      voucherCode: null,
      logonUrl: null
    });

    return res.json({ 
      ok: true, 
      message: 'Session logged out successfully',
      sessionId: sessionId
    });
    
  } catch (error) {
    log('XXXX Error logging out session', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const getActiveSessions = async (req, res) => {
  try {
    // Get sessions that were active in the last 24 hours
    const { pool } = require('../config/db');
    
    const [rows] = await pool.execute(`
      SELECT 
        session_id,
        is_authenticated,
        voucher_code,
        portal_entry_time,
        last_activity,
        client_ip,
        TIMESTAMPDIFF(MINUTE, last_activity, NOW()) as minutes_since_activity
      FROM sessions 
      WHERE last_activity > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY last_activity DESC
      LIMIT 100
    `);
    
    return res.json({
      ok: true,
      sessions: rows,
      count: rows.length
    });
    
  } catch (error) {
    log('XXXX Error getting active sessions', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const getSessionTransactions = async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const { pool } = require('../config/db');
    
    // Get all transactions for this session
    const [rows] = await pool.execute(`
      SELECT 
        id,
        plan_id,
        amount,
        status,
        voucher_code,
        created_at,
        payment_completed_at,
        auth_success,
        auth_completed_at
      FROM transactions 
      WHERE session_id = ?
      ORDER BY created_at DESC
    `, [sessionId]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No transactions found for this session'
      });
    }
    
    return res.json({
      ok: true,
      sessionId,
      transactions: rows,
      count: rows.length
    });
    
  } catch (error) {
    log('XXXX Error getting session transactions', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const cleanupExpiredSessions = async (req, res) => {
  try {
    const { pool } = require('../config/db');
    
    // Delete sessions older than 7 days with no activity
    const [result] = await pool.execute(`
      DELETE FROM sessions 
      WHERE last_activity < DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND is_authenticated = FALSE
    `);
    
    return res.json({
      ok: true,
      message: 'Expired sessions cleanup completed',
      deletedCount: result.affectedRows
    });
    
  } catch (error) {
    log('XXXX Error cleaning up expired sessions', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Session cleanup failed',
      detail: error.message
    });
  }
};

module.exports = {
  authenticateVoucher,
  getSessionInfo,
  checkVoucherStatus,
  logoutSession,
  getActiveSessions,
  getSessionTransactions,
  cleanupExpiredSessions
};