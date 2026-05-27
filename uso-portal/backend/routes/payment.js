// routes/payment.js - PRODUCTION VERSION
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Payment routes
router.post('/initiate', paymentController.initiatePayment);
router.get('/callback', paymentController.paymentCallback);

// Transaction management routes
router.get('/transaction/:transactionId', paymentController.getTransactionDetails);
router.get('/transaction/:transactionId/session', paymentController.getSessionByTransaction);
router.post('/transaction/:transactionId/retry-auth', paymentController.retryAuthentication);

// Analytics and monitoring routes
router.get('/stats', paymentController.getTransactionStats);
router.get('/db-stats', paymentController.getDatabaseStats);
router.post('/optimize', paymentController.optimizeDatabase);

// Manual assistance management routes
router.get('/manual-assistance-cases', paymentController.getManualAssistanceCases);
router.get('/manual-assistance-cases/:caseId', paymentController.getCaseDetails);
router.put('/manual-assistance-cases/:caseId/status', paymentController.updateCaseStatus);
router.post('/manual-assistance-cases/:caseId/notes', paymentController.addCaseNotes);

module.exports = router;