// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Authentication routes
router.post('/voucher', authController.authenticateVoucher);
router.get('/session/:sessionId', authController.getSessionInfo);
router.get('/voucher/:voucherCode/check', authController.checkVoucherStatus);
router.post('/session/:sessionId/logout', authController.logoutSession);
router.get('/sessions/active', authController.getActiveSessions);
router.get('/session/:sessionId/transactions', authController.getSessionTransactions);
router.post('/sessions/cleanup', authController.cleanupExpiredSessions);

module.exports = router;