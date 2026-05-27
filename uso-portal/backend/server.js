// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();

// Trust Nginx reverse proxy so req.ip reflects the real client (X-Forwarded-For)
// Set TRUST_PROXY=1 (or a hop count) in production behind Nginx.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const n = Number(trustProxy);
  app.set('trust proxy', Number.isFinite(n) ? n : trustProxy);
}

// CORS — allowlist via env. Comma-separated, e.g. "https://portal.example.com,https://www.example.com".
// If unset, allows all origins (dev convenience).
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length === 0 ? true : (origin, cb) => {
    if (!origin || corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

app.use(express.json());

// Routes
app.use('/', routes);

// Global Express error handler — catches unhandled route errors
app.use((err, _req, res, _next) => {
  console.error(new Date().toISOString(), '[EXPRESS] Unhandled route error:', err.message, err.stack);
  res.status(500).json({
    ok: false,
    error: 'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Process-level error handlers — prevent crashes from unhandled promise rejections or exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error(new Date().toISOString(), '[PROCESS] Unhandled Promise Rejection:', reason);
  // Send audit log if vvClient is available
  try {
    const vvClient = require('./services/voucherValidationClient');
    vvClient.sendAuditLog({
      eventType: 'system_error',
      eventData: {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack?.split('\n').slice(0, 5).join('\n') : null,
        source: 'unhandled_rejection',
        message: 'Unhandled promise rejection in USO Portal backend — potential data loss risk',
      },
    });
  } catch (_) { /* best effort */ }
});

process.on('uncaughtException', (err) => {
  console.error(new Date().toISOString(), '[PROCESS] Uncaught Exception:', err.message, err.stack);
  // Send audit log if vvClient is available
  try {
    const vvClient = require('./services/voucherValidationClient');
    vvClient.sendAuditLog({
      eventType: 'system_error',
      eventData: {
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),
        source: 'uncaught_exception',
        message: 'CRITICAL: Uncaught exception in USO Portal backend — process may be unstable',
      },
    });
  } catch (_) { /* best effort */ }
  // Give audit log time to send before exiting
  setTimeout(() => {
    console.error(new Date().toISOString(), '[PROCESS] Exiting due to uncaught exception');
    process.exit(1);
  }, 2000);
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🟢  API running at http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
