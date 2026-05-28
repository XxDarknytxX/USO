# USO Stack — Runbook

How this stack is actually deployed, in the real world, with real hostnames.
For the first-time bootstrap on a fresh server, see [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md).
This document is the day-2 reference: "how do I push a change, what's where, and what broke last time."

---

## What's where (the actual production layout)

| Thing | Where | Who owns |
|-------|-------|----------|
| **Source code** | Local Mac at `~/Desktop/Developments/USO Project/USO Code Base/USO Project Main/` | You |
| **Git remote** | https://github.com/XxDarknytxX/USO (branch `main`) | You |
| **DNS** | Cloudflare (free plan) for `vodafonefiji.cloud` | You |
| **Domain registrar** | Hostinger (only registration; NS pointed at Cloudflare) | You |
| **Public IP** | `27.123.190.114` (NATed to internal `172.26.70.9` by cloud team) | Vodafone Fiji cloud team |
| **Server** | Ubuntu 24.04 VM, hostname `USO`, internal IP `172.26.70.9` | You via SSH |
| **SSH** | `ssh corporate@172.26.70.9` (LAN only, not exposed publicly) | You |
| **App root** | `/var/www/uso-portal` on the server | — |
| **Public Portal** | https://portal.vodafonefiji.cloud → port 80/443 → Node :5000 (PM2 `uso-portal`) | — |
| **Admin Dashboard** | https://admin.vodafonefiji.cloud → port 80/443 → Node :4001 (PM2 `voucher-validation`) | — |
| **Admin LAN fallback** | http://172.26.70.9:8080 (no SSL, internal only) | — |
| **MySQL** | Local, port 3306, two DBs: `uso_project`, `voucher_management` | — |
| **SSL certs** | Let's Encrypt, auto-renewed by certbot's systemd timer | — |
| **Process manager** | PM2, configured to auto-start on boot (`pm2-corporate.service`) | — |
| **Reverse proxy** | Nginx, config at `/etc/nginx/sites-available/uso-stack` | — |
| **Captive portal HTML** | Uploaded as a ZIP to the Ruijie Cloud dashboard | You via Ruijie UI |

### Architecture in one picture

```
Wi-Fi client
    │
    ▼
Ruijie AP — captive portal redirect
    │ (Ruijie serves customHtml.zip you uploaded)
    ▼
HTTP redirect with ?sessionId=…&clientMac=…
    │
    ▼
https://portal.vodafonefiji.cloud  ─────────►  Nginx :80/:443
                                                       │
                                       ┌───────────────┴────────────────┐
                                       ▼                                ▼
                            Frontend static files            /api/* + /payment/*
                            (uso-portal/frontend/build)      proxy to :5000
                                                                      │
                                                                      ▼
                                                        Node — uso-portal backend
                                                        ├── MySQL: uso_project
                                                        ├── M-PAiSA (outbound HTTPS)
                                                        ├── Ruijie portal-ap (outbound HTTPS)
                                                        └── VV portal API (loopback :4001)
                                                                                │
                                                                                ▼
https://admin.vodafonefiji.cloud  ─────────►  Nginx :80/:443                Node — voucher-validation
                                                       │                    ├── MySQL: voucher_management
                                       ┌───────────────┴────────────────┐   └── Ruijie cloud-ap (outbound HTTPS)
                                       ▼                                ▼
                            Frontend static files            /api/*
                            (voucher-validation/frontend/build) proxy to :4001
```

---

## The deploy loop (system → git → server)

This is the every-day workflow once everything is set up. **3 commands.**

### 1. Make changes locally (on your Mac)

```bash
cd "/Users/kritishsingh/Desktop/Developments/USO Project/USO Code Base/USO Project Main"
# … edit files in your editor …
git status
git add <files>
git commit -m "what you changed and why"
```

### 2. Push to GitHub

```bash
git push
```

(macOS Keychain has the GitHub PAT cached from the initial push — should just work. If it asks, paste a fresh PAT from https://github.com/settings/tokens.)

### 3. Pull + redeploy on the server

```bash
ssh corporate@172.26.70.9
```

Then on the server:

```bash
cd /var/www/uso-portal
git pull
bash deploy/deploy-app.sh          # both apps
# or:
bash deploy/deploy-app.sh uso      # only USO Portal
bash deploy/deploy-app.sh vv       # only Voucher Validation
```

`deploy-app.sh` runs `npm ci`, builds the frontend(s), then PM2-reloads the backend(s) with zero downtime.

Verify after:

```bash
pm2 status                                              # both apps "online"
curl -s https://portal.vodafonefiji.cloud/api/health    # {"ok":true,...}
curl -s https://admin.vodafonefiji.cloud/api/portal/plans -H "x-portal-secret: <PORTAL_API_SECRET>"
```

---

## Things that broke during the first deploy (don't fall into these again)

These were genuine surprises during the initial Ubuntu deploy. Anything in this section can bite again on a fresh server install.

### npm install timed out from the Fiji server

`npm ci` for `uso-portal/frontend` (192 packages) failed mid-download with `ETIMEDOUT` because the Fiji↔npmjs.com route is slow. Fix:

```bash
npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 60000
npm config set fetch-retry-maxtimeout 300000
npm config set fetch-timeout 600000
```

This is persistent in `~/.npmrc` once set, so it's a one-time fix per server.

### Case-sensitive filesystem broke the VV build

macOS is case-insensitive by default; Linux is case-sensitive. `App.jsx` had
`import("./pages/Login")` but the file was `login.jsx`. Worked on Mac, exploded on Linux with `Could not resolve "./pages/Login"`.

Fixed in commit `bb13b58` by renaming `login.jsx → Login.jsx` and `dashboard.jsx → Dashboard.jsx` via `git mv`. If you ever clone a fresh server and pull, **don't** do `mv` to rename — always use `git mv`.

If you've already done a non-git `mv` on the server and a `git pull` complains:

```
error: The following untracked working tree files would be overwritten by merge: …
```

Then just delete the local copy (same content as what git will deliver) and pull again:

```bash
rm voucher-validation/frontend/src/pages/Dashboard.jsx
rm voucher-validation/frontend/src/pages/Login.jsx
git pull
```

### MySQL collation mismatch (ER_CANT_AGGREGATE_2COLLATIONS)

MySQL 8 defaults the server collation to `utf8mb4_0900_ai_ci`. Our `schema.sql` (for the `vouchers` table) uses `utf8mb4_unicode_ci`. Joins between the two failed.

**Permanent fix is in `deploy/init-mysql.sh`** (commit `ab2aa51`) — it now writes `/etc/mysql/mysql.conf.d/zz-uso-collation.cnf` forcing server-wide `utf8mb4_unicode_ci` before creating DBs. **And in `voucher-validation/backend/src/config/db.js`** (commit `e8e4bdb`) — every `CREATE TABLE` and `ALTER … CONVERT TO …` now uses `utf8mb4_unicode_ci` instead of `0900_ai_ci`.

If a server was deployed before those commits and has wrong-collation columns:

```bash
# Auto-generate + run ALTER MODIFY for every column on the wrong collation
sudo mysql voucher_management -Nse "
SELECT CONCAT('ALTER TABLE \`',table_name,'\` MODIFY COLUMN \`',column_name,'\` ',column_type,
  ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  IF(is_nullable='YES','',' NOT NULL'),
  IF(column_default IS NOT NULL AND column_default!='NULL',CONCAT(' DEFAULT ',QUOTE(column_default)),''),';')
FROM information_schema.columns
WHERE table_schema='voucher_management' AND collation_name='utf8mb4_0900_ai_ci';
" | sudo mysql voucher_management
```

(Repeat with `uso_project` if needed. Views like `vouchers_combined` can't be ALTERed and should be dropped + recreated; they're harmless unless queried directly.)

### Hostinger DNS doesn't serve A records pointing to non-Hostinger IPs

Hostinger's free DNS (`*.dns-parking.com` nameservers) silently overrides any A record that points to an IP outside their network — it returns their parking IP (`208.91.112.55`) instead. **This is what we hit with `vodafonefiji.cloud`** when we tried to point it at `27.123.190.114`.

**Fix**: domain registered at Hostinger, DNS hosted at Cloudflare. Nameservers at Hostinger set to:
- `cass.ns.cloudflare.com`
- `julio.ns.cloudflare.com`

All A records (`@`, `www`, `portal`, `admin`) live in Cloudflare's panel with **proxy disabled** ("DNS only" / grey cloud) — because the orange-cloud proxy breaks Let's Encrypt validation and rewrites the origin IP.

### Snap-installed Certbot vs. dns-parking issue

The `deploy/setup-server.sh` reports a transient snap timeout while installing Certbot:

```
error: cannot perform the following tasks:
- Download snap "core" (17292) from channel "stable" (read tcp ... read: connection timed out)
```

This is harmless — Certbot itself installs successfully right after (`certbot 5.6.0 from Certbot Project (certbot-eff✓) installed`). If you ever see a real Certbot install failure, just rerun `sudo snap install --classic certbot` after the network settles.

### M-PAiSA secrets, Ruijie secrets

The `.env.example` files in both backends list every variable that needs a real value. **Real `.env` files are gitignored** — never commit them. If you need to reset secrets:

- `MPAISA_SECRET_KEY` — from M-PAiSA business portal
- `RUIJIE_APP_ID` / `RUIJIE_APP_SECRET` / `RUIJIE_GROUP_ID` / `RUIJIE_TENANT_ID` — from Ruijie Cloud → Settings → Open API
- `PORTAL_API_SECRET` — shared between USO Portal and Voucher Validation. Generate with `openssl rand -hex 32`. Must be identical in both `.env` files.
- `JWT_SECRET` (VV only) — admin login token signing. Generate with `openssl rand -hex 64`.

---

## Useful operational commands

### Status checks

```bash
pm2 status                                        # both apps online?
sudo systemctl status nginx --no-pager
sudo systemctl status mysql --no-pager
sudo certbot certificates                         # SSL expiry
df -h /                                           # disk space
free -m                                           # memory
```

### Logs

```bash
pm2 logs uso-portal --lines 100
pm2 logs voucher-validation --lines 100
pm2 logs voucher-validation --err --lines 100     # errors only
sudo tail -f /var/log/nginx/access.log            # live HTTP requests
sudo tail -f /var/log/nginx/error.log             # nginx errors
```

### Reloads

```bash
pm2 reload uso-portal --update-env                # zero-downtime, picks up .env changes
pm2 reload voucher-validation --update-env
pm2 restart all                                   # hard restart both apps
sudo systemctl reload nginx                       # after editing nginx config
```

### Database

```bash
sudo mysql -u uso_user -p uso_project
sudo mysql -u vv_user  -p voucher_management

# Show table stats
sudo mysql voucher_management -e "
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema='voucher_management'
ORDER BY table_rows DESC;
"
```

### SSL

```bash
sudo certbot renew --dry-run                      # test renewal
sudo certbot certificates                         # what's installed, when do they expire
```

---

## Backup (recommended — set this up)

Daily MySQL dump of both DBs via cron. As `corporate` user:

```bash
mkdir -p /var/backups/uso

# Add to crontab (crontab -e):
30 2 * * * /usr/bin/mysqldump --defaults-extra-file=/home/corporate/.my-uso.cnf uso_project        | gzip > /var/backups/uso/uso_project-$(date +\%F).sql.gz
35 2 * * * /usr/bin/mysqldump --defaults-extra-file=/home/corporate/.my-vv.cnf  voucher_management | gzip > /var/backups/uso/voucher_management-$(date +\%F).sql.gz
0  3 * * * find /var/backups/uso -name '*.sql.gz' -mtime +14 -delete
```

`~/.my-uso.cnf` and `~/.my-vv.cnf` should be `chmod 600` and contain:

```ini
[client]
user=uso_user                     # or vv_user
password=YOUR_DB_PASSWORD
```

---

## What's still TODO

(Honest list of stuff we haven't done yet)

- [ ] **Upload captive portal HTML to Ruijie.** From the Mac, in `captive-portal/`:
  ```bash
  sed -i '' 's|PORTAL_HOSTNAME_HERE|portal.vodafonefiji.cloud|g' index.html loadConfig.json
  zip -r customHtml.zip . -x "README.md" "Archive.zip" "*.DS_Store"
  # Upload customHtml.zip via Ruijie Cloud → Configuration → Captive Portal → Custom HTML
  ```
- [ ] **Configure at least one plan** in the admin dashboard (Portal Config page) so the portal frontend has something to sell.
- [ ] **Trigger Ruijie voucher sync** in the admin dashboard (Sync page) to pull existing vouchers into the local DB.
- [ ] **Set up MySQL backups** (see above).
- [ ] **Restrict admin port 8080 to LAN only** at the cloud team's firewall — right now it's open to the public internet but only useful as a fallback.
- [ ] **Rotate Ruijie + M-PAiSA secrets** that were exposed in chat history during deployment.

---

## Emergency: someone tells you the portal is down

```bash
ssh corporate@172.26.70.9
pm2 status                                            # what's offline?
pm2 logs --err --lines 200                            # most recent errors
sudo systemctl status nginx                           # nginx alive?
curl -s -o /dev/null -w "%{http_code}\n" https://portal.vodafonefiji.cloud/api/health
```

Most likely fixes:

| Symptom | Fix |
|---------|-----|
| PM2 shows an app `errored` | `pm2 restart <app-name>`; if still broken, `pm2 logs <app-name> --err` |
| Nginx `502 Bad Gateway` | Backend on the upstream port isn't responding. `curl localhost:5000/api/health` and `curl localhost:4001/health` |
| `Origin … not allowed by CORS` | `CORS_ORIGIN` in the `.env` doesn't match what the browser is hitting. Update + `pm2 reload <app> --update-env` |
| SSL cert expired | `sudo certbot renew && sudo systemctl reload nginx`. Investigate why the timer didn't fire. |
| Disk full | `du -sh /var/www/uso-portal/logs/* /var/log/nginx/*` — most likely culprit is PM2 logs |

---

## Repo layout reminder

```
/                          ← repo root (https://github.com/XxDarknytxX/USO)
├── README.md              Stack overview
├── RUNBOOK.md             ← this file
├── .gitignore
├── uso-portal/            Public payment app
│   ├── backend/           Express, port 5000, .env-driven
│   └── frontend/          React + Vite (build → frontend/build)
├── voucher-validation/    Admin + portal-facing API
│   ├── backend/           Express, port 4001, .env-driven
│   └── frontend/          React + Vite (build → frontend/build)
├── captive-portal/        Ruijie custom HTML bundle (NOT served by this server)
└── deploy/                Server bootstrap + redeploy scripts
    ├── DEPLOYMENT.md      First-time setup walkthrough (this is for new servers)
    ├── setup-server.sh    One-shot install: Node, MySQL, Nginx, PM2, Certbot, UFW
    ├── init-mysql.sh      Creates both DBs + users, sets server collation
    ├── deploy-app.sh      Build + (re)start both apps under PM2
    ├── ecosystem.config.cjs   PM2 config — both apps
    └── nginx.conf.example     Vhost template (already deployed to /etc/nginx/...)
```
