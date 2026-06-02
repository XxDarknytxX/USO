// controllers/paymentController.js - PRODUCTION VERSION (API-integrated)
const axios = require('axios');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const vvClient = require('../services/voucherValidationClient');
const { TransactionDB } = require('../config/db');
const { ruijieAuthDeduped } = require('../services/ruijieAuth');

const RUIJIE_AUTH_URL = process.env.RUIJIE_AUTH_URL || 'https://portal-ap.ruijienetworks.com/api/auth/general';

// Helpers
const qs = (o) => new URLSearchParams(o).toString();
const log = (...m) => console.log(new Date().toISOString(), ...m);

// Generate unique numeric transaction ID — safe for M-PAiSA (max ~9 digits)
// Format: 9-digit random number (100000000–999999999) — no leading zeros, cryptographically random
// Collision check against DB ensures uniqueness
const generateTransactionId = () => {
  return crypto.randomInt(100000000, 999999999).toString();   // 9-digit, never starts with 0
};

// Safe JSON parse — never throws
const safeJsonParse = (str) => {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
};

// Helper to get client info from request
const getClientInfo = (req) => ({
  clientIp: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
  userAgent: req.headers['user-agent'] || 'unknown'
});

// Build a full device-context object for audit log eventData
const buildDeviceContext = (transaction, req) => ({
  clientIp: transaction?.client_ip || req?.ip || 'unknown',
  clientMac: transaction?.client_mac || null,
  userAgent: transaction?.user_agent || req?.headers?.['user-agent'] || 'unknown',
  sessionId: transaction?.session_id || null,
});

// Normalize/authenticate voucher with Ruijie
const authenticateVoucherInternal = async (voucherCode, sessionId, transactionId = null) => {
  const payload = {
    lang: 'en_US',
    authType: 'voucher',
    sessionId: String(sessionId || '').trim(),
    account: String(voucherCode || '').trim(),
  };

  const authUrl = RUIJIE_AUTH_URL;
  log('>>>> AUTO VOUCHER AUTH POST', authUrl, payload);

  try {
    // Shared dedup with authController: if the PortalGate re-auth already
    // authenticated this same session + voucher seconds ago, reuse that result
    // instead of issuing a second Ruijie call that would be "request limited".
    const { data, status } = await ruijieAuthDeduped({
      sessionId: payload.sessionId,
      voucherCode: payload.account,
      payload,
      authUrl,
      timeout: 20000,
    });

    log('     ↳ auto auth status', status, 'response', data);

    const authData = {
      attempted: true,
      success: false,
      response: data,
      logonUrl: null,
      error: null
    };

    if (status !== 200 || !data) {
      authData.error = 'Authentication service error';
      authData.response = data || null;
      
      if (transactionId) {
        await TransactionDB.updateAuthStatus(transactionId, authData);
      }
      
      return { 
        success: false, 
        error: 'Authentication service error', 
        details: data || null, 
        detail: data || null 
      };
    }

    const successFlag = data.success === true || data.success === 'true' || data.success === 1 || data.success === '1';
    const authResult = data.result?.authResult;
    const isAuthed = successFlag && (authResult === '1' || authResult === 1 || authResult === true);

    if (isAuthed) {
      authData.success = true;
      authData.logonUrl = data.result?.logonUrl || null;
      
      if (transactionId) {
        await TransactionDB.updateAuthStatus(transactionId, authData);
        
        // Update session authentication status
        await TransactionDB.updateSessionAuth(sessionId, {
          isAuthenticated: true,
          voucherCode: payload.account,
          logonUrl: authData.logonUrl
        });

        // Update the transaction record with the voucher code that was actually used
        await TransactionDB.updateTransactionVoucher(transactionId, payload.account);
      }
      
      return { 
        success: true, 
        logonUrl: data.result?.logonUrl || null, 
        authData: data, 
        voucherCode: payload.account, 
        sessionId: payload.sessionId 
      };
    }
    
    authData.error = 'Authentication failed';
    authData.response = data;
    
    if (transactionId) {
      await TransactionDB.updateAuthStatus(transactionId, authData);
    }
    
    return { success: false, error: 'Authentication failed', details: data, detail: data };
    
  } catch (error) {
    log('XXXX AUTO VOUCHER AUTH FAIL', error.code || error.response?.status || error.message);
    
    const authData = {
      attempted: true,
      success: false,
      response: error.response?.data || null,
      logonUrl: null,
      error: error.message
    };
    
    if (transactionId) {
      try {
        await TransactionDB.updateAuthStatus(transactionId, authData);
      } catch (dbError) {
        log('XXXX Failed to update auth status after error:', dbError.message);
      }
    }
    
    return { 
      success: false, 
      error: 'Voucher authentication service unavailable', 
      details: error.response?.data || null, 
      detail: error.message 
    };
  }
};

// Generate a unique transaction ID with DB collision check (up to 10 retries)
const generateUniqueTransactionId = async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateTransactionId();
    const existing = await TransactionDB.getTransaction(id);
    if (!existing) return id;
    log(`>>>> Transaction ID collision on ${id}, retrying (attempt ${attempt + 1})`);
  }
  // Fallback: append timestamp fragment to guarantee uniqueness
  return generateTransactionId() + (Date.now() % 100).toString();
};

const initiatePayment = async (req, res) => {
  const amt = parseFloat(req.body.amount || '0').toFixed(2);
  const tID = await generateUniqueTransactionId();
  const planId = req.body.planId;
  const cID = process.env.MPAISA_CLIENT_ID;
  const voucherCode = req.body.voucherCode || null;
  const sessionId = String(req.body.sessionId || '').trim();
  const clientMac = String(req.body.clientMac || '').trim() || null;
  const urlNoScheme = process.env.MPAISA_RETURN_URL.replace(/^https?:\/\//, '');
  const clientInfo = getClientInfo(req);

  // Validate required fields
  if (!planId) return res.status(400).json({ ok: false, error: 'Plan ID is required' });
  if (!sessionId) return res.status(400).json({ ok: false, error: 'Session ID is required' });

  let selectedPlan;
  try {
    // Scope to the site the customer is on (site1/site2 → that site's plans).
    const allPlans = await vvClient.fetchPlans(req.headers.host);
    selectedPlan = allPlans.find(p => p.id === planId);
  } catch (err) {
    log('XXXX Failed to fetch plans from Voucher Validation:', err.message);
    return res.status(503).json({ ok: false, error: 'Plan service temporarily unavailable' });
  }

  if (!selectedPlan) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid plan ID',
      receivedPlanId: planId
    });
  }

  try {
    // Create or update session record (includes MAC address from captive portal)
    await TransactionDB.createOrUpdateSession({
      sessionId,
      clientIp: clientInfo.clientIp,
      clientMac,
      userAgent: clientInfo.userAgent
    });

    // Create transaction record in database
    const transactionData = {
      id: tID,
      sessionId,
      planId,
      amount: parseFloat(amt),
      voucherCode,
      clientIp: clientInfo.clientIp,
      clientMac,
      userAgent: clientInfo.userAgent
    };

    const transaction = await TransactionDB.createTransaction(transactionData);
    
    log(`>>>> Created transaction ${tID} in database for session ${sessionId}`);
    log(`>>>> Initiating payment for plan: ${selectedPlan.name} (${planId})`);

    // Send audit log (fire-and-forget)
    vvClient.sendAuditLog({
      eventType: 'payment_initiated',
      transactionId: tID,
      sessionId,
      planKey: planId,
      userGroupId: selectedPlan.userGroupId,
      amount: parseFloat(amt),
      eventData: {
        planName: selectedPlan.name,
        planPrice: selectedPlan.price,
        planCategory: selectedPlan.category,
        clientIp: clientInfo.clientIp,
        userAgent: clientInfo.userAgent,
        voucherCode: voucherCode || null,
      },
    });

    if (voucherCode) {
      log('>>>> Using voucher code for payment:', voucherCode);
    }

    // iDet stays purely as product descriptor (no session leakage)
    const iDet = planId;
    const query = qs({ url: urlNoScheme, tID, amt, cID, iDet });
    const hsUrl = process.env.MPAISA_BASE_URL + 'API/?' + query;

    log('>>>> HS  GET', hsUrl);

    const { data, status } = await axios.get(hsUrl, { timeout: 10000 });

    log('     ↳ status', status);
    log('     ↳ full response', JSON.stringify(data, null, 2));

    if (data && data.destinationurl && data.requestID && data.response === 101) {
      // Update transaction with M-PAiSA request details
      await TransactionDB.updatePaymentStatus(tID, {
        status: 'payment_initiated',
        requestId: data.requestID,
        responseCode: null,
        customerPhone: null,
        paymentResponse: data,
        callbackProcessed: false
      });

      // Audit: handshake succeeded — user is being redirected to M-PAiSA
      vvClient.sendAuditLog({
        eventType: 'handshake_success',
        transactionId: tID,
        sessionId,
        planKey: planId,
        userGroupId: selectedPlan.userGroupId,
        amount: parseFloat(amt),
        eventData: {
          requestId: data.requestID,
          destinationUrl: data.destinationurl,
          mpaisaResponseCode: data.response,
          clientIp: clientInfo.clientIp,
          userAgent: clientInfo.userAgent,
          planName: selectedPlan.name,
          message: `M-PAiSA handshake OK — user redirected to payment for ${selectedPlan.name} ($${amt})`,
        },
      });

      // Send user to M-PAiSA
      const paymentUrl = `${data.destinationurl}?` + qs({
        url: urlNoScheme,
        tID,
        amt,
        cID,
        iDet,
        rID: data.requestID
      });

      return res.json({
        ok: true,
        paymentUrl,
        transactionId: tID,
        requestId: data.requestID,
        planId,
        planName: selectedPlan.name,
        voucherCode,
        sessionId,
        note: 'hand-shake succeeded',
        mpaisaResponse: data
      });
    }

    // Update transaction with failed handshake
    await TransactionDB.updatePaymentStatus(tID, {
      status: 'handshake_failed',
      requestId: data?.requestID || null,
      responseCode: String(data?.response || 'unknown'),
      customerPhone: null,
      paymentResponse: data,
      callbackProcessed: false
    });

    // Audit: handshake failed — M-PAiSA returned an unexpected response
    vvClient.sendAuditLog({
      eventType: 'handshake_failed',
      transactionId: tID,
      sessionId,
      planKey: planId,
      userGroupId: selectedPlan.userGroupId,
      amount: parseFloat(amt),
      eventData: {
        expectedResponseCode: 101,
        actualResponseCode: data?.response,
        hasDestinationUrl: !!data?.destinationurl,
        hasRequestId: !!data?.requestID,
        fullResponse: data,
        clientIp: clientInfo.clientIp,
        userAgent: clientInfo.userAgent,
        message: `M-PAiSA handshake FAILED — response code ${data?.response} (expected 101)`,
      },
    });

    return res.status(502).json({
      ok: false,
      error: 'Hand-shake failed or unexpected response',
      mpaisaResponse: data,
      expectedResponse: 101,
      actualResponse: data?.response,
      hasDestinationUrl: !!data?.destinationurl,
      hasRequestID: !!data?.requestID
    });

  } catch (error) {
    log('XXXX HS  FAIL', error.code || error.response?.status || error.message);
    
    // Try to update transaction status if we have a transaction ID
    try {
      const existingTransaction = await TransactionDB.getTransaction(tID);
      if (existingTransaction) {
        await TransactionDB.updatePaymentStatus(tID, {
          status: 'handshake_error',
          requestId: null,
          responseCode: String(error.response?.status || 'error'),
          customerPhone: null,
          paymentResponse: { error: error.message, errorData: error.response?.data },
          callbackProcessed: false
        });
      }
    } catch (dbError) {
      log('XXXX Failed to update transaction after handshake error', dbError.message);
    }

    // Audit: handshake error — network or service failure
    vvClient.sendAuditLog({
      eventType: 'handshake_error',
      transactionId: tID,
      sessionId,
      planKey: planId,
      userGroupId: selectedPlan?.userGroupId || null,
      amount: parseFloat(amt),
      eventData: {
        error: error.message,
        errorCode: error.code || null,
        httpStatus: error.response?.status || null,
        responseData: error.response?.data || null,
        clientIp: clientInfo.clientIp,
        userAgent: clientInfo.userAgent,
        message: `M-PAiSA handshake ERROR — ${error.code || error.message}`,
      },
    });

    const errorResponse = {
      ok: false,
      error: 'Hand-shake request failed',
      detail: error.message,
      statusCode: error.response?.status
    };

    if (error.response?.data) {
      log('     ↳ error response data', JSON.stringify(error.response.data, null, 2));
      errorResponse.mpaisaErrorResponse = error.response.data;
    }

    return res.status(502).json(errorResponse);
  }
};

const paymentCallback = async (req, res) => {
  log('>>>> PAYMENT CALLBACK received:', JSON.stringify(req.query));

  let { tID } = req.query;
  const { rCode, rID } = req.query;
  // Normalize potentially undefined params to null to prevent MySQL2 bind errors
  const customerphonenumber = req.query.customerphonenumber || null;
  const callbackClientInfo = getClientInfo(req);

  if (!tID) {
    return res.status(400).json({
      ok: false,
      error: 'Transaction ID is required',
      received: req.query
    });
  }

  try {
    // Get transaction from database
    // Also try zero-padded version — M-PAiSA may strip leading zeros from tID on callback
    let transaction = await TransactionDB.getTransaction(tID);
    if (!transaction && tID.length < 6) {
      const paddedTID = tID.padStart(6, '0');
      log(`>>>> Transaction ${tID} not found, trying zero-padded: ${paddedTID}`);
      transaction = await TransactionDB.getTransaction(paddedTID);
    }
    if (!transaction) {
      return res.status(404).json({
        ok: false,
        error: 'Transaction not found',
        transactionId: tID
      });
    }

    // Use the stored transaction ID for all downstream operations
    // (callback may have arrived with stripped leading zeros)
    tID = transaction.id;

    // Check if already processed (idempotency) — duplicate callbacks from React
    // re-renders are normal and don't need logging
    if (transaction.callback_processed) {
      log(`>>>> Returning cached callback result for ${tID}`);

      const cachedResponse = {
        ok: true,
        cached: true,
        transactionId: tID,
        status: transaction.status,
        paymentStatus: rCode === '101' ? 'success' : 'failed',
        authStatus: transaction.auth_attempted ? (transaction.auth_success ? 'success' : 'failed') : 'not_attempted',
        // Add explicit status for cached manual assistance cases
        overallStatus: transaction.status === 'payment_success' && transaction.auth_attempted && !transaction.auth_success ? 'manual_assistance_required' : 'normal',
        nextAction: transaction.status === 'payment_success' && transaction.auth_attempted && !transaction.auth_success ? 'SHOW_MANUAL_ASSISTANCE_MESSAGE' : 'CONTINUE'
      };

      if (transaction.auth_success && transaction.auth_logon_url) {
        cachedResponse.autoAuth = {
          success: true,
          logonUrl: transaction.auth_logon_url,
          voucherCode: transaction.voucher_code,
          sessionId: transaction.session_id
        };
      } else if (transaction.auth_attempted) {
        cachedResponse.autoAuth = {
          success: false,
          error: transaction.auth_error || 'Authentication failed'
        };
        
        // For cached manual assistance cases, add the manual assistance flag
        if (transaction.status === 'payment_success') {
          cachedResponse.manualAssistance = {
            required: true,
            message: 'Your payment was successful but authentication failed. Support has been notified.',
            supportContact: process.env.SUPPORT_PHONE || '+679-SUPPORT'
          };
        }
      }

      return res.json(cachedResponse);
    }

    // Acquire processing lock to prevent concurrent processing
    const lockAcquired = await TransactionDB.acquireProcessingLock(tID);
    if (!lockAcquired) {
      log(`>>>> Callback already processing ${tID}, returning "pending"`);
      return res.json({
        ok: true,
        transactionId: tID,
        responseCode: rCode,
        message: 'Transaction is being processed',
        status: 'processing'
      });
    }

    // Audit: callback received — only logged once (after idempotency + lock check)
    vvClient.sendAuditLog({
      eventType: 'callback_received',
      transactionId: tID,
      sessionId: transaction.session_id,
      planKey: transaction.plan_id,
      customerPhone: customerphonenumber,
      amount: transaction.amount ? parseFloat(transaction.amount) : null,
      eventData: {
        responseCode: rCode || null,
        requestId: rID || null,
        clientIp: callbackClientInfo.clientIp,
        userAgent: callbackClientInfo.userAgent,
        message: `M-PAiSA callback received — rCode=${rCode || 'N/A'} rID=${rID || 'N/A'} phone=${customerphonenumber || 'N/A'}`,
      },
    });

    try {
      const baseResponse = {
        ok: true,
        received: req.query,
        transactionId: tID,
        responseCode: rCode,
        requestId: rID,
        customerPhone: customerphonenumber
      };

      // Update payment status in database
      const paymentStatus = rCode === '101' ? 'payment_success' : 'payment_failed';
      await TransactionDB.updatePaymentStatus(tID, {
        status: paymentStatus,
        requestId: rID || null,
        responseCode: rCode || null,
        customerPhone: customerphonenumber,
        paymentResponse: req.query,
        callbackProcessed: true
      });

      log(`>>>> Payment status updated: ${paymentStatus} for txn ${tID}`);

      // Non-success payment
      if (rCode !== '101') {
        vvClient.sendAuditLog({
          eventType: 'payment_failed',
          transactionId: tID,
          sessionId: transaction.session_id,
          planKey: transaction.plan_id,
          amount: parseFloat(transaction.amount),
          customerPhone: customerphonenumber,
          eventData: {
            responseCode: rCode,
            requestId: rID || null,
            clientIp: transaction.client_ip || null,
            userAgent: transaction.user_agent || null,
            reason: rCode === '111' ? 'User cancelled or payment declined' : `M-PAiSA error code ${rCode}`,
            callbackParams: req.query,
          },
        });

        const failed = {
          ...baseResponse,
          paymentStatus: 'failed',
          authStatus: 'not_attempted',
          overallStatus: 'payment_failed',
          nextAction: 'SHOW_PAYMENT_FAILED_MESSAGE',
          message: 'Payment was not successful'
        };
        return res.json(failed);
      }

      log('>>>> Payment successful, attempting auto voucher authentication');

      vvClient.sendAuditLog({
        eventType: 'payment_success',
        transactionId: tID,
        sessionId: transaction.session_id,
        planKey: transaction.plan_id,
        amount: parseFloat(transaction.amount),
        customerPhone: customerphonenumber,
        eventData: {
          responseCode: rCode,
          requestId: rID || null,
          clientIp: transaction.client_ip || null,
          userAgent: transaction.user_agent || null,
          callbackParams: req.query,
        },
      });

      const sessionId = transaction.session_id;
      const planId = transaction.plan_id;
      const clientMac = transaction.client_mac || null;

      if (!sessionId) {
        // Audit: session lost after payment — critical issue
        vvClient.sendAuditLog({
          eventType: 'no_session_id',
          transactionId: tID,
          planKey: transaction.plan_id,
          customerPhone: customerphonenumber,
          amount: parseFloat(transaction.amount),
          eventData: {
            responseCode: rCode,
            requestId: rID || null,
            clientIp: transaction.client_ip || callbackClientInfo.clientIp,
            userAgent: transaction.user_agent || callbackClientInfo.userAgent,
            message: `Payment successful ($${parseFloat(transaction.amount).toFixed(2)}) but session ID is missing — cannot authenticate voucher. Manual assistance may be required.`,
          },
        });

        const noSession = {
          ...baseResponse,
          paymentStatus: 'success',
          authStatus: 'failed',
          overallStatus: 'auth_failed',
          nextAction: 'SHOW_ERROR_MESSAGE',
          autoAuth: {
            success: false,
            error: 'Session ID not found',
            message: 'Payment successful but cannot auto-authenticate voucher without session ID'
          }
        };
        return res.json(noSession);
      }

      // Claim a voucher from the Voucher Validation API
      let voucherCode;
      let claimId;
      try {
        const allPlans = await vvClient.fetchPlans();
        const plan = allPlans.find(p => p.id === planId);

        if (!plan) {
          log(`XXXX Plan ${planId} not found in Voucher Validation`);
          throw new Error(`Plan ${planId} not found`);
        }

        const claimResult = await vvClient.claimVoucher({
          userGroupId: plan.userGroupId,
          planConfigId: plan.planConfigId,
          transactionId: tID,
          sessionId,
          clientMac,
        });

        if (!claimResult.success) {
          log(`XXXX Voucher claim failed: ${claimResult.error}`);
          vvClient.sendAuditLog({
            eventType: 'voucher_claim_failed',
            transactionId: tID,
            sessionId,
            planKey: planId,
            userGroupId: plan.userGroupId,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              error: claimResult.error,
              message: claimResult.message,
              planName: plan.name,
              planConfigId: plan.planConfigId,
              clientIp: transaction.client_ip || null,
            },
          });

          const noVoucher = {
            ...baseResponse,
            paymentStatus: 'success',
            authStatus: 'failed',
            overallStatus: 'no_voucher_available',
            nextAction: 'SHOW_NO_VOUCHER_MESSAGE',
            autoAuth: {
              success: false,
              error: claimResult.error || 'No voucher available for plan',
              message: claimResult.message || `Payment successful but no voucher found for plan: ${planId}`,
              planId: planId
            }
          };
          return res.json(noVoucher);
        }

        voucherCode = claimResult.voucherCode;
        claimId = claimResult.claimId;

        vvClient.sendAuditLog({
          eventType: 'voucher_claimed',
          transactionId: tID,
          sessionId,
          planKey: planId,
          userGroupId: plan.userGroupId,
          voucherCode,
          customerPhone: customerphonenumber,
          amount: parseFloat(transaction.amount),
          eventData: {
            claimId,
            voucherUuid: claimResult.voucherUuid,
            planName: plan.name,
            planConfigId: plan.planConfigId,
            expiresAt: claimResult.expiresAt,
            clientIp: transaction.client_ip || null,
          },
        });
      } catch (claimError) {
        log(`XXXX Voucher claim error: ${claimError.message}`);

        // Audit: voucher service completely unreachable
        vvClient.sendAuditLog({
          eventType: 'voucher_service_error',
          transactionId: tID,
          sessionId,
          planKey: planId,
          customerPhone: customerphonenumber,
          amount: parseFloat(transaction.amount),
          eventData: {
            error: claimError.message,
            errorCode: claimError.code || null,
            clientIp: transaction.client_ip || callbackClientInfo.clientIp,
            userAgent: transaction.user_agent || callbackClientInfo.userAgent,
            message: `Voucher validation service unreachable after successful payment ($${parseFloat(transaction.amount).toFixed(2)}) — manual assistance likely required`,
          },
        });

        const noVoucher = {
          ...baseResponse,
          paymentStatus: 'success',
          authStatus: 'failed',
          overallStatus: 'no_voucher_available',
          nextAction: 'SHOW_NO_VOUCHER_MESSAGE',
          autoAuth: {
            success: false,
            error: 'Voucher service unavailable',
            message: `Payment successful but voucher service error: ${claimError.message}`,
            planId: planId
          }
        };
        return res.json(noVoucher);
      }

      log(`>>>> Using session ${sessionId} for transaction ${tID}`);
      log(`>>>> Using claimed voucher ${voucherCode} for plan ${planId}`);

      // Attempt auto authentication with plan-specific voucher
      vvClient.sendAuditLog({
        eventType: 'auth_attempted',
        transactionId: tID,
        sessionId,
        planKey: planId,
        voucherCode,
        customerPhone: customerphonenumber,
        amount: parseFloat(transaction.amount),
        eventData: {
          claimId,
          authUrl: RUIJIE_AUTH_URL,
          clientIp: transaction.client_ip || null,
        },
      });

      const authResult = await authenticateVoucherInternal(voucherCode, sessionId, tID);

      if (authResult.success) {
        vvClient.sendAuditLog({
          eventType: 'auth_success',
          transactionId: tID,
          sessionId,
          planKey: planId,
          voucherCode,
          customerPhone: customerphonenumber,
          amount: parseFloat(transaction.amount),
          eventData: {
            logonUrl: authResult.logonUrl,
            claimId,
            authData: authResult.authData || null,
            clientIp: transaction.client_ip || null,
            message: 'Voucher authenticated with Ruijie — user connected to internet',
          },
        });

        // Mark the voucher as used in Voucher Validation
        vvClient.markVoucherUsed(tID).catch(err => {
          log('XXXX Failed to mark voucher used:', err.message);
        });

        const successResp = {
          ...baseResponse,
          paymentStatus: 'success',
          authStatus: 'success',
          overallStatus: 'complete_success',
          nextAction: 'REDIRECT_TO_INTERNET',
          autoAuth: {
            success: true,
            voucherCode: voucherCode,
            planId: planId,
            sessionId,
            logonUrl: authResult.logonUrl || null,
            authData: authResult.authData,
            message: `Payment successful and voucher automatically authenticated for ${planId}`
          }
        };
        return res.json(successResp);
      } else {
        // CRITICAL: Payment succeeded but authentication failed
        log('🚨 URGENT: Customer paid but authentication failed - creating manual assistance case');

        vvClient.sendAuditLog({
          eventType: 'auth_failed',
          transactionId: tID,
          sessionId,
          planKey: planId,
          voucherCode,
          customerPhone: customerphonenumber,
          amount: parseFloat(transaction.amount),
          eventData: {
            error: authResult.error,
            details: authResult.details || authResult.detail || null,
            claimId,
            clientIp: transaction.client_ip || null,
            message: 'Ruijie voucher authentication failed — manual assistance required',
          },
        });

        // Release the voucher claim since auth failed
        vvClient.releaseVoucher(tID, claimId).then(result => {
          // Audit: voucher released back to pool
          vvClient.sendAuditLog({
            eventType: 'voucher_released',
            transactionId: tID,
            sessionId,
            planKey: planId,
            voucherCode,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              claimId,
              releaseSuccess: result?.success || false,
              reason: 'auth_failed',
              message: `Voucher ${voucherCode} released back to pool — Ruijie auth failed`,
            },
          });
        }).catch(err => {
          log('XXXX Failed to release voucher after auth failure:', err.message);
        });

        // Extract error details from Ruijie response
        const ruijieResponse = authResult.details || authResult.detail || {};
        const ruijieErrorMessage = ruijieResponse.message || authResult.error || 'Authentication failed after successful payment';

        // Create manual assistance case
        let caseId = null;
        try {
          const assistanceCase = await TransactionDB.createManualAssistanceCase({
            transactionId: tID,
            sessionId: sessionId,
            customerPhone: customerphonenumber,
            customerIp: transaction.client_ip || null,
            planId: planId,
            amountPaid: parseFloat(transaction.amount),
            paymentCompletedAt: new Date(),
            voucherCode: voucherCode || null,
            authFailureReason: `Ruijie authentication failed: ${ruijieErrorMessage}`,
            authResponse: ruijieResponse || null,
            ruijieErrorMessage: ruijieErrorMessage || null
          });

          caseId = assistanceCase.caseId;
          log(`✅ Manual assistance case #${caseId} created for customer ${customerphonenumber}`);

          vvClient.sendAuditLog({
            eventType: 'manual_assistance_created',
            transactionId: tID,
            sessionId,
            planKey: planId,
            voucherCode,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              caseId,
              ruijieError: ruijieErrorMessage,
              claimId,
              clientIp: transaction.client_ip || null,
              userAgent: transaction.user_agent || null,
              message: `Payment successful ($${parseFloat(transaction.amount).toFixed(2)}) but Ruijie auth failed. Support case #${caseId} created.`,
            },
          });

        } catch (caseError) {
          log('XXXX Failed to create manual assistance case:', caseError.message);
          // Audit: case creation itself failed — VERY critical
          vvClient.sendAuditLog({
            eventType: 'case_creation_failed',
            transactionId: tID,
            sessionId,
            planKey: planId,
            voucherCode,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              error: caseError.message,
              clientIp: transaction.client_ip || null,
              userAgent: transaction.user_agent || null,
              message: `CRITICAL: Failed to create manual assistance case for paid txn ${tID} ($${parseFloat(transaction.amount).toFixed(2)}) — customer ${customerphonenumber || 'unknown'} needs manual follow-up`,
            },
          });
        }

        // Clear, explicit response structure for manual assistance
        const failResp = {
          ...baseResponse,
          // EXPLICIT STATUS FLAGS FOR FRONTEND ROUTING
          paymentStatus: 'success',    // Payment was successful
          authStatus: 'failed',        // But authentication failed  
          overallStatus: 'manual_assistance_required', // This is the key flag
          nextAction: 'SHOW_MANUAL_ASSISTANCE_MESSAGE', // Frontend should check this
          
          autoAuth: {
            success: false,
            error: authResult.error || 'Authentication failed',
            details: authResult.details || authResult.detail || null,
            voucherCode: voucherCode,
            planId: planId,
            sessionId,
            ruijieError: ruijieErrorMessage,
            ruijieErrorCode: ruijieResponse.message || 'AUTHENTICATION_FAILED',
            message: 'Payment successful but auto voucher authentication failed - support will contact you shortly'
          },
          
          manualAssistance: {
            required: true,  // KEY FLAG: Frontend must check this
            caseCreated: true,
            caseId: caseId,
            urgentFlag: true,
            customerMessage: `Your payment was successful! However, we're experiencing a technical issue with your ${planId} plan activation. Our support team has been automatically notified and will contact you at ${customerphonenumber} within 30 minutes to resolve this.`,
            supportContact: process.env.SUPPORT_PHONE || '+679-SUPPORT',
            estimatedResolutionTime: '30 minutes',
            
            // Technical details for debugging
            technicalDetails: {
              ruijieError: ruijieErrorMessage,
              voucherCode: voucherCode,
              planId: planId,
              timestamp: new Date().toISOString(),
              transactionId: tID
            }
          }
        };
        
        log('🎯 RESPONSE: Sending manual assistance response to frontend');
        log('    overallStatus:', failResp.overallStatus);
        log('    nextAction:', failResp.nextAction);
        log('    manualAssistance.required:', failResp.manualAssistance.required);
        
        return res.json(failResp);
      }

    } catch (e) {
      log('XXXX AUTO VOUCHER AUTH UNEXPECTED FAIL', e.message, e.stack);

      // Send error audit log regardless of payment status
      vvClient.sendAuditLog({
        eventType: 'system_error',
        transactionId: tID,
        sessionId: transaction.session_id,
        planKey: transaction.plan_id,
        voucherCode: transaction.voucher_code || null,
        customerPhone: customerphonenumber,
        amount: parseFloat(transaction.amount),
        eventData: {
          error: e.message,
          stack: e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : null,
          paymentResponseCode: rCode,
          clientIp: transaction.client_ip || null,
          message: `Unexpected system error during callback processing for txn ${tID}`,
        },
      });

      // For unexpected errors on successful payments, also create assistance case
      if (rCode === '101') {
        try {
          await TransactionDB.createManualAssistanceCase({
            transactionId: tID,
            sessionId: transaction.session_id,
            customerPhone: customerphonenumber,
            customerIp: transaction.client_ip || null,
            planId: transaction.plan_id,
            amountPaid: parseFloat(transaction.amount),
            paymentCompletedAt: new Date(),
            voucherCode: transaction.voucher_code || null,
            authFailureReason: `Unexpected error during authentication: ${e.message}`,
            authResponse: null,
            ruijieErrorMessage: 'System error during authentication'
          });

          vvClient.sendAuditLog({
            eventType: 'manual_assistance_created',
            transactionId: tID,
            sessionId: transaction.session_id,
            planKey: transaction.plan_id,
            voucherCode: transaction.voucher_code || null,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              error: e.message,
              source: 'unexpected_error',
              clientIp: transaction.client_ip || null,
              message: `System error after successful payment — manual assistance case created`,
            },
          });
        } catch (caseError) {
          log('XXXX Failed to create assistance case for unexpected error:', caseError.message);
          vvClient.sendAuditLog({
            eventType: 'case_creation_failed',
            transactionId: tID,
            sessionId: transaction.session_id,
            planKey: transaction.plan_id,
            customerPhone: customerphonenumber,
            amount: parseFloat(transaction.amount),
            eventData: {
              error: caseError.message,
              originalError: e.message,
              source: 'unexpected_error_handler',
              message: `CRITICAL: Failed to create assistance case during unexpected error handling for txn ${tID}`,
            },
          });
        }
      }
      
      // Update transaction with error
      try {
        await TransactionDB.updateAuthStatus(tID, {
          attempted: true,
          success: false,
          response: null,
          logonUrl: null,
          error: e.message
        });
      } catch (dbError) {
        log('XXXX Failed to update auth status after unexpected error:', dbError.message);
      }

      const errResp = { 
        ok: true,
        transactionId: tID,
        responseCode: rCode,
        paymentStatus: rCode === '101' ? 'success' : 'failed',
        authStatus: 'error',
        overallStatus: rCode === '101' ? 'manual_assistance_required' : 'system_error',
        nextAction: rCode === '101' ? 'SHOW_MANUAL_ASSISTANCE_MESSAGE' : 'SHOW_ERROR_MESSAGE',
        autoAuth: { 
          success: false, 
          error: 'Unexpected error during auto-authentication', 
          details: e.message 
        },
        manualAssistance: rCode === '101' ? {
          required: true,
          message: 'Payment successful but technical error occurred. Support has been notified.',
          supportContact: process.env.SUPPORT_PHONE || '+679-SUPPORT'
        } : null
      };
      return res.json(errResp);
      
    } finally {
      await TransactionDB.releaseProcessingLock(tID);
    }

  } catch (error) {
    log('XXXX PAYMENT CALLBACK ERROR', error.message, error.stack);

    // CRITICAL: Release lock in outer catch — prevents deadlock if inner try/finally didn't run
    try { await TransactionDB.releaseProcessingLock(tID); } catch (_) { /* best effort */ }

    // Audit: system-level crash in callback processing
    vvClient.sendAuditLog({
      eventType: 'system_error',
      transactionId: tID,
      customerPhone: customerphonenumber,
      eventData: {
        error: error.message,
        stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null,
        callbackParams: req.query,
        clientIp: callbackClientInfo.clientIp,
        userAgent: callbackClientInfo.userAgent,
        message: `CRITICAL: Unhandled error in callback processing for txn ${tID} — ${error.message}`,
      },
    });

    return res.status(500).json({
      ok: false,
      error: 'Internal server error during callback processing',
      transactionId: tID,
      detail: error.message
    });
  }
};


const getTransactionDetails = async (req, res) => {
  const { transactionId } = req.params;
  
  try {
    const transaction = await TransactionDB.getTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Transaction not found' 
      });
    }

    // Get transaction history
    const history = await TransactionDB.getTransactionHistory(transactionId);

    // Parse JSON fields (safe — never crashes on malformed data)
    const parsedTransaction = {
      ...transaction,
      payment_response: safeJsonParse(transaction.payment_response),
      auth_response: safeJsonParse(transaction.auth_response),
      history: history.map(h => ({
        ...h,
        details: safeJsonParse(h.details)
      }))
    };

    return res.json({ 
      ok: true, 
      transaction: parsedTransaction 
    });
    
  } catch (error) {
    log('XXXX Error getting transaction details', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const getSessionByTransaction = async (req, res) => {
  const { transactionId } = req.params;
  
  try {
    const transaction = await TransactionDB.getTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Transaction not found' 
      });
    }

    const session = await TransactionDB.getSession(transaction.session_id);
    if (!session) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Session not found for transaction' 
      });
    }

    return res.json({ 
      ok: true, 
      sessionId: session.session_id,
      session 
    });
    
  } catch (error) {
    log('XXXX Error getting session by transaction', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const getTransactionStats = async (req, res) => {
  try {
    const stats = await TransactionDB.getTransactionStats();
    const recentTransactions = await TransactionDB.getRecentTransactions(10);
    
    return res.json({
      ok: true,
      stats,
      recentTransactions
    });
  } catch (error) {
    log('XXXX Error getting transaction stats', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const retryAuthentication = async (req, res) => {
  const { transactionId } = req.params;
  
  try {
    const transaction = await TransactionDB.getTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Transaction not found' 
      });
    }

    if (transaction.status !== 'payment_success') {
      return res.status(400).json({
        ok: false,
        error: 'Authentication can only be retried for successful payments',
        currentStatus: transaction.status
      });
    }

    // Claim a new voucher for the plan via VV API
    let voucherCode;
    let claimId;
    try {
      const allPlans = await vvClient.fetchPlans();
      const plan = allPlans.find(p => p.id === transaction.plan_id);

      if (!plan) {
        return res.status(404).json({
          ok: false,
          error: 'Plan not found',
          planId: transaction.plan_id
        });
      }

      const claimResult = await vvClient.claimVoucher({
        userGroupId: plan.userGroupId,
        planConfigId: plan.planConfigId,
        transactionId: `${transactionId}-retry-${Date.now()}`,
        sessionId: transaction.session_id,
        clientMac: transaction.client_mac || null,
      });

      if (!claimResult.success) {
        return res.status(404).json({
          ok: false,
          error: claimResult.error || 'No voucher available for plan',
          planId: transaction.plan_id
        });
      }

      voucherCode = claimResult.voucherCode;
      claimId = claimResult.claimId;
    } catch (claimErr) {
      return res.status(503).json({
        ok: false,
        error: 'Voucher service unavailable',
        detail: claimErr.message
      });
    }

    const retryClientInfo = getClientInfo(req);
    const retryTxnId = `${transactionId}-retry-${Date.now()}`;

    vvClient.sendAuditLog({
      eventType: 'auth_attempted',
      transactionId,
      sessionId: transaction.session_id,
      planKey: transaction.plan_id,
      voucherCode,
      customerPhone: transaction.customer_phone_number || null,
      amount: transaction.amount ? parseFloat(transaction.amount) : null,
      eventData: {
        source: 'retry',
        claimId,
        retryTransactionId: retryTxnId,
        clientIp: retryClientInfo.clientIp,
        userAgent: retryClientInfo.userAgent,
        message: `Authentication retry for txn ${transactionId} with new voucher ${voucherCode}`,
      },
    });

    // Attempt authentication again with claimed voucher
    const authResult = await authenticateVoucherInternal(
      voucherCode,
      transaction.session_id,
      transactionId
    );

    if (authResult.success) {
      vvClient.sendAuditLog({
        eventType: 'auth_success',
        transactionId,
        sessionId: transaction.session_id,
        planKey: transaction.plan_id,
        voucherCode,
        customerPhone: transaction.customer_phone_number || null,
        amount: transaction.amount ? parseFloat(transaction.amount) : null,
        eventData: {
          source: 'retry',
          logonUrl: authResult.logonUrl,
          claimId,
          clientIp: retryClientInfo.clientIp,
          userAgent: retryClientInfo.userAgent,
          message: `Retry auth SUCCESS for txn ${transactionId} — user connected to internet`,
        },
      });

      vvClient.markVoucherUsed(retryTxnId).catch(err => {
        log('XXXX Failed to mark voucher used on retry:', err.message);
      });
    } else {
      vvClient.sendAuditLog({
        eventType: 'auth_failed',
        transactionId,
        sessionId: transaction.session_id,
        planKey: transaction.plan_id,
        voucherCode,
        customerPhone: transaction.customer_phone_number || null,
        amount: transaction.amount ? parseFloat(transaction.amount) : null,
        eventData: {
          source: 'retry',
          error: authResult.error,
          details: authResult.details || authResult.detail || null,
          claimId,
          clientIp: retryClientInfo.clientIp,
          userAgent: retryClientInfo.userAgent,
          message: `Retry auth FAILED for txn ${transactionId} — ${authResult.error}`,
        },
      });

      vvClient.releaseVoucher(retryTxnId, claimId).catch(err => {
        log('XXXX Failed to release voucher after retry auth failure:', err.message);
      });
    }

    return res.json({
      ok: true,
      transactionId,
      planId: transaction.plan_id,
      voucherCode: voucherCode,
      authResult
    });

  } catch (error) {
    log('XXXX Error retrying authentication', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const getDatabaseStats = async (req, res) => {
  try {
    const tableSizes = await TransactionDB.getTableSizes();
    const transactionStats = await TransactionDB.getTransactionStats();
    
    return res.json({
      ok: true,
      database: {
        tables: tableSizes,
        statistics: transactionStats
      }
    });
  } catch (error) {
    log('XXXX Error getting database stats', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

const optimizeDatabase = async (req, res) => {
  try {
    await TransactionDB.optimizeTables();
    await TransactionDB.cleanup();
    
    return res.json({
      ok: true,
      message: 'Database optimization completed successfully'
    });
  } catch (error) {
    log('XXXX Error optimizing database', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Database optimization failed',
      detail: error.message
    });
  }
};

const getManualAssistanceCases = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status;
    const transactionId = req.query.transactionId;
    
    let cases;
    const { pool } = require('../config/db');
    
    if (transactionId) {
      const [rows] = await pool.execute(`
        SELECT 
          ma.*,
          TIMESTAMPDIFF(MINUTE, ma.created_at, NOW()) as minutes_waiting
        FROM manual_assistance_required ma
        WHERE ma.transaction_id = ?
        ORDER BY ma.created_at DESC
        LIMIT 1
      `, [transactionId]);
      cases = rows;
    } else if (status) {
      const [rows] = await pool.execute(`
        SELECT 
          ma.*,
          TIMESTAMPDIFF(MINUTE, ma.created_at, NOW()) as minutes_waiting
        FROM manual_assistance_required ma 
        WHERE ma.status = ?
        ORDER BY ma.created_at ASC
        LIMIT ?
      `, [status, limit]);
      cases = rows;
    } else {
      const [rows] = await pool.execute(`
        SELECT 
          ma.*,
          TIMESTAMPDIFF(MINUTE, ma.created_at, NOW()) as minutes_waiting
        FROM manual_assistance_required ma
        ORDER BY ma.created_at DESC
        LIMIT ?
      `, [limit]);
      cases = rows;
    }

    return res.json({
      ok: true,
      cases: cases,
      count: cases.length
    });

  } catch (error) {
    log('XXXX Error getting manual assistance cases:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to retrieve manual assistance cases',
      detail: error.message
    });
  }
};

const updateCaseStatus = async (req, res) => {
  const { caseId } = req.params;
  const { status, resolutionNotes } = req.body;
  
  const validStatuses = ['PENDING', 'RESOLVED'];
  
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid status',
      validStatuses: validStatuses
    });
  }

  try {
    const updateData = {};
    if (status) updateData.status = status;
    if (resolutionNotes) updateData.resolutionNotes = resolutionNotes;

    const updatedCase = await TransactionDB.updateAssistanceCase(parseInt(caseId), updateData);

    if (!updatedCase) {
      return res.status(404).json({
        ok: false,
        error: 'Case not found'
      });
    }

    log(`📊 Case #${caseId} updated: ${status || 'status unchanged'}`);

    if (status === 'RESOLVED') {
      log(`✅ Case #${caseId} resolved: ${resolutionNotes || 'No notes provided'}`);
    }

    return res.json({
      ok: true,
      message: 'Case updated successfully',
      case: updatedCase
    });

  } catch (error) {
    log('XXXX Error updating case:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to update case',
      detail: error.message
    });
  }
};

const getCaseDetails = async (req, res) => {
  const { caseId } = req.params;
  
  try {
    const { pool } = require('../config/db');
    
    const [rows] = await pool.execute(`
      SELECT 
        ma.*,
        t.created_at as transaction_created,
        t.payment_response,
        t.auth_response,
        s.user_agent,
        s.portal_entry_time
      FROM manual_assistance_required ma
      JOIN transactions t ON ma.transaction_id = t.id
      JOIN sessions s ON ma.session_id = s.session_id
      WHERE ma.id = ?
    `, [parseInt(caseId)]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Case not found'
      });
    }

    const caseDetails = rows[0];
    
    if (caseDetails.auth_response) {
      try {
        caseDetails.auth_response = JSON.parse(caseDetails.auth_response);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    if (caseDetails.payment_response) {
      try {
        caseDetails.payment_response = JSON.parse(caseDetails.payment_response);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return res.json({
      ok: true,
      case: caseDetails
    });

  } catch (error) {
    log('XXXX Error getting case details:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to retrieve case details',
      detail: error.message
    });
  }
};

const addCaseNotes = async (req, res) => {
  const { caseId } = req.params;
  const { notes } = req.body;
  
  if (!notes) {
    return res.status(400).json({
      ok: false,
      error: 'Notes are required'
    });
  }
  
  try {
    const { pool } = require('../config/db');
    
    await pool.execute(`
      UPDATE manual_assistance_required 
      SET 
        resolution_notes = CONCAT(
          COALESCE(resolution_notes, ''), 
          '\n[', NOW(), '] ', ?
        ),
        updated_at = NOW()
      WHERE id = ?
    `, [notes, parseInt(caseId)]);

    log(`📝 Notes added to case #${caseId}: ${notes}`);

    return res.json({
      ok: true,
      message: 'Notes added successfully'
    });

  } catch (error) {
    log('XXXX Error adding case notes:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to add notes',
      detail: error.message
    });
  }
};

module.exports = {
  initiatePayment,
  paymentCallback,
  getTransactionDetails,
  getSessionByTransaction,
  getTransactionStats,
  retryAuthentication,
  getDatabaseStats,
  optimizeDatabase,
  getManualAssistanceCases,
  updateCaseStatus,
  getCaseDetails,
  addCaseNotes
};