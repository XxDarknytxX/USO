# USO Stack — Ubuntu Deployment Guide

Target: clean Ubuntu 22.04 / 24.04 LTS, single host running everything:

- **USO Portal** — public-facing payment app (`uso-portal/`, backend port `5000`)
- **Voucher Validation** — admin dashboard + portal-facing API (`voucher-validation/`, backend port `4001`)
- **MySQL 8** — two databases: `uso_project` + `voucher_management`
- **Nginx** — two vhosts: `portal.example.com` (public) + `admin.example.com` (internal)
- **Let's Encrypt** — SSL for both hostnames
- **PM2** — runs both Node backends, survives reboot

---

## 1. Prerequisites

- DNS A records for **both** hostnames pointing to the server's public IP:
  - `portal.example.com`
  - `admin.example.com` (or use a subdomain like `vv.example.com`)
- SSH access to the server with a sudo-capable user.
- M-PAiSA credentials (`MPAISA_CLIENT_ID`, `MPAISA_SECRET_KEY`).
- Ruijie Cloud API credentials (`RUIJIE_APP_ID`, `RUIJIE_APP_SECRET`, `RUIJIE_GROUP_ID`, `RUIJIE_TENANT_ID`).

---

## 2. Clone the repo

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone https://github.com/XxDarknytxX/USO.git uso-portal
cd uso-portal
```

(The repo is named `USO` but we clone it as `uso-portal/` so the path
matches the `nginx.conf.example` example.)

---

## 3. Bootstrap the server (once per box)

Installs Node 20, MySQL 8, Nginx, PM2, Certbot, and opens the firewall:

```bash
sudo bash deploy/setup-server.sh
sudo mysql_secure_installation        # set a root password
```

---

## 4. Create both databases + app users

```bash
sudo USO_DB_PASSWORD='StrongPw1' VV_DB_PASSWORD='StrongPw2' \
  bash deploy/init-mysql.sh
```

This creates:

| DB | User | Used by |
|----|------|---------|
| `uso_project` | `uso_user` | USO Portal backend |
| `voucher_management` | `vv_user` | Voucher Validation backend |

Both backends auto-create their tables on first start.

---

## 5. Configure both backends

```bash
cp uso-portal/backend/.env.example       uso-portal/backend/.env
cp voucher-validation/backend/.env.example voucher-validation/backend/.env
nano uso-portal/backend/.env
nano voucher-validation/backend/.env
```

Generate one shared secret used by both:

```bash
openssl rand -hex 32        # paste into PORTAL_API_SECRET in BOTH .env files
openssl rand -hex 64        # paste into JWT_SECRET in voucher-validation/backend/.env
```

Critical settings:

**`uso-portal/backend/.env`**

| Variable | Value |
|----------|-------|
| `CORS_ORIGIN` | `https://portal.example.com` |
| `MPAISA_RETURN_URL` | `https://portal.example.com/payment-result` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Match what `init-mysql.sh` created (`uso_user` / your password / `uso_project`) |
| `VOUCHER_VALIDATION_API_URL` | `http://localhost:4001` (same host) |
| `PORTAL_API_SECRET` | Same value in both .env files |

**`voucher-validation/backend/.env`**

| Variable | Value |
|----------|-------|
| `CORS_ORIGIN` | `https://admin.example.com` |
| `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` | Match `init-mysql.sh` (`vv_user` / your password / `voucher_management`) |
| `JWT_SECRET` | Long random string |
| `PORTAL_API_SECRET` | Same value as in `uso-portal/backend/.env` |
| `RUIJIE_*` | Real Ruijie Cloud API credentials |

---

## 6. Build + start both apps

```bash
bash deploy/deploy-app.sh
```

This runs `npm ci` for all four package.json files, builds both React
apps, and launches both backends under PM2.

Check both are running:

```bash
pm2 status
pm2 logs --lines 30
curl http://localhost:5000/api/health      # USO Portal
curl http://localhost:4001/health          # Voucher Validation
```

---

## 7. Seed the first admin user (Voucher Validation)

The VV admin dashboard needs an initial login. There's a seed script:

```bash
cd voucher-validation/backend
node src/seed.js
# Default credentials are baked into seed.js — open it first and
# change the email/password before running, OR after first login
# create a real admin via the Users page and delete the seed account.
```

---

## 8. Configure Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/uso-stack
sudo nano /etc/nginx/sites-available/uso-stack
# Replace `portal.example.com`, `admin.example.com`, and
# `/var/www/uso-portal` with your values.

sudo ln -s /etc/nginx/sites-available/uso-stack /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Visit `http://portal.example.com` and `http://admin.example.com` — both
should load over HTTP.

---

## 9. Enable HTTPS for both hostnames

```bash
sudo certbot --nginx -d portal.example.com -d admin.example.com
```

Certbot rewrites the vhost file to add `:443` server blocks and
HTTP→HTTPS redirects. Auto-renewal is installed as a systemd timer.

Verify:

```bash
sudo certbot renew --dry-run
```

---

## 10. Upload the captive-portal HTML to Ruijie

The `captive-portal/` directory is what gets uploaded to the Ruijie
controller (it doesn't run on this server — it runs on the AP).

```bash
cd captive-portal
sed -i 's/PORTAL_HOSTNAME_HERE/portal.example.com/g' index.html loadConfig.json
zip -r customHtml.zip . -x "README.md" "Archive.zip"
# Upload customHtml.zip via the Ruijie Cloud dashboard.
```

---

## 11. Updating later (redeploy)

```bash
cd /var/www/uso-portal
git pull
bash deploy/deploy-app.sh             # rebuilds both apps + zero-downtime reload
# or
bash deploy/deploy-app.sh uso         # just USO Portal
bash deploy/deploy-app.sh vv          # just Voucher Validation
```

---

## 12. Operational commands

```bash
pm2 status                                # both apps
pm2 logs uso-portal --lines 50
pm2 logs voucher-validation --lines 50
pm2 reload uso-portal                     # zero-downtime
pm2 restart voucher-validation            # full restart (clears memory)
pm2 monit                                 # live dashboard

sudo systemctl reload nginx
sudo mysql -u uso_user -p uso_project
sudo mysql -u vv_user  -p voucher_management
```

Logs are also written to `logs/uso-portal.{out,err}.log` and
`logs/voucher-validation.{out,err}.log` in the project root.

---

## 13. Backup

Daily MySQL dump of both DBs (run as the deploy user):

```bash
mkdir -p /var/backups/uso
crontab -e
```

Add:

```cron
30 2 * * * /usr/bin/mysqldump -u uso_user -p'USO_PW' uso_project         | gzip > /var/backups/uso/uso_project-$(date +\%F).sql.gz
35 2 * * * /usr/bin/mysqldump -u vv_user  -p'VV_PW'  voucher_management  | gzip > /var/backups/uso/voucher_management-$(date +\%F).sql.gz
0  3 * * * find /var/backups/uso -name '*.sql.gz' -mtime +14 -delete
```

For production, use a `~/.my.cnf` (chmod 600) with the passwords instead
of embedding them in the crontab.

---

## 14. Troubleshooting

| Symptom | Check |
|---------|-------|
| Backend won't start | `pm2 logs <app>` — usually missing env var or DB unreachable |
| `502 Bad Gateway` from Nginx | Backend down or wrong port — `curl localhost:5000/api/health` / `curl localhost:4001/health` |
| `Origin … not allowed by CORS` | Add the origin to `CORS_ORIGIN`, then `pm2 reload <app>` |
| Real client IP shows 127.0.0.1 | `TRUST_PROXY=1` not set in the .env |
| USO Portal calls to VV fail with 401 | `PORTAL_API_SECRET` doesn't match between the two .env files |
| Admin login fails | `JWT_SECRET` empty or changed since the token was issued — re-login |
| Voucher claim fails | VV not running, or `VOUCHER_VALIDATION_API_URL` in USO env points somewhere else |
| M-PAiSA callback 404 | `MPAISA_RETURN_URL` doesn't match the actual public URL of `/payment-result` |
