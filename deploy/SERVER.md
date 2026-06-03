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

**One USO Portal instance per site** (a PM2 process each, generated from
`deploy/sites.json`) + one shared admin. All USO instances run the same code and
share the same frontend build; they differ only by `PORT` / `CORS_ORIGIN` /
`MPAISA_RETURN_URL` (M-PAiSA creds + VV API are shared, from
`uso-portal/backend/.env`).

| App | PM2 name | Backend port | Serves |
|---|---|---|---|
| USO Portal — site1 | `uso-site1` | `127.0.0.1:5001` | `site1.vodafonefiji.cloud` + `portal.vodafonefiji.cloud` |
| USO Portal — site2 | `uso-site2` | `127.0.0.1:5002` | `site2.vodafonefiji.cloud` |
| USO Portal — siteN | `uso-siteN` | `127.0.0.1:500N` | added via `deploy/sites.json` |
| Voucher Validation (admin) | `voucher-validation` | `127.0.0.1:4001` | the single admin/API |

Shared frontend build: `/var/www/uso-portal/uso-portal/frontend/build`. nginx
routes each domain's `/api` + `/payment` to its instance via the host→port map
in `/etc/nginx/conf.d/uso-site-map.conf` (generated from `sites.json` by
`deploy/sync-sites.sh`).

```bash
pm2 ls                       # status
pm2 logs uso-site1           # one site's backend logs
pm2 logs voucher-validation  # VV backend logs
pm2 restart all              # or: pm2 restart uso-site1 uso-site2 voucher-validation
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

### Add a new site (3 … 30) — its own instance
DNS + cert + the wildcard vhost already cover any `siteN.vodafonefiji.cloud`, so
a new site is: a manifest entry → its PM2 instance → its nginx route → content.

1. **Captive HTML** (your machine): `cd Resources/sites && ./new-site.sh 3` → `site3.zip`.
2. **Manifest** — add to `deploy/sites.json` under `uso`:
   `{ "name": "site3", "host": "site3.vodafonefiji.cloud", "port": 5003, "groupId": "<ruijie group>" }`
   (next free port; `groupId` optional). Commit + push.
3. **On the server**:
   ```bash
   cd /var/www/uso-portal && git pull
   bash deploy/deploy-app.sh uso        # starts uso-site3 on :5003
   sudo bash deploy/sync-sites.sh       # routes site3.vodafonefiji.cloud → :5003 + reloads nginx
   ```
4. **Ruijie Cloud** (uso_3 project): upload `site3.zip` as Custom HTML. The
   `*.vodafonefiji.cloud` allowlist entry already covers the domain.
5. **Admin** → **Network → Add site** (name `uso_3`, hostname `site3.vodafonefiji.cloud`, its groupId) → switch to it → **Sync** → add its plans (site-prefixed plan keys, e.g. `s3-daily-1gb`; plan keys are globally unique).

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

- **M-PAiSA return URL** — `MPAISA_RETURN_URL` = `https://portal.vodafonefiji.cloud/payment-result` (all sites return here; the callback recovers the session server-side by transaction ID, so auth completes regardless of which site paid). To instead return customers to the **site they paid from** (better cancel→retry UX), set `MPAISA_RETURN_USE_HOST=true` in `uso-portal/backend/.env` — but **only after M-PAiSA accepts those return domains** (register `*.vodafonefiji.cloud` or each site), or it rejects the handshake.
- **iOS captive payment** — the WiFi pop-up (CNA) can stall on the M-PAiSA hand-off; paused. See `payment` notes / the self-diagnosing hand-off screen.
- **Rotate the Cloudflare token** (shared in chat during setup) — see §5.
- **Stale LAN alias** `172.26.70.9` in nginx `server_name` — optional cleanup.
- npm audit reports vulnerabilities in deps (mostly transitive/dev) — review when convenient.
