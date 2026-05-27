// src/middleware/portalAuth.js
// Shared-secret authentication for USO Portal → Voucher Validation API calls

export function requirePortalSecret(req, res, next) {
  const secret = process.env.PORTAL_API_SECRET;
  if (!secret) {
    console.error('[PortalAuth] PORTAL_API_SECRET not configured in .env');
    return res.status(500).json({ error: 'Portal API not configured' });
  }

  const provided = req.headers['x-portal-secret'];
  if (!provided || provided !== secret) {
    console.warn(`[PortalAuth] REJECTED ${req.method} ${req.originalUrl} — secret ${provided ? 'MISMATCH' : 'MISSING'}`);
    return res.status(401).json({ error: 'Invalid or missing portal secret' });
  }

  next();
}
