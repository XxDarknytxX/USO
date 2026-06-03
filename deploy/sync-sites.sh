#!/usr/bin/env bash
# =====================================================================
# Regenerate the nginx "host → USO instance port" map from deploy/sites.json,
# then validate + reload nginx. Run on the server after editing sites.json
# (and after `bash deploy/deploy-app.sh uso` has started the new instance).
#
#   sudo bash deploy/sync-sites.sh
#
# Writes /etc/nginx/conf.d/uso-site-map.conf which defines $uso_api_upstream,
# used by /etc/nginx/sites-available/uso-stack. The main vhost never changes
# when you add a site — only this generated map does.
# =====================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="/etc/nginx/conf.d/uso-site-map.conf"

command -v node >/dev/null || { echo "ERROR: node not found (needed to read sites.json)"; exit 1; }

MAP="$(node -e '
  const sites = (require(process.argv[1]).uso || []).filter(s => s && s.host && s.port);
  if (!sites.length) { console.error("no sites in sites.json"); process.exit(1); }
  const def = sites[0].port;
  let o = "# AUTO-GENERATED from deploy/sites.json by deploy/sync-sites.sh — do not edit by hand.\n";
  o += "map $host $uso_api_upstream {\n";
  o += "    default                    127.0.0.1:" + def + ";\n";
  o += "    portal.vodafonefiji.cloud  127.0.0.1:" + def + ";\n";
  for (const s of sites) o += "    " + s.host.padEnd(26) + " 127.0.0.1:" + s.port + ";\n";
  o += "}\n";
  process.stdout.write(o);
' "$DIR/deploy/sites.json")"

echo "$MAP" | sudo tee "$OUT" >/dev/null
echo "Wrote $OUT:"
echo "----------------------------------------"
echo "$MAP"
echo "----------------------------------------"

sudo nginx -t && sudo systemctl reload nginx
echo "nginx validated + reloaded."
