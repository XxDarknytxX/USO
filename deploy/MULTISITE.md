# Adding a site (multi-site rollout)

Each site (village) = one Ruijie project (its own `groupId`) + its own portal
subdomain (`siteN.vodafonefiji.cloud`) + its own captive HTML + its own plans.
One USO Portal deployment serves **all** site domains; the backend figures out
which site a request is for from the `Host` header, so adding a site never
needs a new app deployment — just a DNS record, a `server_name` entry, a cert,
and the admin/Ruijie config.

Server: `corporate@172.26.70.9` · repo at `/var/www/uso-portal` · public IP
`27.123.190.114`.

---

## One-time: roll out site2 (and rename site1)

### 1. DNS  (at your DNS provider — do this FIRST)
Add an **A record** for each new site domain → `27.123.190.114`:

```
site1.vodafonefiji.cloud   A   27.123.190.114
site2.vodafonefiji.cloud   A   27.123.190.114
```

Wait until they resolve before step 4 (certbot needs them live):

```bash
dig +short site1.vodafonefiji.cloud   # → 27.123.190.114
dig +short site2.vodafonefiji.cloud   # → 27.123.190.114
```

### 2. Deploy the new code (renames site1 → uso_1, seeds uso_2, host-aware plans)
```bash
ssh corporate@172.26.70.9
cd /var/www/uso-portal && git pull
bash deploy/deploy-app.sh vv     # runs the DB migration + site seed
bash deploy/deploy-app.sh uso
pm2 restart uso-backend vv-backend
```

### 3. Add the site domains to nginx (safe: backup + validate + auto-restore)
```bash
cd /var/www/uso-portal
sudo bash deploy/add-site-domains.sh site1.vodafonefiji.cloud site2.vodafonefiji.cloud
```
It edits the existing portal `server_name`, runs `nginx -t`, reloads, and then
prints the exact `certbot` command for the next step.

### 4. Extend the TLS cert to the new domains
Run the command the script printed (it lists every portal + admin domain on one
cert):
```bash
sudo certbot --nginx --expand \
  -d portal.vodafonefiji.cloud \
  -d site1.vodafonefiji.cloud \
  -d site2.vodafonefiji.cloud \
  -d admin.vodafonefiji.cloud
sudo systemctl reload nginx
```

### 5. Ruijie Cloud (the uso_2 project)
- Upload `Resources/sites/site2.zip` as the project's **Custom HTML**.
- Add `site2.vodafonefiji.cloud` to the project's **Pre-auth Allowlist**.
- (site1 project: upload `site1.zip` and allowlist `site1.vodafonefiji.cloud`.)

### 6. Admin: configure site2's plans
- Open `https://admin.vodafonefiji.cloud`, switch the SiteSwitcher to **uso_2**.
- **Sync** uso_2, then create site2's plans (the user-group dropdown shows
  site2's Ruijie tiers). Use site-prefixed plan keys (e.g. `s2-daily-1gb`) —
  plan keys are globally unique.

### 7. Verify
```bash
curl -s https://site2.vodafonefiji.cloud/api/plans | head     # only site2 plans
curl -s https://site1.vodafonefiji.cloud/api/plans | head     # only site1 plans
```

---

## Adding sites 3 … 30 later
```bash
# 1. captive HTML + zip (on your machine)
cd Resources/sites && ./new-site.sh 3            # -> site3.zip

# 2. DNS A record for site3.vodafonefiji.cloud → 27.123.190.114

# 3. nginx + cert (on the server)
cd /var/www/uso-portal
sudo bash deploy/add-site-domains.sh site3.vodafonefiji.cloud
sudo certbot --nginx --expand -d portal.vodafonefiji.cloud -d site1.vodafonefiji.cloud \
  -d site2.vodafonefiji.cloud -d site3.vodafonefiji.cloud -d admin.vodafonefiji.cloud

# 4. Admin → Network → Add site (name uso_3, hostname site3.vodafonefiji.cloud,
#    its Ruijie groupId). Upload site3.zip in Ruijie + allowlist the domain.
#    Switch to uso_3, sync, add its plans.
```

> Heads-up: `MPAISA_RETURN_URL` in `uso-portal/backend/.env` is still a single
> value (and currently the old dev-tunnel URL). Per-site payment return is a
> separate change — see the paused payment work.
