#!/usr/bin/env bash
# =====================================================================
# Add one or more site domains to the USO Portal nginx vhost.
#
# Safe by design: backs up the vhost, edits only the server_name line(s)
# that already serve the portal, validates with `nginx -t`, and AUTO-RESTORES
# the backup if validation fails. It does NOT touch TLS certs — it prints the
# exact `certbot` command for you to run (so you see the full domain list).
#
# Run ON THE SERVER as a sudo-capable user:
#   sudo bash deploy/add-site-domains.sh site2.vodafonefiji.cloud [site3.vodafonefiji.cloud ...]
#
# Prereq: each new domain's DNS A record already points at this server.
# =====================================================================
set -euo pipefail

[ "$#" -ge 1 ] || { echo "usage: sudo bash $0 <domain> [domain ...]"; exit 1; }

# An existing portal domain already on the vhost — used to locate the block.
ANCHOR="${ANCHOR_DOMAIN:-portal.vodafonefiji.cloud}"
ANCHOR_RE="${ANCHOR//./\\.}"

NGINX_FILE="$(grep -rlE "server_name[^;]*${ANCHOR_RE}" \
  /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -1 || true)"
[ -n "$NGINX_FILE" ] || { echo "ERROR: no nginx block has server_name containing ${ANCHOR}"; exit 1; }
echo "USO vhost : $NGINX_FILE"

BACKUP="${NGINX_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$NGINX_FILE" "$BACKUP"
echo "Backup    : $BACKUP"

for d in "$@"; do
  de="${d//./\\.}"
  if grep -qE "server_name[^;]*[[:space:]]${de}([[:space:];])" "$NGINX_FILE" \
     || grep -qE "server_name[[:space:]]+${de}([[:space:];])" "$NGINX_FILE"; then
    echo "  = $d already present"
  else
    # Insert " $d" before the ';' on every server_name line that has the anchor.
    sed -i -E "/server_name[^;]*${ANCHOR_RE}/ s/(server_name[^;]*[^;[:space:]])([[:space:]]*;)/\1 ${d}\2/" "$NGINX_FILE"
    echo "  + $d"
  fi
done

echo "Validating nginx config..."
if nginx -t; then
  systemctl reload nginx
  echo "OK: nginx reloaded."
else
  echo "FAILED nginx -t — restoring backup and aborting."
  cp "$BACKUP" "$NGINX_FILE"
  exit 1
fi

echo
echo "Now extend the TLS cert to cover the new domain(s). Review the -d list"
echo "(it must include ALL portal + admin domains on ONE cert), then run:"
echo
printf '  sudo certbot --nginx --expand -d %s' "$ANCHOR"
for d in "$@"; do printf -- ' -d %s' "$d"; done
printf -- ' -d admin.vodafonefiji.cloud\n\n'
