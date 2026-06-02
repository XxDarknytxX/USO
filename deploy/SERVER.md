# USO Server — configuration reference

Single source of truth for how the production box is wired. No secret values
live here — only where they are. Pair with `DEPLOYMENT.md` (first-time setup),
`MULTISITE.md` (adding sites) and `nginx.uso-stack.conf` (the live vhost).

_Last updated: 2026-06-03._

---

## 1. Box

| | |
|---|---|
| SSH | `ssh corporate@172.26.70.130` (LAN, password auth) |
| Public IP | `27.123.190.114` |
| Hostname | `USO` |
| OS | Ubuntu 24.04.4 LTS |
| Repo | `/var/www/uso-portal` (GitHub `XxDarknytxX/USO`, branch `main`) |
| Process mgr | PM2 (user `corporate`) |
| Web server | nginx |
| DB | MySQL (local) |

> Note: nginx `server_name` still lists `172.26.70.9` as a LAN alias, but the
> box now answers on `172.26.70.130`. Harmless; tidy up when convenient.

---

## 2. Apps & ports

| App | PM2 name (id) | Backend port | Frontend build served by nginx |
|---|---|---|---|
| USO Portal (captive payment) | `uso-portal` (0) | `127.0.0.1:5000` | `/var/www/uso-portal/uso-portal/frontend/build` |
| Voucher Validation (admin) | `voucher-validation` (1) | `127.0.0.1:4001` | `/var/www/uso-portal/voucher-validation/frontend/build` |

```bash
pm2 ls                       # status
pm2 logs uso-portal          # USO backend logs
pm2 logs voucher-validation  # VV backend logs
pm2 restart uso-portal voucher-validation
```

---

## 3. Domains

All public hostnames → `27.123.190.114`.

| Host | Serves |
|---|---|
| `*.vodafonefiji.cloud` | USO Portal — **every site** (wildcard; backend picks the site from the Host header) |
| `portal.vodafonefiji.cloud` | USO Portal (legacy; still works) |
| `site1 / site2 / … siteN.vodafonefiji.cloud` | USO Portal (one per village) |
| `admin.vodafonefiji.cloud` | VV admin dashboard (exact name beats the wildcard) |
| `:8080` (LAN only) | VV admin fallback |

---

## 4. DNS — Cloudflare

- Registrar nameservers point at Cloudflare: `cass.ns.cloudflare.com`, `julio.ns.cloudflare.com`.
- Zone `vodafonefiji.cloud` (zone id `cb2de98e…`). All records **grey-cloud / DNS-only** (origin Let's Encrypt cert is used; do **not** switch the portal records to proxied/orange — it complicates the captive flow).

| Type | Name | Content | Notes |
|---|---|---|---|
| A | `*` | `27.123.190.114` | **wildcard** — every `siteN` resolves automatically |
| A | `admin` | `27.123.190.114` | |
| A | `portal` | `27.123.190.114` | |
| A | `@` (apex) | `2.57.91.91` | different host (not this server) |
| CNAME | `www` | `vodafonefiji.cloud` | |

Adding a new site needs **no new DNS record** — the wildcard covers it.

---

## 5. TLS — wildcard cert (auto-renewing)

- Cert: `/etc/letsencrypt/live/vodafonefiji.cloud/{fullchain,privkey}.pem`
- Covers `vodafonefiji.cloud` **and** `*.vodafonefiji.cloud` (one cert, every site + admin).
- Issued with the certbot Cloudflare DNS plugin (DNS-01), renews unattended via `certbot.timer`.
- Cloudflare API token (secret): `/root/.secrets/cloudflare.ini` (`chmod 600`).
- Reload hook (nginx picks up renewed certs): `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`.

```bash
sudo certbot certificates              # list certs
sudo certbot renew --dry-run           # test renewal
```

Re-issue / expand (rarely needed — wildcard already covers new sites):
```bash
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d 'vodafonefiji.cloud' -d '*.vodafonefiji.cloud'
```

> The old per-domain cert `portal.vodafonefiji.cloud` is superseded by the
> wildcard; `sudo certbot delete --cert-name portal.vodafonefiji.cloud` to retire it.
> ⚠️ The Cloudflare token was shared in chat during setup — rotate it: create a
> fresh "Edit zone DNS" token, replace the value in `/root/.secrets/cloudflare.ini`,
> `sudo certbot renew --dry-run`, then revoke the old one in Cloudflare.

---

## 6. nginx

- Live vhost: `/etc/nginx/sites-available/uso-stack` (symlinked into `sites-enabled/`).
- Version-controlled copy: `deploy/nginx.uso-stack.conf` (drop-in).
- USO block `server_name *.vodafonefiji.cloud …` on the wildcard cert; admin block exact name on the same cert; `:80` redirects everything to HTTPS; `:8080` LAN admin fallback.
- **Keep `proxy_set_header Host $host;`** — the backend resolves which site (plans/vouchers) from it.

```bash
# update from repo:
cd /var/www/uso-portal && git pull
sudo cp /etc/nginx/sites-available/uso-stack /etc/nginx/sites-available/uso-stack.bak.$(date +%s)
sudo cp deploy/nginx.uso-stack.conf /etc/nginx/sites-available/uso-stack
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Deploy

```bash
ssh corporate@172.26.70.130
cd /var/www/uso-portal && git pull
bash deploy/deploy-app.sh vv     # Voucher Validation only (runs DB migrations + site seed on boot)
bash deploy/deploy-app.sh uso    # USO Portal only
bash deploy/deploy-app.sh        # both
```
`deploy-app.sh` does `npm ci`, builds the frontend, and zero-downtime-reloads PM2. The VV backend runs the schema migrations + the site seed (`uso_1` / `uso_2`) on startup.

---

## 8. Multi-site model

- A **site** = one Ruijie Cloud project (its own `groupId`) + its own subdomain + its own captive HTML + its own plans.
- Sites live in the `network_projects` table; manage them in the admin under **Network → Add site**. The active site (SiteSwitcher) scopes vouchers, plans and health.
- Plans are tagged with `group_id`; the portal is **host-aware** — `siteN.vodafonefiji.cloud/api/plans` returns only that site's plans, and claims pull that site's vouchers (matched by the plan's `user_group_id`).

| Site | Domain | Ruijie project | groupId |
|---|---|---|---|
| uso_1 | `site1.vodafonefiji.cloud` | uso_1 | env `RUIJIE_GROUP_ID` |
| uso_2 | `site2.vodafonefiji.cloud` | uso_2 | `7847952` |

### Ruijie pre-auth allowlist (walled garden)
Before a device authenticates it can only reach domains in each Ruijie
project's **Pre-auth Allowlist**. Two URL entries cover everything — the
wildcard means **no per-site entry is ever needed**:

| Type | Entry | Why |
|---|---|---|
| URL | `*.vodafonefiji.cloud` | the portal — every site (site1…siteN + admin) |
| URL | `pay.mpaisa.vodafone.com.fj` | M-PAiSA payment gateway |

- If the M-PAiSA page stalls *mid-payment*, it's pulling sub-resources from
  another host (e.g. `*.vodafone.com.fj` or a 3-D-Secure/bank domain) — add those.
  Confirm the live payment host from `pm2 logs uso-portal` (`destinationurl`).
- Do **NOT** allowlist captive-detection probes (`captive.apple.com`,
  `connectivitycheck.gstatic.com`, `*.msftconnecttest.com`) — those are what
  trigger the portal to appear.

### Add a new site (3 … 30) — no server changes
1. `cd Resources/sites && ./new-site.sh 3` → `site3.zip` (captive HTML, outside the repo).
2. Ruijie Cloud (uso_3 project): upload `site3.zip` as Custom HTML. The
   `*.vodafonefiji.cloud` allowlist entry already covers the domain.
3. Admin → **Network → Add site** (name `uso_3`, hostname `site3.vodafonefiji.cloud`, its groupId) → switch to it → **Sync** → add its plans (use site-prefixed plan keys, e.g. `s3-daily-1gb`; plan keys are globally unique).

Wildcard DNS + wildcard cert + wildcard nginx + host-aware backend mean steps above are all that's needed.

---

## 9. Secrets — locations only (never commit values)

| Secret | Location |
|---|---|
| Cloudflare API token | `/root/.secrets/cloudflare.ini` |
| M-PAiSA creds + return URL | `uso-portal/backend/.env` (gitignored) |
| DB creds, Ruijie app id/secret, `RUIJIE_GROUP_ID` | `voucher-validation/backend/.env` (gitignored) |
| Admin login | user `kritish.vodafone@gmail.com` (password set during deploy) |

---

## 10. Known issues / TODO

- **M-PAiSA return URL** — `MPAISA_RETURN_URL` in `uso-portal/backend/.env` is still the old dev-tunnel and is single-value; per-site return is part of the paused payment work.
- **iOS captive payment** — the WiFi pop-up (CNA) can stall on the M-PAiSA hand-off; paused. See `payment` notes / the self-diagnosing hand-off screen.
- **Rotate the Cloudflare token** (shared in chat during setup) — see §5.
- **Stale LAN alias** `172.26.70.9` in nginx `server_name` — optional cleanup.
- npm audit reports vulnerabilities in deps (mostly transitive/dev) — review when convenient.
