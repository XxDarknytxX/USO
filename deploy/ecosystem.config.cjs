// PM2 ecosystem file — runs BOTH apps:
//   - uso-portal       (USO Portal backend, port 5000)
//   - voucher-validation (VV API + admin backend, port 4001)
//
// Each backend reads its own .env via dotenv.
//
// `.cjs` extension forces CommonJS even if a parent declares ESM.
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'uso-portal',
      cwd: path.join(root, 'uso-portal/backend'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      error_file: path.join(root, 'logs/uso-portal.err.log'),
      out_file:   path.join(root, 'logs/uso-portal.out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'voucher-validation',
      cwd: path.join(root, 'voucher-validation/backend'),
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      error_file: path.join(root, 'logs/voucher-validation.err.log'),
      out_file:   path.join(root, 'logs/voucher-validation.out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
