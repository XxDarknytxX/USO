#!/usr/bin/env bash
# =====================================================================
# Build + (re)start the USO Portal app on the server.
#
# Assumptions:
#   - You've already cloned the repo to the server.
#   - You've copied backend/.env.example -> backend/.env and filled it in.
#   - setup-server.sh + init-mysql.sh have been run.
#   - You run this from the project root as the deploy user (NOT root).
#
# Usage:
#   bash deploy/deploy-app.sh
# =====================================================================
set -euo pipefail

log() { echo -e "\n\033[1;34m==>\033[0m $*"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ ! -f backend/.env ]]; then
  echo "ERROR: backend/.env not found. Copy backend/.env.example to backend/.env and fill it in first." >&2
  exit 1
fi

log "Installing backend dependencies (production only)"
( cd backend && npm ci --omit=dev )

log "Installing frontend dependencies"
( cd frontend && npm ci )

log "Building frontend (outputs to frontend/build)"
( cd frontend && npm run build )

log "Starting/reloading backend via PM2"
if pm2 describe uso-portal >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi

log "Persisting PM2 process list (survives reboot)"
pm2 save

log "Deploy complete."
pm2 status
