// PM2 ecosystem file for the USO Portal backend.
// `cjs` extension forces CommonJS even if a parent package.json declares "type":"module".
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'uso-portal',
      cwd: path.resolve(__dirname, '..', 'backend'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Backend reads its own config from backend/.env (dotenv).
      // PM2 also captures stdout/stderr to ~/.pm2/logs/uso-portal-*.log.
      error_file: path.resolve(__dirname, '..', 'logs', 'uso-portal.err.log'),
      out_file: path.resolve(__dirname, '..', 'logs', 'uso-portal.out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
