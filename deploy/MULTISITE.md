# Multi-site rollout (wildcard)

Each site (village) = one Ruijie project (its own `groupId`) + its own portal
subdomain (`siteN.vodafonefiji.cloud`) + its own captive HTML + its own plans.
One USO Portal deployment serves **all** site domains; the backend resolves
which site a request is for from the `Host` header.

**With a wildcard DNS record + wildcard TLS cert + wildcard nginx `server_name`,
a new site needs ZERO server changes.** Adding site N = captive-HTML zip +
Ruijie upload + one "Add site" in the admin. DNS, TLS and nginx already cover it.

Server: `corporate@172.26.70.9` · repo `/var/www/uso-portal` · IP `27.123.190.114`
· DNS on Cloudflare (grey-cloud / DNS-only).

---

## Part A — one-time wildcard setup

### A1. Cloudflare DNS — one wildcard record
DNS records → **Add record**:

| Type | Name | Content | Proxy |
|------|------|------------------------|----------|
| A    | `*`  | `27.123.190.114`       | DNS only (grey) |

Keep `portal` and `admin` as they are. Leave it **grey (DNS only)** so the
origin Let's Encrypt cert is used and captive devices reach the origin directly.

Verify: `dig +short site2.vodafonefiji.cloud` → `27.123.190.114`

### A2. Cloudflare API token (for automatic wildcard cert validation)
Dashboard → **My Profile → API Tokens → Create Token → "Edit zone DNS"** →
Zone Resources = `vodafonefiji.cloud` → Create → copy the token.

### A3. Server — issue the wildcard cert (DNS-01, auto-renewing)
```bash
ssh corporate@172.26.70.9

# certbot Cloudflare plugin (apt certbot):
sudo apt-get update && sudo apt-get install -y python3-certbot-dns-cloudflare
# (snap certbot instead? → sudo snap set certbot trust-plugin-with-root=ok && sudo snap install certbot-dns-cloudflare)

# save the token
sudo mkdir -p /root/.secrets
echo 'dns_cloudflare_api_token = PASTE_TOKEN_HERE' | sudo tee /root/.secrets/cloudflare.ini >/dev/null
sudo chmod 600 /root/.secrets/cloudflare.ini

# issue ONE cert for the apex + every subdomain
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d 'vodafonefiji.cloud' -d '*.vodafonefiji.cloud'
# → /etc/letsencrypt/live/vodafonefiji.cloud/{fullchain,privkey}.pem
```
Renewal is automatic (the plugin re-validates via the saved token).

### A4. Server — point nginx at the wildcard cert + wildcard server_name
Find the vhost: `grep -rl 'vodafonefiji.cloud' /etc/nginx/sites-*`. Then in it:

- **USO Portal block(s)** (the `:443` block and certbot's `:80` redirect block):
  ```nginx
  server_name *.vodafonefiji.cloud;
  ssl_certificate     /etc/letsencrypt/live/vodafonefiji.cloud/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/vodafonefiji.cloud/privkey.pem;
  ```
- **Admin block** — keep `server_name admin.vodafonefiji.cloud;` (exact match
  wins over the wildcard) but point its `ssl_certificate*` at the same wildcard
  cert paths above.

Then:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
> The repo's `deploy/nginx.conf.example` shows the target layout. If you'd
> rather not hand-edit, paste me the output of
> `sudo cat <your vhost file>` and I'll return the exact finished file.

### A5. Deploy the new code (host-aware plans + site seed)
```bash
cd /var/www/uso-portal && git pull
bash deploy/deploy-app.sh vv && bash deploy/deploy-app.sh uso
pm2 restart uso-portal voucher-validation   # (the deploy script already reloads them)
```

### A6. Verify
```bash
curl -s https://site1.vodafonefiji.cloud/api/plans | head   # site1 plans only
curl -s https://site2.vodafonefiji.cloud/api/plans | head   # site2 plans only
```

---

## Part B — add each new site (3 … 30): NO server changes

1. **Captive HTML** (your machine): `cd Resources/sites && ./new-site.sh 3` → `site3.zip`
2. **Ruijie Cloud** (the uso_3 project): upload `site3.zip` as Custom HTML; add
   `site3.vodafonefiji.cloud` to the Pre-auth Allowlist (or allowlist
   `*.vodafonefiji.cloud` once if your Ruijie build supports wildcard entries).
3. **Admin** → **Network → Add site**: name `uso_3`, hostname
   `site3.vodafonefiji.cloud`, its Ruijie `groupId`. Then switch the
   SiteSwitcher to uso_3, **sync**, and add its plans (use site-prefixed plan
   keys, e.g. `s3-daily-1gb` — plan keys are globally unique).

That's it — wildcard DNS resolves it, the wildcard cert secures it, the wildcard
nginx serves it, and the backend routes it by Host.

---

> Note: `MPAISA_RETURN_URL` in `uso-portal/backend/.env` is still single-value
> (and currently the old dev-tunnel URL). Per-site payment return is part of the
> paused payment work.
>
> `deploy/add-site-domains.sh` is only needed if you DON'T use the wildcard
> (it appends explicit domains + a per-domain cert instead).
