# USO Stack

Vodafone Fiji USO captive-portal payment platform. Three pieces in one
repo:

| Directory | What it is | Where it runs |
|-----------|------------|---------------|
| `uso-portal/` | Public-facing payment app (React + Express + MySQL) — users land here from the Ruijie captive portal, pick a plan, pay via M-PAiSA. | Ubuntu server (Nginx + Node + MySQL) |
| `voucher-validation/` | Admin dashboard + portal-facing API (React + Express + MySQL) — manages voucher inventory, fetches vouchers from Ruijie Cloud, issues them to USO Portal on demand. | Same Ubuntu server |
| `captive-portal/` | Custom HTML uploaded to the Ruijie Wi-Fi controller — redirects users to the USO Portal with their `sessionId` and `clientMac`. | Ruijie AP (not our server) |

## End-to-end flow

```
Device joins Wi-Fi
   ↓
Ruijie redirects to captive-portal/index.html (on the controller)
   ↓
That page redirects to uso-portal with ?sessionId=...&clientMac=...
   ↓
USO Portal checks if the MAC already has an active voucher.
   ├── Yes → re-authenticates with Ruijie, device gets internet
   └── No  → user picks a plan → M-PAiSA payment
                ↓
            Backend calls Voucher Validation /api/portal/claim-voucher
                ↓
            Voucher returned → POST to Ruijie /api/auth/general
                ↓
            Ruijie returns logonUrl → frontend visits it → online
```

## Repo layout

```
uso-portal/                Public payment app
  backend/                 Express API (entry: server.js, port 5000)
  frontend/                React + Vite (build → frontend/build)
voucher-validation/        Admin + portal-facing API
  backend/                 Express API (entry: src/server.js, port 4001)
  frontend/                React + Vite admin dashboard
captive-portal/            Ruijie custom HTML bundle (uploaded to AP)
deploy/                    Server bootstrap + deploy scripts
  setup-server.sh          One-shot Ubuntu install
  init-mysql.sh            Create both MySQL DBs + users
  deploy-app.sh            Build + (re)start both apps under PM2
  ecosystem.config.cjs     PM2 config (two apps)
  nginx.conf.example       Nginx vhost template (two server blocks)
  DEPLOYMENT.md            Full step-by-step deployment guide
```

## Local development

You need MySQL 8 running locally with two databases (`uso_project` and
`voucher_management`).

```bash
# Voucher Validation backend (port 4001)
cd voucher-validation/backend
cp .env.example .env       # fill in real values
npm install
npm run dev                # nodemon → http://localhost:4001

# Voucher Validation frontend (port 3001) — in a new terminal
cd voucher-validation/frontend
npm install
npm run dev                # proxies /api → 4001

# USO Portal backend (port 5000) — in a new terminal
cd uso-portal/backend
cp .env.example .env       # fill in real values
npm install
npm start                  # → http://localhost:5000

# USO Portal frontend (port 3000) — in a new terminal
cd uso-portal/frontend
npm install
npm run dev                # proxies /api → 5000
```

## Production deployment

See [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md) for the full Ubuntu
walkthrough (Node + MySQL + Nginx + Let's Encrypt + PM2 for both apps).

Quick start on a clean Ubuntu 22.04 / 24.04 box:

```bash
git clone https://github.com/XxDarknytxX/USO.git /var/www/uso-portal
cd /var/www/uso-portal

sudo bash deploy/setup-server.sh
sudo mysql_secure_installation
sudo USO_DB_PASSWORD='...' VV_DB_PASSWORD='...' bash deploy/init-mysql.sh

cp uso-portal/backend/.env.example         uso-portal/backend/.env
cp voucher-validation/backend/.env.example voucher-validation/backend/.env
# Edit both .env files, then:

bash deploy/deploy-app.sh
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/uso-stack
# Edit server_name + root paths, then enable + reload nginx
sudo certbot --nginx -d portal.example.com -d admin.example.com
```

## Environment variables

- [`uso-portal/backend/.env.example`](uso-portal/backend/.env.example)
- [`voucher-validation/backend/.env.example`](voucher-validation/backend/.env.example)

The two services share a `PORTAL_API_SECRET` — must be identical in
both `.env` files.

## Key learnings baked into the code

- **Ruijie rate-limits auth calls** (~100ms window). The USO Portal
  frontend uses a module-level promise guard to dedupe concurrent
  re-auth requests from React StrictMode double-mounts.
- **MAC-bound vouchers do NOT auto-reconnect**. When a device's
  `sessionId` changes (reconnect), the portal explicitly re-authenticates
  the cached voucher with the new session ID.
- **Voucher status lookup is expensive on Ruijie's side** (fetches all
  vouchers and filters). Both services cache status results aggressively
  (10s on USO Portal, 20s on VV).
