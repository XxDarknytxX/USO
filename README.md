# USO Portal

Vodafone Fiji USO captive-portal payment app. Sits in front of a Ruijie
Wi-Fi controller: users land here, pick a data plan, pay via M-PAiSA, and
the backend claims a voucher from the Voucher Validation service and
authenticates it against Ruijie so the device gets internet access.

## Stack

- **Frontend** — React 19 + Vite + Tailwind (in `frontend/`)
- **Backend** — Node 20 / Express + MySQL 2 (in `backend/`)
- **Database** — MySQL 8 (auto-creates tables on first start)
- **External services** — Ruijie captive-portal API, M-PAiSA, Voucher
  Validation API (separate repo / service)

## Layout

```
backend/                Express API (entry: server.js)
  config/db.js          MySQL pool + auto-schema init
  controllers/          Route handlers (auth, payment, plans, status)
  routes/               Express route wiring
  services/             External service clients (Voucher Validation)
  .env.example          Backend env template — copy to .env
frontend/               React + Vite app (build output → frontend/build)
  src/App.jsx           Router + captive-portal gate
  src/pages/            main-page, payment-result, voucher-status
deploy/                 Server bootstrap + deploy scripts
  setup-server.sh       One-shot Ubuntu install (Node, MySQL, Nginx, PM2)
  init-mysql.sh         Create DB + app user
  deploy-app.sh         Build + (re)start the app under PM2
  ecosystem.config.cjs  PM2 config
  nginx.conf.example    Nginx vhost template
  DEPLOYMENT.md         Full step-by-step deployment guide
```

## Local development

```bash
# Backend
cd backend
cp .env.example .env       # then fill in real values
npm install
npm start                   # → http://localhost:5000

# Frontend (in another terminal)
cd frontend
npm install
npm run dev                 # → http://localhost:3000 (proxies /api → 5000)
```

## Production deployment

See [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md) for the full Ubuntu
server walkthrough (Node + MySQL + Nginx + Let's Encrypt SSL + PM2).

Quick summary on a clean Ubuntu 22.04/24.04 box:

```bash
sudo bash deploy/setup-server.sh
sudo DB_PASSWORD='...' bash deploy/init-mysql.sh
cp backend/.env.example backend/.env       # then fill in real values
bash deploy/deploy-app.sh
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/uso-portal
# edit server_name + root, then enable + reload nginx
sudo certbot --nginx -d portal.example.com
```

## How the captive-portal flow works

1. Device joins Wi-Fi → Ruijie redirects to its captive portal
   (`Resources/customHtmlnew/index.html`).
2. That page redirects to the USO Portal with `?sessionId=...&clientMac=...`.
3. The portal checks if the MAC already has an active voucher; if so it
   re-authenticates with Ruijie and lets the device through.
4. Otherwise the user picks a plan → M-PAiSA payment.
5. On successful payment, the backend claims a voucher from the Voucher
   Validation service and POSTs it to Ruijie
   (`/api/auth/general` with `authType: 'voucher'`).
6. Ruijie returns a `logonUrl` that the frontend visits to finalize
   internet access.

## Environment variables

All required env vars are documented in [`backend/.env.example`](backend/.env.example).
