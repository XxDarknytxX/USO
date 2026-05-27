#!/usr/bin/env bash
# =====================================================================
# Create the MySQL database + dedicated user for the USO Portal backend.
#
# Run as root (or via sudo) on the server. Reads credentials from
# environment variables — fill these before running:
#
#   DB_NAME       (default: uso_project)
#   DB_USER       (default: uso_user)
#   DB_PASSWORD   (REQUIRED — no default)
#
# Example:
#   sudo DB_PASSWORD='StrongPasswordHere' bash deploy/init-mysql.sh
#
# The backend auto-creates tables on first run (see backend/config/db.js),
# so no schema dump is needed here.
# =====================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-uso_project}"
DB_USER="${DB_USER:-uso_user}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD env var is required." >&2
  echo "  Example: sudo DB_PASSWORD='StrongPasswordHere' bash $0" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (use sudo) so we can use the unix_socket root login." >&2
  exit 1
fi

echo "==> Creating database '${DB_NAME}' and user '${DB_USER}'@'localhost'"

mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "==> Done. Put these in backend/.env:"
echo "    DB_HOST=localhost"
echo "    DB_PORT=3306"
echo "    DB_NAME=${DB_NAME}"
echo "    DB_USER=${DB_USER}"
echo "    DB_PASSWORD=<the one you just set>"
