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
      status ENUM('claimed','used','released','expired') NOT NULL DEFAULT 'claimed',
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

  // Seed the first network project (USO Portal) from env if no projects exist yet.
  try {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM network_projects');
    if (n === 0) {
      await pool.query(
        `INSERT INTO network_projects (name, hostname, ruijie_group_id, ruijie_tenant_id, sort_order)
         VALUES (?, ?, ?, ?, 0)`,
        [
          'USO Portal',
          'portal.vodafone.com.fj',
          process.env.RUIJIE_GROUP_ID || null,
          process.env.RUIJIE_TENANT_ID || null,
        ]
      );
      console.log('Seeded default network project: USO Portal');
    }
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
  } catch (e) {
    console.log('Network project seed note:', e.message);
  }

  return pool;
}
