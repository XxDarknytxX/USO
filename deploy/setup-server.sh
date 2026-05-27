#!/usr/bin/env bash
# =====================================================================
# USO Portal — one-shot Ubuntu server bootstrap.
#
# Installs everything needed to host the portal on a clean Ubuntu 22.04
# or 24.04 box:
#   - Node.js 20 LTS
#   - MySQL 8 server
#   - Nginx
#   - PM2 (Node process manager, runs as systemd service)
#   - Certbot (Let's Encrypt SSL)
#   - UFW firewall (22, 80, 443 open)
#   - git, build-essential, curl
#
# Run ONCE on a fresh server:
#   sudo bash deploy/setup-server.sh
#
# Idempotent — safe to re-run.
# =====================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)." >&2
  exit 1
fi

log() { echo -e "\n\033[1;34m==>\033[0m $*"; }

log "Updating apt indexes"
apt-get update -y

log "Installing base packages (curl, git, build-essential, ufw, ca-certificates)"
apt-get install -y curl git build-essential ufw ca-certificates gnupg

log "Installing Node.js 20 LTS via NodeSource"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v20" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node --version
npm --version

log "Installing PM2 globally"
npm install -g pm2@latest

log "Installing MySQL 8 server"
DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server
systemctl enable --now mysql

log "Installing Nginx"
apt-get install -y nginx
systemctl enable --now nginx

log "Installing Certbot (Let's Encrypt) via snap"
if ! command -v snap >/dev/null 2>&1; then
  apt-get install -y snapd
fi
snap install core || true
snap refresh core || true
snap install --classic certbot || true
ln -sf /snap/bin/certbot /usr/bin/certbot

log "Configuring UFW firewall (22/SSH, 80/HTTP, 443/HTTPS)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
# `ufw --force enable` is non-interactive; safe re-run.
ufw --force enable

log "Configuring PM2 to start on boot for the deploy user"
DEPLOY_USER="${SUDO_USER:-$USER}"
if [[ "$DEPLOY_USER" != "root" ]]; then
  sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" || true
  # The above prints a `sudo env ...` command — auto-run it:
  STARTUP_CMD=$(sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" 2>/dev/null | grep -E '^sudo env' | tail -n1 || true)
  if [[ -n "$STARTUP_CMD" ]]; then
    eval "$STARTUP_CMD"
  fi
fi

log "Done — base server is ready."
cat <<'EOF'

Next steps:
  1. Secure MySQL:           sudo mysql_secure_installation
  2. Create app DB + user:   sudo bash deploy/init-mysql.sh
  3. Deploy the app:         bash deploy/deploy-app.sh
  4. Issue SSL cert:         sudo certbot --nginx -d portal.example.com

EOF
