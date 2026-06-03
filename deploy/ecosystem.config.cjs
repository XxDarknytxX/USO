// PM2 ecosystem — per-site USO Portal instances + one shared admin.
//
//   - uso-<site>          one USO Portal backend per site (from deploy/sites.json)
//                         each on its own PORT, with its own CORS_ORIGIN +
//                         MPAISA_RETURN_URL. Shared values (M-PAiSA creds, VV
//                         API URL/secret) come from uso-portal/backend/.env —
//                         dotenv does NOT override env already set here, so the
//                         per-site overrides below win and the rest fall through.
//   - voucher-validation  the single admin/API backend (port 4001)
//
// Add a site: edit deploy/sites.json → `bash deploy/deploy-app.sh uso`.
// `.cjs` forces CommonJS even if a parent declares ESM.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf8'));
const sites = Array.isArray(manifest.uso) ? manifest.uso : [];

const common = {
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  restart_delay: 3000,
  max_memory_restart: '512M',
  merge_logs: true,
  time: true,
};

const usoApps = sites.map((s) => ({
  ...common,
  name: `uso-${s.name}`,
  cwd: path.join(root, 'uso-portal/backend'),
  script: 'server.js',
  env: {
    NODE_ENV: 'production',
    PORT: String(s.port),
    SITE_NAME: s.name,
    SITE_HOST: s.host,
    CORS_ORIGIN: `https://${s.host}`,
    MPAISA_RETURN_URL: `https://${s.host}/payment-result`,
    // Pin the Ruijie group only if the manifest specifies it; otherwise the
    // backend resolves the site from its Host header.
    ...(s.groupId ? { RUIJIE_GROUP_ID: String(s.groupId) } : {}),
  },
  error_file: path.join(root, `logs/uso-${s.name}.err.log`),
  out_file: path.join(root, `logs/uso-${s.name}.out.log`),
}));

module.exports = {
  apps: [
    ...usoApps,
    {
      ...common,
      name: 'voucher-validation',
      cwd: path.join(root, 'voucher-validation/backend'),
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      error_file: path.join(root, 'logs/voucher-validation.err.log'),
      out_file: path.join(root, 'logs/voucher-validation.out.log'),
    },
  ],
};
