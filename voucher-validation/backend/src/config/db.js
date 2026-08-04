// src/config/db.js
import mysql from "mysql2/promise";

const unquote = v => (v || "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

const base = {
  host: process.env.DATABASE_HOST || "localhost",
  port: Number(process.env.DATABASE_PORT || 3306),
  user: unquote(process.env.DATABASE_USER),
  password: unquote(process.env.DATABASE_PASSWORD),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

/**
 * Ensures the database exists (if DATABASE_NAME is set) and returns a pooled connection.
 */
export async function getPool() {
  const db = process.env.DATABASE_NAME;
  const admin = await mysql.createConnection(base);
  if (db) {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  }
  await admin.end();

  const pool = mysql.createPool({ ...base, database: db || undefined });

  // Run lightweight migrations for new columns
  const migrations = [
    `ALTER TABLE users ADD COLUMN name VARCHAR(255) NULL AFTER email`,
    `ALTER TABLE users ADD COLUMN role ENUM('admin','viewer') NOT NULL DEFAULT 'viewer' AFTER password_hash`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== "ER_DUP_FIELDNAME") throw e; }
  }

  // Ensure the original seeded user is admin
  await pool.query(`UPDATE users SET role = 'admin' WHERE role = 'viewer' AND id = (SELECT min_id FROM (SELECT MIN(id) AS min_id FROM users) t)`).catch(() => {});

  // Create portal integration tables
  // Use utf8mb4_unicode_ci to match the existing vouchers table collation
  // (set by schema.sql). Mixing with the MySQL 8 default 0900_ai_ci breaks
  // JOINs with ER_CANT_AGGREGATE_2COLLATIONS.
  const tableCreations = [
    `CREATE TABLE IF NOT EXISTS portal_plan_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_group_id VARCHAR(50) NOT NULL,
      user_group_name VARCHAR(255) NULL,
      group_id VARCHAR(100) NULL,
      plan_key VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      category ENUM('daily','weekly','monthly','custom') NOT NULL DEFAULT 'daily',
      price DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'FJD',
      data_allowance VARCHAR(100) NOT NULL,
      icon VARCHAR(100) NOT NULL DEFAULT 'fas fa-calendar-day',
      popular BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT NULL,
      features JSON NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_by INT NULL,
      updated_by INT NULL,
      INDEX idx_category (category),
      INDEX idx_is_active (is_active),
      INDEX idx_user_group_id (user_group_id),
      INDEX idx_plan_group_id (group_id),
      INDEX idx_sort_order (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS voucher_claims (
      id INT AUTO_INCREMENT PRIMARY KEY,
      voucher_id INT NOT NULL,
      voucher_uuid VARCHAR(255) NOT NULL,
      voucher_code VARCHAR(255) NOT NULL,
      plan_config_id INT NOT NULL,
      user_group_id VARCHAR(50) NOT NULL,
      transaction_id VARCHAR(255) NOT NULL UNIQUE,
      session_id VARCHAR(255) NULL,
      client_mac VARCHAR(17) NULL,
      status ENUM('claimed','used','released','expired','manually_assigned') NOT NULL DEFAULT 'claimed',
      claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      used_at TIMESTAMP NULL,
      released_at TIMESTAMP NULL,
      expires_at TIMESTAMP NULL,
      INDEX idx_voucher_id (voucher_id),
      INDEX idx_voucher_uuid (voucher_uuid),
      INDEX idx_plan_config_id (plan_config_id),
      INDEX idx_transaction_id (transaction_id),
      INDEX idx_status (status),
      INDEX idx_expires_at (expires_at),
      INDEX idx_client_mac (client_mac)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS portal_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      transaction_id VARCHAR(255) NULL,
      session_id VARCHAR(255) NULL,
      plan_key VARCHAR(100) NULL,
      user_group_id VARCHAR(50) NULL,
      voucher_code VARCHAR(255) NULL,
      amount DECIMAL(10,2) NULL,
      customer_phone VARCHAR(20) NULL,
      event_data JSON NULL,
      source_ip VARCHAR(45) NULL,
      source_system VARCHAR(50) DEFAULT 'uso_portal',
      event_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_event_type (event_type),
      INDEX idx_transaction_id (transaction_id),
      INDEX idx_session_id (session_id),
      INDEX idx_event_timestamp (event_timestamp),
      INDEX idx_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Network monitoring "projects" — each maps a named site/portal to a
    // Ruijie Cloud network (groupId/tenantId) so the dashboard can show the
    // topology + device health per project. Designed for multiple projects.
    `CREATE TABLE IF NOT EXISTS network_projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      hostname VARCHAR(255) NULL,
      ruijie_group_id VARCHAR(100) NULL,
      ruijie_tenant_id VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_active (is_active),
      INDEX idx_sort (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Which villages (network_projects) a VIEWER user is allowed to see. Admins are
    // unrestricted and have NO rows here; a viewer with no rows sees nothing. Created
    // AFTER network_projects so the FK target exists. ON DELETE CASCADE cleans up when
    // a user or a project is removed. This is the server-side scope store — the SPA's
    // client-side site filter is advisory only.
    `CREATE TABLE IF NOT EXISTS user_villages (
      user_id INT NOT NULL,
      project_id INT NOT NULL,
      PRIMARY KEY (user_id, project_id),
      INDEX idx_uv_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES network_projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Latest network status snapshot per project (one row each) — written by the
    // background overview collector, read by GET /api/network/overview.
    `CREATE TABLE IF NOT EXISTS network_status (
      project_id INT PRIMARY KEY,
      gateway_online BOOLEAN NULL,
      internet_up BOOLEAN NULL,
      aps_total INT NOT NULL DEFAULT 0,
      aps_online INT NOT NULL DEFAULT 0,
      switches_total INT NOT NULL DEFAULT 0,
      switches_online INT NOT NULL DEFAULT 0,
      clients INT NOT NULL DEFAULT 0,
      usage_bytes BIGINT NULL,
      public_ip VARCHAR(64) NULL,
      cloud_sync BOOLEAN NOT NULL DEFAULT FALSE,
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Time series of status samples — for uptime % and usage trends.
    `CREATE TABLE IF NOT EXISTS network_status_history (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      gateway_online BOOLEAN NULL,
      internet_up BOOLEAN NULL,
      aps_total INT NOT NULL DEFAULT 0,
      aps_online INT NOT NULL DEFAULT 0,
      clients INT NOT NULL DEFAULT 0,
      usage_bytes BIGINT NULL,
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_proj_time (project_id, checked_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // M-PAiSA number → email mapping, ingested from the periodic customer report
    // (a UTF-16 tab-separated SQL export). `number` is the key: re-uploading a
    // report updates existing rows and inserts new ones (never duplicates).
    `CREATE TABLE IF NOT EXISTS mpaisa_mappings (
      number VARCHAR(32) NOT NULL PRIMARY KEY,
      email VARCHAR(255) NULL,
      email_status VARCHAR(32) NULL,
      account_status VARCHAR(32) NULL,
      source_logtime DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Per-user UI preferences (e.g. the village display filter + active scope),
    // stored server-side so a user's settings sync across their devices instead
    // of living in one browser's localStorage. One JSON blob per user.
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INT NOT NULL PRIMARY KEY,
      prefs JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // SMTP (outgoing email) config — a single row (id=1). Kept OUT of app_settings
    // because that table is returned wholesale to the client; the password here is
    // never sent back. Not wired to any sender yet — configured ahead of upcoming
    // email features.
    `CREATE TABLE IF NOT EXISTS smtp_settings (
      id INT NOT NULL PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT 0,
      host VARCHAR(255) NULL,
      port INT NULL,
      secure BOOLEAN NOT NULL DEFAULT 1,
      encryption VARCHAR(16) NOT NULL DEFAULT 'starttls',
      username VARCHAR(255) NULL,
      password VARCHAR(512) NULL,
      from_name VARCHAR(255) NULL,
      from_email VARCHAR(255) NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (const sql of tableCreations) {
    try {
      await pool.query(sql);
    } catch (e) {
      // Table already exists is fine
      if (!e.message.includes('already exists')) {
        console.error('Table creation error:', e.message);
      }
    }
  }

  // Add client_mac column to voucher_claims if it doesn't exist (migration for existing DBs)
  const voucherClaimsMigrations = [
    `ALTER TABLE voucher_claims ADD COLUMN client_mac VARCHAR(17) NULL AFTER session_id`,
    `ALTER TABLE voucher_claims ADD INDEX idx_client_mac (client_mac)`,
  ];
  for (const sql of voucherClaimsMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_DUP_KEYNAME') { /* ignore */ } }
  }

  // Index voucher_code on the audit log — the voucher list joins it by
  // voucher_code to bind the M-PAiSA payer phone for search/display.
  const auditIndexMigrations = [
    `ALTER TABLE portal_audit_logs ADD INDEX idx_voucher_code (voucher_code)`,
  ];
  for (const sql of auditIndexMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== 'ER_DUP_KEYNAME') { /* ignore */ } }
  }

  // SMTP: add the `encryption` column (STARTTLS/SSL/none) to tables created with
  // only the older `secure` boolean.
  const smtpMigrations = [
    `ALTER TABLE smtp_settings ADD COLUMN encryption VARCHAR(16) NOT NULL DEFAULT 'starttls' AFTER secure`,
  ];
  for (const sql of smtpMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') { /* ignore */ } }
  }

  // 'manually_assigned' claim status — a paid-but-auth-failed voucher stays
  // reserved for that customer (recovered via manual voucher-login) instead of
  // being released to the pool.
  const claimStatusMigrations = [
    `ALTER TABLE voucher_claims MODIFY COLUMN status ENUM('claimed','used','released','expired','manually_assigned') NOT NULL DEFAULT 'claimed'`,
  ];
  for (const sql of claimStatusMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { /* idempotent — already applied */ }
  }

  // Multi-site: tag each voucher with its Ruijie network group (the "site").
  // Vouchers existed before this column, so add it + backfill to the env group.
  const siteColumnMigrations = [
    `ALTER TABLE vouchers ADD COLUMN group_id VARCHAR(100) NULL AFTER user_group_id`,
    `ALTER TABLE vouchers ADD INDEX idx_group_id (group_id)`,
    `ALTER TABLE vouchers_historical ADD COLUMN group_id VARCHAR(100) NULL AFTER user_group_id`,
    `ALTER TABLE vouchers_historical ADD INDEX idx_group_id (group_id)`,
  ];
  for (const sql of siteColumnMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_DUP_KEYNAME' && !String(e.message).includes("doesn't exist")) { /* ignore */ } }
  }
  if (process.env.RUIJIE_GROUP_ID) {
    try {
      await pool.query(`UPDATE vouchers SET group_id = ? WHERE group_id IS NULL OR group_id = ''`, [process.env.RUIJIE_GROUP_ID]);
      await pool.query(`UPDATE vouchers_historical SET group_id = ? WHERE group_id IS NULL OR group_id = ''`, [process.env.RUIJIE_GROUP_ID]);
    } catch (e) { /* tables may not exist yet on a fresh DB */ }
  }

  // Multi-site: tag each portal plan with its site (Ruijie network group) so a
  // site's portal only shows/sells its own plans. Backfill legacy plans to the
  // env group (site1).
  const planSiteMigrations = [
    `ALTER TABLE portal_plan_configs ADD COLUMN group_id VARCHAR(100) NULL AFTER user_group_name`,
    `ALTER TABLE portal_plan_configs ADD INDEX idx_plan_group_id (group_id)`,
  ];
  for (const sql of planSiteMigrations) {
    try { await pool.query(sql); console.log(`Migration OK: ${sql.slice(0, 60)}...`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_DUP_KEYNAME' && !String(e.message).includes("doesn't exist")) { /* ignore */ } }
  }
  if (process.env.RUIJIE_GROUP_ID) {
    try {
      await pool.query(`UPDATE portal_plan_configs SET group_id = ? WHERE group_id IS NULL OR group_id = ''`, [process.env.RUIJIE_GROUP_ID]);
    } catch (e) { /* table may not exist yet on a fresh DB */ }
  }

  // Fix collation on existing tables if they were created with the wrong collation.
  // Must match the vouchers/schema.sql collation (utf8mb4_unicode_ci), otherwise
  // JOINs across the portal tables and vouchers fail with ER_CANT_AGGREGATE_2COLLATIONS.
  const collationFixes = [
    `ALTER TABLE portal_plan_configs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `ALTER TABLE voucher_claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `ALTER TABLE portal_audit_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ];

  for (const sql of collationFixes) {
    try {
      await pool.query(sql);
    } catch (e) {
      // Ignore errors (table might not exist yet on first run, or already correct)
      if (!e.message.includes("doesn't exist")) {
        console.log('Collation fix note:', e.message);
      }
    }
  }

  // ── Sites (network projects) ───────────────────────────────────────────
  // Each site (village) is one Ruijie project (groupId) with its own portal
  // subdomain. Sites are managed from the admin (Network > Add site); this
  // block just keeps site1/site2 consistent across deploys.
  try {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM network_projects');
    if (n === 0) {
      // Fresh install → seed the first site (uso_1) from env.
      await pool.query(
        `INSERT INTO network_projects (name, hostname, ruijie_group_id, ruijie_tenant_id, sort_order)
         VALUES (?, ?, ?, ?, 0)`,
        [
          'uso_1',
          'site1.vodafonefiji.cloud',
          process.env.RUIJIE_GROUP_ID || null,
          process.env.RUIJIE_TENANT_ID || null,
        ]
      );
      console.log('Seeded first network project: uso_1');
    }

    // Rename the legacy single-site default → site-style name + domain.
    await pool.query(
      `UPDATE network_projects
          SET name = 'uso_1', hostname = 'site1.vodafonefiji.cloud'
        WHERE name = 'USO Portal'
           OR hostname IN ('portal.vodafone.com.fj', 'portal.vodafonefiji.cloud')`
    );

    // Backfill: any project missing a Ruijie group ID inherits the env default
    // (the same ID the voucher API uses) so device-health calls aren't sent
    // with a null/empty groupId.
    if (process.env.RUIJIE_GROUP_ID) {
      await pool.query(
        `UPDATE network_projects SET ruijie_group_id = ?
         WHERE ruijie_group_id IS NULL OR ruijie_group_id = ''`,
        [process.env.RUIJIE_GROUP_ID]
      );
    }

    // Ensure the second site (uso_2) exists. Idempotent — keyed on its groupId,
    // so it won't duplicate and can still be edited/removed from the admin.
    const SITE2_GROUP = process.env.SITE2_GROUP_ID || '7847952';
    const SITE2_HOST = process.env.SITE2_HOSTNAME || 'site2.vodafonefiji.cloud';
    const [[{ n2 }]] = await pool.query(
      'SELECT COUNT(*) AS n2 FROM network_projects WHERE ruijie_group_id = ?',
      [SITE2_GROUP]
    );
    if (n2 === 0) {
      await pool.query(
        `INSERT INTO network_projects (name, hostname, ruijie_group_id, ruijie_tenant_id, sort_order)
         VALUES ('uso_2', ?, ?, ?, 1)`,
        [SITE2_HOST, SITE2_GROUP, process.env.RUIJIE_TENANT_ID || null]
      );
      console.log('Seeded second network project: uso_2');
    }
  } catch (e) {
    console.log('Network project seed note:', e.message);
  }

  return pool;
}
