#!/usr/bin/env bash
# =====================================================================
# Create both MySQL databases for the USO stack:
#   - uso_project        (USO Portal backend)
#   - voucher_management (Voucher Validation backend)
#
# Each gets its own dedicated user. Run as root (sudo) on the server.
#
# Env vars (set before running):
#   USO_DB_PASSWORD          REQUIRED — password for uso_user
#   VV_DB_PASSWORD           REQUIRED — password for vv_user
#   USO_DB_NAME              (default: uso_project)
#   USO_DB_USER              (default: uso_user)
#   VV_DB_NAME               (default: voucher_management)
#   VV_DB_USER               (default: vv_user)
#
# Example:
#   sudo USO_DB_PASSWORD='StrongPw1' VV_DB_PASSWORD='StrongPw2' \
#     bash deploy/init-mysql.sh
#
# Both backends auto-create their tables on first start.
# =====================================================================
set -euo pipefail

USO_DB_NAME="${USO_DB_NAME:-uso_project}"
USO_DB_USER="${USO_DB_USER:-uso_user}"
VV_DB_NAME="${VV_DB_NAME:-voucher_management}"
VV_DB_USER="${VV_DB_USER:-vv_user}"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (use sudo)." >&2
  exit 1
fi

if [[ -z "${USO_DB_PASSWORD:-}" || -z "${VV_DB_PASSWORD:-}" ]]; then
  echo "ERROR: USO_DB_PASSWORD and VV_DB_PASSWORD are required." >&2
  echo "  sudo USO_DB_PASSWORD='...' VV_DB_PASSWORD='...' bash $0" >&2
  exit 1
fi

# MySQL 8 ships with utf8mb4_0900_ai_ci as the server-wide default. Our backend
# code sometimes auto-creates tables/columns with explicit COLLATE clauses set
# to utf8mb4_unicode_ci, while other queries (and string literals) come in with
# the server default. The mismatch breaks joins with
# ER_CANT_AGGREGATE_2COLLATIONS. Force the server default to unicode_ci so all
# new connections, columns, and literals agree.
echo "==> Setting MySQL server-wide collation to utf8mb4_unicode_ci"
tee /etc/mysql/mysql.conf.d/zz-uso-collation.cnf >/dev/null <<'CNF'
[mysqld]
character-set-server = utf8mb4
collation-server     = utf8mb4_unicode_ci

[client]
default-character-set = utf8mb4
CNF
systemctl restart mysql
sleep 3

echo "==> Creating USO Portal DB '${USO_DB_NAME}' + user '${USO_DB_USER}'"
echo "==> Creating Voucher Validation DB '${VV_DB_NAME}' + user '${VV_DB_USER}'"

mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${USO_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${USO_DB_USER}'@'localhost' IDENTIFIED BY '${USO_DB_PASSWORD}';
ALTER USER '${USO_DB_USER}'@'localhost' IDENTIFIED BY '${USO_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${USO_DB_NAME}\`.* TO '${USO_DB_USER}'@'localhost';

CREATE DATABASE IF NOT EXISTS \`${VV_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${VV_DB_USER}'@'localhost' IDENTIFIED BY '${VV_DB_PASSWORD}';
ALTER USER '${VV_DB_USER}'@'localhost' IDENTIFIED BY '${VV_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${VV_DB_NAME}\`.* TO '${VV_DB_USER}'@'localhost';

FLUSH PRIVILEGES;
SQL

cat <<EOF

==> Done. Put these into the env files:

uso-portal/backend/.env
  DB_HOST=localhost
  DB_PORT=3306
  DB_NAME=${USO_DB_NAME}
  DB_USER=${USO_DB_USER}
  DB_PASSWORD=<USO_DB_PASSWORD you just set>

voucher-validation/backend/.env
  DATABASE_HOST=localhost
  DATABASE_PORT=3306
  DATABASE_NAME=${VV_DB_NAME}
  DATABASE_USER=${VV_DB_USER}
  DATABASE_PASSWORD=<VV_DB_PASSWORD you just set>

EOF
