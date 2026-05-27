# USO Portal — Ubuntu Deployment Guide

Target: clean Ubuntu 22.04 / 24.04 LTS server, single host running
**Node backend + MySQL + Nginx + Let's Encrypt SSL**.

The Voucher Validation service is assumed to be reachable from this host
(either co-located on the same box on `localhost:4001`, or via private
network — set `VOUCHER_VALIDATION_API_URL` accordingly in `backend/.env`).

---

## 1. Prerequisites

- DNS A record for `portal.example.com` pointing to the server's public IP.
- SSH access to the server with a sudo-capable user (`ubuntu`, `deploy`, etc.).
- M-PAiSA credentials (`MPAISA_CLIENT_ID`, `MPAISA_SECRET_KEY`).
- Shared secret with the Voucher Validation service (`PORTAL_API_SECRET`).

---

## 2. Clone the repo

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone https://github.com/<your-org>/uso-portal.git uso-portal
cd uso-portal
```

---

## 3. Bootstrap the server (once per box)

Installs Node 20, MySQL 8, Nginx, PM2, Certbot, and opens the firewall:

```bash
sudo bash deploy/setup-server.sh
sudo mysql_secure_installation        # set a root password, remove anon users, etc.
```

---

## 4. Create the database + app user

```bash
sudo DB_PASSWORD='ReplaceWithStrongPassword' bash deploy/init-mysql.sh
```

The backend auto-creates tables on first start (see `backend/config/db.js`),
so no schema file needs to be loaded.

---

## 5. Configure the backend

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Fill in:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` |
| `TRUST_PROXY` | `1` |
| `CORS_ORIGIN` | `https://portal.example.com` |
| `MPAISA_*` | Real M-PAiSA credentials |
| `MPAISA_RETURN_URL` | `https://portal.example.com/payment-result` |
| `DB_*` | Match what you set in step 4 |
| `VOUCHER_VALIDATION_API_URL` | URL of the VV service |
| `PORTAL_API_SECRET` | Must match the secret on the VV side |
| `RUIJIE_AUTH_URL` | Leave default unless told otherwise |

---

## 6. Build + start the app

```bash
bash deploy/deploy-app.sh
```

This runs `npm ci` for backend and frontend, builds the React app into
`frontend/build`, and launches the backend under PM2.

Check it's running:

```bash
pm2 status
pm2 logs uso-portal --lines 50
curl http://localhost:5000/api/health
```

---

## 7. Configure Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/uso-portal
sudo nano /etc/nginx/sites-available/uso-portal
# Replace `portal.example.com` and `/var/www/uso-portal` with your values.

sudo ln -s /etc/nginx/sites-available/uso-portal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Visit `http://portal.example.com` — the portal should load over HTTP.

---

## 8. Enable HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d portal.example.com
```

Certbot rewrites the Nginx vhost to add the `:443` server block and a
`:80 → :443` redirect. It also installs a systemd timer for auto-renewal.

Verify auto-renew:

```bash
sudo certbot renew --dry-run
```

---

## 9. Updating later (redeploy)

```bash
cd /var/www/uso-portal
git pull
bash deploy/deploy-app.sh
```

PM2 reloads the backend with zero downtime and the frontend rebuild
replaces `frontend/build` (Nginx picks up the new files immediately).

---

## 10. Operational commands

```bash
pm2 status                     # all PM2 apps
pm2 logs uso-portal            # tail backend logs
pm2 restart uso-portal         # full restart (clears memory)
pm2 reload uso-portal          # zero-downtime reload
pm2 monit                      # live CPU/mem dashboard

sudo systemctl status nginx
sudo systemctl reload nginx

sudo mysql -u uso_user -p uso_project
# Inside MySQL:
#   SHOW TABLES;
#   SELECT COUNT(*) FROM transactions;
```

Backend logs are also written to `logs/uso-portal.{out,err}.log` in the
project root (see `deploy/ecosystem.config.cjs`).

---

## 11. Backup

Daily MySQL dump via cron (run as the deploy user):

```bash
mkdir -p /var/backups/uso
crontab -e
# Add:
# 30 2 * * * /usr/bin/mysqldump -u uso_user -p'PASSWORD' uso_project | gzip > /var/backups/uso/uso_project-$(date +\%F).sql.gz
# 0  3 * * * find /var/backups/uso -name 'uso_project-*.sql.gz' -mtime +14 -delete
```

For production, prefer a `.my.cnf` with the password (chmod 600) over
embedding it in the crontab.

---

## 12. Troubleshooting

| Symptom | Check |
|---------|-------|
| Backend won't start | `pm2 logs uso-portal` — usually missing env var or DB unreachable |
| `502 Bad Gateway` from Nginx | Backend down or wrong port — `curl http://127.0.0.1:5000/api/health` |
| `Origin ... not allowed by CORS` | Add the origin to `CORS_ORIGIN` in `backend/.env`, then `pm2 reload uso-portal` |
| Real client IP shows as 127.0.0.1 | `TRUST_PROXY=1` not set in `backend/.env` |
| Voucher claim fails | VV service unreachable or `PORTAL_API_SECRET` mismatch |
| M-PAiSA callback 404 | Confirm `MPAISA_RETURN_URL` points at `/payment-result` on the public hostname |
