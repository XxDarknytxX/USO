// routes/index.js
const express = require('express');
const router = express.Router();

const planRoutes = require('./plans');
const authRoutes = require('./auth');
const paymentRoutes = require('./payment');
const statusRoutes = require('./status');

// Health check
router.get('/api/health', (req, res) => {
  res.json({ 
    ok: true, 
    ts: new Date().toISOString(),
    system: 'payment-portal',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Database health check
router.get('/api/health/db', async (req, res) => {
  try {
    const { TransactionDB } = require('../config/db');
    // Simple query to check database connectivity
    const stats = await TransactionDB.getTransactionStats();
    res.json({ 
      ok: true, 
      ts: new Date().toISOString(),
      database: 'connected',
      stats: stats.length
    });
  } catch (error) {
    res.status(503).json({ 
      ok: false, 
      ts: new Date().toISOString(),
      database: 'error',
      error: error.message
    });
  }
});

// Mount route modules
router.use('/api', planRoutes);
router.use('/api', statusRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/mpaisa', paymentRoutes);
router.use('/payment', paymentRoutes); // Legacy support

// Export the router - THIS WAS MISSING!
module.exports = router;