#!/usr/bin/env bash
# =====================================================================
# Build + (re)start both apps under PM2.
#
# Prerequisites:
#   - setup-server.sh + init-mysql.sh have been run.
#   - uso-portal/backend/.env       exists (from .env.example)
#   - voucher-validation/backend/.env exists (from .env.example)
#   - Repo cloned and you're running this from the project root as the
#     deploy user (NOT root).
#
# Usage:
#   bash deploy/deploy-app.sh
#   bash deploy/deploy-app.sh uso         # only USO Portal
#   bash deploy/deploy-app.sh vv          # only Voucher Validation
# =====================================================================
set -euo pipefail

log() { echo -e "\n\033[1;34m==>\033[0m $*"; }
die() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
mkdir -p logs

TARGET="${1:-all}"

build_uso() {
  [[ -f uso-portal/backend/.env ]] || die "uso-portal/backend/.env missing — copy from .env.example"

  log "USO Portal: installing backend deps"
  ( cd uso-portal/backend && npm ci --omit=dev )

  log "USO Portal: installing frontend deps"
  ( cd uso-portal/frontend && npm ci )

  log "USO Portal: building frontend → uso-portal/frontend/build"
  ( cd uso-portal/frontend && npm run build )
}

build_vv() {
  [[ -f voucher-validation/backend/.env ]] || die "voucher-validation/backend/.env missing — copy from .env.example"

  log "VV: installing backend deps"
  ( cd voucher-validation/backend && npm ci --omit=dev )

  log "VV: installing frontend deps"
  ( cd voucher-validation/frontend && npm ci )

  log "VV: building frontend → voucher-validation/frontend/build"
  ( cd voucher-validation/frontend && npm run build )
}

case "$TARGET" in
  uso) build_uso ;;
  vv)  build_vv ;;
  all) build_uso; build_vv ;;
  *)   die "Unknown target '$TARGET' — use: uso | vv | all" ;;
esac

log "Starting/reloading PM2 apps"
# startOrReload starts any new per-site instances (from deploy/sites.json) and
# zero-downtime-reloads the ones already running.
pm2 startOrReload deploy/ecosystem.config.cjs --update-env

log "Persisting PM2 process list"
pm2 save

log "Deploy complete."
pm2 status
