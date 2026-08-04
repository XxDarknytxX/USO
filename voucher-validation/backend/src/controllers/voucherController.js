// src/controllers/voucherController.js
import { validationResult } from "express-validator";
import crypto from "crypto";
import RuijieService from "../services/ruijieService.js";
import { parseVoucherExcelBuffer } from "../services/excelVoucherParser.js";
import { effectiveGroupIds } from "../middleware/auth.js";

const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

// ── Data access helpers ─────────────────────────────────────────

async function logLifecycleEvent(pool, { voucherUuid, eventType, oldStatus, newStatus, notes, details, userId, syncLogId }) {
  await pool.query(
    `INSERT INTO voucher_lifecycle_events (voucher_uuid, event_type, old_status, new_status, notes, details, user_id, sync_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [voucherUuid, eventType, oldStatus || null, newStatus || null, notes || null, details ? JSON.stringify(details) : null, userId || null, syncLogId || null]
  );
}

async function getVoucherByUuid(pool, uuid) {
  const [rows] = await pool.query('SELECT * FROM vouchers WHERE uuid = ?', [uuid]);
  return rows[0] || null;
}

// groupIds: null/undefined = all villages; [] = none; [ids] = restrict to those.
async function getVoucherStats(pool, groupIds) {
  if (Array.isArray(groupIds) && groupIds.length === 0) return [];
  const where = Array.isArray(groupIds) ? `WHERE group_id IN (${groupIds.map(() => '?').join(',')})` : '';
  const params = Array.isArray(groupIds) ? groupIds : [];
  const [rows] = await pool.query(`
    SELECT
      package_name,
      COUNT(*) AS total,
      SUM(CASE WHEN status = '1' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN status = '2' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = '0' THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN status = '3' THEN 1 ELSE 0 END) AS expired,
      AVG(time_period) AS avg_duration_minutes,
      SUM(quota) AS total_quota_mb,
      SUM(used_quota) AS total_used_quota_mb,
      SUM(CASE WHEN used_quota > 0 THEN 1 ELSE 0 END) AS has_usage,
      SUM(CASE WHEN login_time IS NOT NULL THEN 1 ELSE 0 END) AS ever_logged_in,
      SUM(current_clients) AS currently_in_use,
      AVG(download_rate_limit) AS avg_download_limit,
      AVG(upload_rate_limit) AS avg_upload_limit
    FROM vouchers
    ${where}
    GROUP BY package_name
    ORDER BY package_name
  `, params);
  return rows;
}

// Per-site rollup for the all-sites dashboard view. groupIds clamps it (viewer scope).
async function getStatsPerSite(pool, groupIds) {
  if (Array.isArray(groupIds) && groupIds.length === 0) return [];
  const where = Array.isArray(groupIds) ? `WHERE group_id IN (${groupIds.map(() => '?').join(',')})` : '';
  const params = Array.isArray(groupIds) ? groupIds : [];
  const [rows] = await pool.query(`
    SELECT
      group_id,
      COUNT(*) AS total,
      SUM(CASE WHEN status = '1' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN status = '2' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = '3' THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN status = '0' THEN 1 ELSE 0 END) AS inactive,
      SUM(quota) AS total_quota_mb,
      SUM(used_quota) AS total_used_quota_mb,
      SUM(current_clients) AS currently_in_use
    FROM vouchers
    ${where}
    GROUP BY group_id
  `, params);
  return rows;
}

// Per-(site, package) rollup so the global dashboard can scope the package-level
// charts/tables to just the villages enabled in the "All Villages" scope
// (Settings). Small result set: sites × plans. Same status/quota columns as the
// per-package rollup, plus group_id so the frontend can sum in-scope villages.
async function getStatsPerSitePackage(pool, groupIds) {
  if (Array.isArray(groupIds) && groupIds.length === 0) return [];
  const where = Array.isArray(groupIds) ? `WHERE group_id IN (${groupIds.map(() => '?').join(',')})` : '';
  const params = Array.isArray(groupIds) ? groupIds : [];
  const [rows] = await pool.query(`
    SELECT
      group_id,
      package_name,
      COUNT(*) AS total,
      SUM(CASE WHEN status = '1' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN status = '2' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = '0' THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN status = '3' THEN 1 ELSE 0 END) AS expired,
      AVG(time_period) AS avg_duration_minutes,
      SUM(quota) AS total_quota_mb,
      SUM(used_quota) AS total_used_quota_mb,
      SUM(current_clients) AS currently_in_use
    FROM vouchers
    ${where}
    GROUP BY group_id, package_name
  `, params);
  return rows;
}

async function getHistoricalStats(pool) {
  const [rows] = await pool.query(`
    SELECT
      package_name,
      COUNT(*) AS total_historical,
      archived_reason,
      COUNT(*) as count_by_reason
    FROM vouchers_historical
    GROUP BY package_name, archived_reason
    ORDER BY package_name, archived_reason
  `);
  return rows;
}

async function getVoucherList(pool, { page = 1, limit = 10, status, packageName, userGroupId, groupId, groupIds, phone, includeHistorical = false }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where = [];

  if (groupId) { where.push('v.group_id = ?'); params.push(groupId); }
  // groupIds = comma-separated list (dashboard drill-down scoped to the villages
  // in the "All Villages" scope). Ignored if a single groupId is already set.
  else if (groupIds) {
    const ids = String(groupIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) { where.push(`v.group_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  // 'sold' is a virtual filter = anything not still unused (matches the
  // dashboard "Vouchers sold" = total − unused), so that card can drill in.
  if (status === 'sold') { where.push("v.status <> '1'"); }
  else if (status) { where.push('v.status = ?'); params.push(status); }
  if (packageName) { where.push('v.package_name = ?'); params.push(packageName); }
  if (userGroupId) { where.push('v.user_group_id = ?'); params.push(userGroupId); }
  // Search by the M-PAiSA payer phone bound from portal_audit_logs (see phoneJoin).
  if (phone) { where.push('ph.payer_phone LIKE ?'); params.push(`%${phone}%`); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const tableName = includeHistorical ? 'vouchers_combined' : 'vouchers';

  // Latest M-PAiSA payer phone per voucher_code — pre-aggregated to ONE row per
  // voucher (no fan-out). customer_phone + voucher_code sit on the same audit
  // rows from voucher_claimed/auth_success onward. Explicit COLLATE because
  // portal_audit_logs is utf8mb4_unicode_ci and vouchers may differ.
  const phoneJoin = `
    LEFT JOIN (
      SELECT voucher_code COLLATE utf8mb4_unicode_ci AS voucher_code,
             SUBSTRING_INDEX(GROUP_CONCAT(customer_phone ORDER BY event_timestamp DESC SEPARATOR ','), ',', 1) AS payer_phone
      FROM portal_audit_logs
      WHERE voucher_code IS NOT NULL AND customer_phone IS NOT NULL
      GROUP BY voucher_code
    ) ph ON ph.voucher_code = v.voucher_code COLLATE utf8mb4_unicode_ci`;

  // COUNT only needs the phone join when actually filtering by phone.
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${tableName} v ${phone ? phoneJoin : ''} ${whereClause}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT v.*, vc.client_mac AS claimed_mac, ph.payer_phone
     FROM ${tableName} v
     LEFT JOIN voucher_claims vc ON vc.voucher_code = v.voucher_code AND vc.status IN ('claimed', 'used', 'manually_assigned')
     ${phoneJoin}
     ${whereClause}
     ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { vouchers: rows, total: countRow.total, page, limit, totalPages: Math.ceil(countRow.total / limit) };
}

// Archive vouchers that are no longer in the cloud — SCOPED TO ONE SITE so a
// per-site sync never archives another village's vouchers. groupId omitted
// keeps legacy global behavior.
async function archiveVouchersNotInCloud(pool, cloudVoucherUuids, syncId, groupId) {
  const insertCols = `original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
    time_period, used_time, create_time, login_time, expiry_time, max_clients,
    current_clients, quota, used_quota, status, qrcode_url, download_rate_limit,
    upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id, first_name,
    last_name, email, phone, comment, disable_status, raw_data, last_synced,
    archived_reason, sync_log_id`;
  const selectCols = `id, uuid, tenant_id, voucher_code, name_ref, package_name,
    time_period, used_time, create_time, login_time, expiry_time, max_clients,
    current_clients, quota, used_quota, status, qrcode_url, download_rate_limit,
    upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id, first_name,
    last_name, email, phone, comment, disable_status, raw_data, last_synced,
    'removed_from_cloud', ?`;

  const siteFilter = groupId ? 'group_id = ?' : '1=1';
  const siteParam = groupId ? [groupId] : [];

  // Build the "rows to archive" predicate once so the copy and the delete target
  // exactly the same rows.
  let where, whereParams;
  if (cloudVoucherUuids.length === 0) {
    where = siteFilter;
    whereParams = [...siteParam];
  } else {
    const placeholders = cloudVoucherUuids.map(() => '?').join(',');
    where = `${siteFilter} AND uuid NOT IN (${placeholders})`;
    whereParams = [...siteParam, ...cloudVoucherUuids];
  }

  // Archive = copy → delete. Run both in one transaction so a crash between them
  // can't leave a voucher in BOTH tables (which would double-count it in
  // vouchers_historical when the next sync re-archives it).
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO vouchers_historical (${insertCols}) SELECT ${selectCols} FROM vouchers WHERE ${where}`,
      [syncId, ...whereParams]
    );
    const archivedCount = result.affectedRows;
    if (archivedCount > 0) {
      await conn.query(`DELETE FROM vouchers WHERE ${where}`, whereParams);
    }
    await conn.commit();
    return archivedCount;
  } catch (e) {
    try { await conn.rollback(); } catch { /* rollback best-effort */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function upsertVoucher(pool, voucherData) {
  const {
    uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
    create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
    status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
    user_group_id, user_group_name, group_id, first_name, last_name, email, phone, comment,
    disable_status, raw_data,
  } = voucherData;

  const [result] = await pool.query(
    `INSERT INTO vouchers (
      uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
      create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
      status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
      user_group_id, user_group_name, group_id, first_name, last_name, email, phone, comment,
      disable_status, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      tenant_id = VALUES(tenant_id), voucher_code = VALUES(voucher_code), name_ref = VALUES(name_ref),
      package_name = VALUES(package_name), time_period = VALUES(time_period), used_time = VALUES(used_time),
      create_time = VALUES(create_time), login_time = VALUES(login_time), expiry_time = VALUES(expiry_time),
      max_clients = VALUES(max_clients), current_clients = VALUES(current_clients), quota = VALUES(quota),
      used_quota = VALUES(used_quota), status = VALUES(status), qrcode_url = VALUES(qrcode_url),
      download_rate_limit = VALUES(download_rate_limit), upload_rate_limit = VALUES(upload_rate_limit),
      bind_mac = VALUES(bind_mac), user_group_id = VALUES(user_group_id), user_group_name = VALUES(user_group_name),
      group_id = VALUES(group_id),
      first_name = VALUES(first_name), last_name = VALUES(last_name), email = VALUES(email),
      phone = VALUES(phone), comment = VALUES(comment), disable_status = VALUES(disable_status),
      raw_data = VALUES(raw_data), last_synced = CURRENT_TIMESTAMP`,
    [uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
     create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
     status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
     user_group_id, user_group_name, group_id ?? null, first_name, last_name, email, phone, comment,
     disable_status, JSON.stringify(raw_data)]
  );
  return result;
}

async function createSyncLog(pool, userId) {
  const [result] = await pool.query('INSERT INTO voucher_sync_log (user_id) VALUES (?)', [userId]);
  return result.insertId;
}

async function updateSyncLog(pool, syncId, updates) {
  const fields = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  await pool.query(`UPDATE voucher_sync_log SET ${fields} WHERE id = ?`, [...values, syncId]);
}

// Paginated, filterable sync history.
//  - LEFT JOIN (not INNER) so scheduled/automatic syncs — inserted with
//    user_id = NULL by the background scheduler — still appear (an INNER JOIN
//    silently drops every auto-sync row, including failures).
//  - sync_type is DERIVED from user_id (NULL = scheduler = 'auto'; a real user =
//    'manual'), so no schema migration is needed and it classifies existing rows
//    retroactively. The same predicate drives the type filter.
//  - user_email is labelled "System" for automatic runs.
async function getSyncLogsPage(pool, { limit = 20, offset = 0, type = 'all' } = {}) {
  const where =
    type === 'manual' ? 'WHERE vsl.user_id IS NOT NULL' :
    type === 'auto'   ? 'WHERE vsl.user_id IS NULL' : '';
  const [rows] = await pool.query(
    `SELECT vsl.*,
            COALESCE(u.email, 'System') AS user_email,
            CASE WHEN vsl.user_id IS NULL THEN 'auto' ELSE 'manual' END AS sync_type
     FROM voucher_sync_log vsl LEFT JOIN users u ON vsl.user_id = u.id
     ${where}
     ORDER BY vsl.sync_started_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM voucher_sync_log vsl ${where}`
  );
  return { logs: rows, total: Number(countRows[0]?.total || 0) };
}

/**
 * Convert a time value to a Unix-millisecond timestamp (or null).
 * Handles: numbers (already a timestamp), numeric strings, ISO/date strings.
 * Normalises seconds-based timestamps (10-digit) to milliseconds (13-digit).
 */
function toTimestamp(val) {
  if (val == null || val === '' || val === 0) return null;
  // Already a number or numeric string → normalise to ms
  const num = Number(val);
  if (!isNaN(num) && isFinite(num)) {
    // If the value looks like seconds (< 1e12), convert to milliseconds
    return num < 1e12 ? num * 1000 : num;
  }
  // Try parsing as a date string (e.g. "2125-02-17 12:29:56")
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.getTime();
  return null;
}

function transformVoucherData(externalVoucher, groupId = null) {
  return {
    uuid: externalVoucher.uuid,
    tenant_id: externalVoucher.tenantId,
    group_id: groupId,
    voucher_code: externalVoucher.voucherCode ?? externalVoucher.codeNo ?? null,
    name_ref: externalVoucher.nameRef ?? null,
    package_name: externalVoucher.packageName ?? externalVoucher.userGroupName ?? '',
    time_period: Number(externalVoucher.timePeriod ?? 0),
    used_time: Number(externalVoucher.usedTime ?? 0),
    create_time: toTimestamp(externalVoucher.createTime) ?? 0,
    login_time: toTimestamp(externalVoucher.loginTime),
    expiry_time: toTimestamp(externalVoucher.expiryTime),
    max_clients: Number(externalVoucher.maxClients ?? 1),
    current_clients: Number(externalVoucher.currentClients ?? 0),
    quota: Number(externalVoucher.quota ?? 0),
    used_quota: Number(externalVoucher.usedQuota ?? 0),
    status: String(externalVoucher.status ?? '1'),
    qrcode_url: externalVoucher.qrcodeUrl ?? null,
    download_rate_limit: Number(externalVoucher.downloadRateLimit ?? 0),
    upload_rate_limit: Number(externalVoucher.uploadRateLimit ?? 0),
    bind_mac: Number(externalVoucher.bindMac ?? 0),
    user_group_id: externalVoucher.userGroupId ?? null,
    user_group_name: externalVoucher.userGroupName ?? null,
    first_name: externalVoucher.firstName ?? null,
    last_name: externalVoucher.lastName ?? null,
    email: externalVoucher.email ?? null,
    phone: externalVoucher.phone ?? null,
    comment: externalVoucher.comment ?? null,
    disable_status: Number(externalVoucher.disableStatus ?? 0),
    raw_data: externalVoucher,
  };
}

async function getLastSyncTime(pool) {
  const [rows] = await pool.query(
    `SELECT sync_completed_at FROM voucher_sync_log WHERE status = 'completed' ORDER BY sync_completed_at DESC LIMIT 1`
  );
  return rows[0]?.sync_completed_at || null;
}

// Timezone of the Ruijie export's display timestamps (Fiji UTC+12 by default).
// Used to convert the .xlsx date strings to absolute epoch ms deterministically.
const EXPORT_TZ_OFFSET_MIN = Number(process.env.RUIJIE_EXPORT_TZ_OFFSET_MIN ?? 720);

// Did this error come from a Ruijie throttle? If so we stop syncing the rest of
// the sites — retrying/continuing just burns more of an already-exhausted quota.
function _isThrottleError(err) {
  const m = String(err?.message || '').toLowerCase();
  return m.includes('throttl') || m.includes('code=44') || m.includes('code:44') || m.includes('too many');
}

/**
 * Excel-based voucher sync — the replacement for the paginated voucher/getList
 * polling. For each active site it makes ONE export call (all vouchers) + one
 * file download, parses the .xlsx, mirrors the rows into the local DB, and
 * archives any voucher that dropped out of the export. Runs in the BACKGROUND
 * (after the HTTP response is sent) so a slow report generation or many villages
 * can't time the request out; progress + final status land in voucher_sync_log
 * (id = syncId), which the UI polls.
 *
 * The Excel export has NO uuid, so each voucher is resolved to a STABLE uuid:
 * reuse the existing DB row's uuid (matched by voucher_code within the site OR
 * among legacy NULL-group rows, which are then adopted into the site), else
 * synthesize a deterministic `xls-<groupId>-<voucherCode>`. That lets the proven
 * uuid-keyed upsert + archive logic run unchanged.
 *
 * SAFETY: archiving is the destructive step (moves rows to historical + DELETE),
 * so it is heavily guarded. A voucher with no code, an export where <90% of rows
 * carry a code, or two rows resolving to the same uuid are treated as suspicious
 * and never allowed to drive an archive — the failure mode we refuse to allow is
 * a malformed/locale-shifted export wiping a whole site.
 */
async function runExcelSync(pool, ruijieService, syncId) {
  let sites = [];
  try {
    const [rows] = await pool.query(
      `SELECT name, ruijie_group_id AS group_id, ruijie_tenant_id AS tenant_id
       FROM network_projects
       WHERE is_active = 1 AND ruijie_group_id IS NOT NULL AND ruijie_group_id != ''
       ORDER BY sort_order, name`
    );
    sites = rows;
  } catch { /* table may not exist yet */ }
  if (sites.length === 0) {
    sites = [{ name: 'Default', group_id: process.env.RUIJIE_GROUP_ID, tenant_id: process.env.RUIJIE_TENANT_ID }];
  }

  let totalFetched = 0, processedCount = 0, newCount = 0, updatedCount = 0, archivedCount = 0;
  let succeededSites = 0;
  const siteResults = [];
  let throttled = false;

  // Build a (village group_id → (user_group_name → Ruijie user_group_id)) map from
  // the local plan configs. The Excel export carries the group NAME but no id, so
  // this backfills user_group_id on each voucher (needed by the id-keyed available
  // count, purchase→claim, and voucher-filter). portal_plan_configs already stores
  // that mapping (cached when each plan was created), so this is a single LOCAL
  // query — ZERO Ruijie calls (replaces the old per-village usergroup/list call).
  // A group with no configured plan stays unmapped; its vouchers keep an empty
  // user_group_id, which the name-based query fallbacks still cover.
  const ugIdByGroup = new Map(); // groupId(str) → Map(nameLower → user_group_id)
  try {
    const [planGroups] = await pool.query(
      `SELECT group_id, user_group_name, user_group_id
       FROM portal_plan_configs
       WHERE user_group_id IS NOT NULL AND user_group_id <> '' AND user_group_name IS NOT NULL`
    );
    for (const r of planGroups) {
      const g = String(r.group_id);
      const nm = String(r.user_group_name).trim().toLowerCase();
      if (!nm) continue;
      if (!ugIdByGroup.has(g)) ugIdByGroup.set(g, new Map());
      const m = ugIdByGroup.get(g);
      if (!m.has(nm)) m.set(nm, String(r.user_group_id));
    }
  } catch (e) {
    console.warn(`Excel sync: plan-config user-group map failed: ${e.message} — user_group_id left blank (name match still covers it).`);
  }

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const gid = site.group_id;
    if (!gid) continue;

    // If Ruijie is already throttling (circuit open — e.g. tripped by a prior
    // village's export/download), stop now: firing more export calls into an
    // exhausted quota only prolongs the throttle. Mark this site and the rest
    // skipped.
    if (typeof ruijieService.isThrottled === 'function' && ruijieService.isThrottled()) {
      console.warn('Excel sync: Ruijie circuit open — aborting remaining sites this run.');
      for (const s of sites.slice(i)) {
        if (s.group_id) siteResults.push({ site: s.name, groupId: s.group_id, error: 'skipped — Ruijie throttled' });
      }
      break;
    }

    try {
      // 1. ONE export (pageSize=0 = every voucher) + one file download.
      const { buffer } = await ruijieService.exportAndDownloadVoucherExcel({ groupId: gid });
      // 2. Parse the .xlsx. Throws if the voucher-code column is missing (header
      //    rename / locale shift) — caught below, so the site is skipped, NOT wiped.
      const parsed = await parseVoucherExcelBuffer(buffer, {
        tenantId: site.tenant_id,
        tzOffsetMinutes: EXPORT_TZ_OFFSET_MIN,
      });

      // 3. Split rows by whether they carry a usable voucher_code. A blank code
      //    can't be matched to a DB row (all blanks would collapse onto one uuid).
      const total = parsed.length;
      const withCode = parsed.filter((ev) => String(ev.voucherCode ?? '').trim() !== '');
      const blankCodes = total - withCode.length;

      // 4. A genuinely empty export → nothing to upsert, and archiving against an
      //    empty set would wipe the site, so skip entirely (counts as success).
      if (total === 0) {
        siteResults.push({ site: site.name, groupId: gid, fetched: 0, processed: 0, new: 0, updated: 0, archived: 0 });
        succeededSites++;
        continue;
      }

      // 5. SUSPICIOUS-EXPORT GUARD. If >10% of rows lack a code, the export is
      //    malformed (format/locale/sheet problem) — skip the whole site rather
      //    than act on garbage. (A total header mismatch already threw in the
      //    parser; this catches data-cell-level corruption.)
      if (withCode.length === 0 || blankCodes > total * 0.10) {
        const msg = `suspicious export: only ${withCode.length}/${total} rows had a voucher code (${blankCodes} blank) — site skipped`;
        console.warn(`Excel sync: site "${site.name}" (${gid}) ${msg}`);
        siteResults.push({ site: site.name, groupId: gid, fetched: total, error: msg });
        continue;
      }

      // 6. Resolve a stable uuid per voucher. Reuse an existing DB row's uuid —
      //    matched by voucher_code within this site OR among legacy NULL-group
      //    rows (non-null group preferred) — else synthesize one. De-dupe by uuid
      //    so two rows sharing a code can never silently overwrite each other.
      const [existing] = await pool.query(
        'SELECT voucher_code, uuid FROM vouchers WHERE (group_id <=> ?) OR group_id IS NULL ORDER BY (group_id IS NULL)',
        [gid]
      );
      const codeToUuid = new Map();
      for (const r of existing) {
        const k = String(r.voucher_code).trim(); // trim to match the lookup key below
        if (!codeToUuid.has(k)) codeToUuid.set(k, r.uuid); // non-null group rows first
      }

      // Name→id map for this village, from the local plan-config map built above
      // (no Ruijie call). Empty Map when the site has no configured plans.
      const nameToUgId = ugIdByGroup.get(String(gid)) || new Map();

      const usedUuid = new Set();
      const resolved = [];
      let uuidCollisions = 0;
      for (const ev of withCode) {
        const code = String(ev.voucherCode).trim();
        const uuid = (ev.uuid && String(ev.uuid).trim()) || codeToUuid.get(code) || `xls-${gid}-${code}`;
        if (usedUuid.has(uuid)) { uuidCollisions++; continue; } // never overwrite a sibling
        usedUuid.add(uuid);
        // Backfill user_group_id from the village's name→id map when the export
        // didn't carry one (it never does), so downstream id-keyed queries work.
        const userGroupId = (ev.userGroupId && String(ev.userGroupId).trim())
          || nameToUgId.get(String(ev.userGroupName ?? '').trim().toLowerCase())
          || '';
        resolved.push({ ...ev, uuid, userGroupId });
      }

      // 7. Archive rows that dropped out of the export — ONLY when EVERY row had a
      //    code. A blank-code row is a still-present voucher we can't match to its
      //    DB row, so if any exist we can't compute a safe "kept" set — skip the
      //    archive this run (upserts below still apply) rather than risk deleting a
      //    live voucher. When we do archive, cloudUuids is non-empty (guarded by
      //    steps 4-5), so it can never hit the wipe-all branch.
      let arch = 0;
      if (blankCodes === 0) {
        const cloudUuids = resolved.map((v) => v.uuid);
        arch = await archiveVouchersNotInCloud(pool, cloudUuids, syncId, gid);
      } else {
        console.warn(`Excel sync: site "${site.name}" (${gid}) has ${blankCodes}/${total} blank-code rows — skipping archive this run (upserts still applied).`);
      }

      // 8. Upsert each voucher with its resolved uuid.
      let proc = 0, nw = 0, upd = 0;
      for (const ev of resolved) {
        try {
          const result = await upsertVoucher(pool, transformVoucherData(ev, gid));
          proc++;
          if (result.affectedRows === 1) nw++;
          else if (result.affectedRows === 2) upd++;
        } catch (error) { console.error('Error processing voucher:', error); }
      }

      totalFetched += total;
      processedCount += proc; newCount += nw; updatedCount += upd; archivedCount += arch;
      succeededSites++;
      const r = { site: site.name, groupId: gid, fetched: total, processed: proc, new: nw, updated: upd, archived: arch };
      if (blankCodes || uuidCollisions) r.skipped = { blankCodes, uuidCollisions, archiveSkipped: blankCodes > 0 };
      siteResults.push(r);
    } catch (e) {
      console.error(`Excel sync failed for site "${site.name}" (${gid}):`, e.message);
      siteResults.push({ site: site.name, groupId: gid, error: e.message });
      if (_isThrottleError(e)) throttled = true; // stop hammering an exhausted quota
    }

    // Progress: update running counters after each site so a mid-sync poll moves.
    try {
      await updateSyncLog(pool, syncId, {
        total_fetched: totalFetched, total_processed: processedCount,
        total_new: newCount, total_updated: updatedCount, total_archived: archivedCount,
      });
    } catch { /* non-fatal progress update */ }

    if (throttled) {
      console.warn('Excel sync: Ruijie throttle detected — aborting remaining sites this run.');
      for (const s of sites.slice(i + 1)) {
        if (s.group_id) siteResults.push({ site: s.name, groupId: s.group_id, error: 'skipped — Ruijie throttled' });
      }
      break;
    }
  }

  // Finalize honestly: 'failed' if nothing synced and there were errors; else
  // 'completed', but surface any per-site errors in error_message so a partial
  // (or all-throttled) run isn't reported as a clean success.
  const errored = siteResults.filter((s) => s.error);
  const status = succeededSites === 0 && errored.length > 0 ? 'failed' : 'completed';
  const error_message = errored.length
    ? errored.map((s) => `${s.site}: ${s.error}`).join(' | ').slice(0, 1000)
    : null;

  await updateSyncLog(pool, syncId, {
    sync_completed_at: new Date(), total_fetched: totalFetched,
    total_processed: processedCount, total_new: newCount, total_updated: updatedCount,
    total_archived: archivedCount, status, error_message,
  });
  return { siteResults, totalFetched, processedCount, newCount, updatedCount, archivedCount, status };
}

// ── Factory ─────────────────────────────────────────────────────

export function makeVoucherController(pool) {
  const ruijieService = new RuijieService();

  // Scheduler ref, wired by server.js. Lets updateSetting re-arm the timer the
  // moment a sync setting changes (no service restart needed).
  let syncScheduler = null;

  // Shared, single-flight sync starter used by BOTH the manual POST /sync and the
  // background scheduler. Acquires the advisory lock, creates the sync-log row, and
  // kicks runExcelSync off in the background. Returns a status object (never touches
  // res) so either caller can adapt it. userId is null for scheduled (system) runs.
  async function runGuardedSync(userId = null) {
    let lockConn = null;
    try {
      lockConn = await pool.getConnection();
      const [rows] = await lockConn.query("SELECT GET_LOCK('uso_voucher_sync', 0) AS got");
      if (Number(rows?.[0]?.got) !== 1) {
        lockConn.release();
        lockConn = null;
        let running = [];
        try {
          [running] = await pool.query(
            `SELECT id FROM voucher_sync_log WHERE status = 'running' ORDER BY id DESC LIMIT 1`
          );
        } catch { /* best-effort */ }
        return { status: 'already-running', syncId: running[0]?.id ?? null };
      }
    } catch (e) {
      // Lock infra threw (conn failure / query timeout). FAIL CLOSED: skip this run
      // rather than proceed unlocked — an unguarded run could double-fire the Ruijie
      // Excel export against the account-wide code:44 quota (the outage this whole
      // system exists to prevent). A skipped sync is retriable: the scheduler re-arms
      // next interval; a manual caller sees an error and can retry.
      if (lockConn) { try { lockConn.release(); } catch { /* ignore */ } }
      lockConn = null;
      console.error('Sync lock acquire failed (skipping run to protect Ruijie quota):', e.message);
      return { status: 'error', error: `lock-unavailable: ${e.message}` };
    }

    const releaseLock = async () => {
      if (!lockConn) return;
      try { await lockConn.query("SELECT RELEASE_LOCK('uso_voucher_sync')"); } catch { /* ignore */ }
      try { lockConn.release(); } catch { /* ignore */ }
      lockConn = null;
    };

    let syncId;
    try {
      syncId = await createSyncLog(pool, userId);
    } catch (e) {
      console.error('Failed to create sync log:', e);
      await releaseLock();
      return { status: 'error', error: e.message };
    }

    // Kick off in the background; the row is already 'running' (schema default).
    runExcelSync(pool, ruijieService, syncId)
      .catch(async (error) => {
        console.error('Excel sync crashed:', error);
        try {
          await updateSyncLog(pool, syncId, {
            sync_completed_at: new Date(), status: 'failed', error_message: error.message,
          });
        } catch (e2) { console.error('Failed to mark sync failed:', e2); }
      })
      .finally(releaseLock);

    return { status: 'started', syncId };
  }

  return {
    getStats: async (req, res) => {
      try {
        const scope = req.scope || { isViewer: false };
        const singleGroup = req.query.groupId || null;
        // Effective group filter: admin -> requested (null = all); viewer -> their
        // assigned set, or the requested group intersected with it. A viewer who
        // resolves to no villages gets [] -> an EMPTY payload, never the unscoped all.
        // Requested = a single village (groupId) OR the visible subset of the "All
        // Villages" display filter (groupIds).
        const requested = req.query.groupIds || req.query.groupId || null;
        const gids = effectiveGroupIds(scope, requested);
        const stats = await getVoucherStats(pool, gids);
        // vouchers_historical has no group_id, so it can't be village-scoped —
        // viewers get none; admins keep the global archived rollup.
        const historicalStats = scope.isViewer ? [] : await getHistoricalStats(pool);
        const totalVouchers = stats.reduce((sum, item) => sum + Number(item.total || 0), 0);
        const totalHistorical = historicalStats.reduce((sum, item) => sum + Number(item.total_historical || 0), 0);
        // Per-site + per-(site,package) rollups only when NOT drilled into a single
        // village — scoped by gids so the all-villages view sums only allowed villages.
        const perSite = singleGroup ? undefined : await getStatsPerSite(pool, gids);
        const packageSiteStats = singleGroup ? undefined : await getStatsPerSitePackage(pool, gids);
        return send.ok(res, { packageStats: stats, packageSiteStats, historicalStats, perSite, totalVouchers, totalHistorical, lastSync: await getLastSyncTime(pool) });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getVouchers: async (req, res) => {
      try {
        const { page, limit, status, packageName, userGroupId, includeHistorical, groupId, groupIds, phone } = req.query;
        const scope = req.scope || { isViewer: false };
        const pg = parseInt(page) || 1;
        const lim = parseInt(limit) || 10;

        let effGroupId = groupId;
        let effGroupIds = groupIds;
        let effIncludeHistorical = includeHistorical === 'true';
        if (scope.isViewer) {
          // Clamp to the viewer's villages regardless of what was requested. An empty
          // set means no access -> return empty (NOT the unscoped list). Force the
          // IN(...) path and never include historical (it has no group_id to scope).
          const eff = effectiveGroupIds(scope, groupIds || groupId || null);
          if (!eff.length) {
            return send.ok(res, { vouchers: [], total: 0, page: pg, limit: lim, totalPages: 0 });
          }
          effGroupId = null;
          effGroupIds = eff.join(',');
          effIncludeHistorical = false;
        }

        const result = await getVoucherList(pool, {
          page: pg, limit: lim,
          status, packageName, userGroupId, groupId: effGroupId, groupIds: effGroupIds, phone,
          includeHistorical: effIncludeHistorical,
        });
        return send.ok(res, result);
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getHistoricalVouchers: async (req, res) => {
      try {
        const { page, limit, packageName, archivedReason } = req.query;
        const offset = ((parseInt(page) || 1) - 1) * (parseInt(limit) || 10);
        const params = [];
        const where = [];
        if (packageName) { where.push('package_name = ?'); params.push(packageName); }
        if (archivedReason) { where.push('archived_reason = ?'); params.push(archivedReason); }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM vouchers_historical ${whereClause}`, params);
        const [rows] = await pool.query(
          `SELECT * FROM vouchers_historical ${whereClause} ORDER BY archived_at DESC LIMIT ? OFFSET ?`,
          [...params, parseInt(limit) || 10, offset]
        );
        return send.ok(res, { vouchers: rows, total: countRow.total, page: parseInt(page) || 1, limit: parseInt(limit) || 10, totalPages: Math.ceil(countRow.total / (parseInt(limit) || 10)) });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    searchVouchers: async (req, res) => {
      try {
        const { q, page, limit } = req.query;
        if (!q || q.trim().length < 2) return send.bad(res, 'Search query must be at least 2 characters');
        const pg = parseInt(page) || 1;
        const lim = parseInt(limit) || 20;
        const offset = (pg - 1) * lim;

        // Scope: single village (groupId) or the visible subset (groupIds), clamped
        // to the viewer's villages. null = all (admin); [] = none → empty result.
        const scope = req.scope || { isViewer: false };
        const gids = effectiveGroupIds(scope, req.query.groupIds || req.query.groupId || null);
        if (Array.isArray(gids) && gids.length === 0) {
          return send.ok(res, { vouchers: [], total: 0, page: pg, limit: lim, totalPages: 0 });
        }

        const like = `%${q.trim()}%`;
        // Parenthesized so the optional site filter ANDs correctly with the OR group.
        const searchFields = '(voucher_code LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR comment LIKE ? OR name_ref LIKE ? OR package_name LIKE ?)';
        const searchParams = Array(8).fill(like);
        const siteClause = Array.isArray(gids) ? ` AND group_id IN (${gids.map(() => '?').join(',')})` : '';
        const where = `${searchFields}${siteClause}`;
        const whereParams = Array.isArray(gids) ? [...searchParams, ...gids] : searchParams;

        const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM vouchers WHERE ${where}`, whereParams);
        const [rows] = await pool.query(
          `SELECT * FROM vouchers WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...whereParams, lim, offset]
        );
        return send.ok(res, { vouchers: rows, total: countRow.total, page: pg, limit: lim, totalPages: Math.ceil(countRow.total / lim) });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getActivityLog: async (req, res) => {
      try {
        const { page, limit, voucherUuid, eventType, startDate, endDate } = req.query;
        const pg = parseInt(page) || 1;
        const lim = parseInt(limit) || 20;
        const offset = (pg - 1) * lim;
        const params = [];
        const where = [];

        if (voucherUuid) { where.push('vle.voucher_uuid = ?'); params.push(voucherUuid); }
        if (eventType) { where.push('vle.event_type = ?'); params.push(eventType); }
        if (startDate) { where.push('vle.event_timestamp >= ?'); params.push(startDate); }
        if (endDate) { where.push('vle.event_timestamp <= ?'); params.push(endDate); }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM voucher_lifecycle_events vle ${whereClause}`, params);
        const [rows] = await pool.query(
          `SELECT vle.*, u.email AS user_email, v.voucher_code
           FROM voucher_lifecycle_events vle
           LEFT JOIN users u ON vle.user_id = u.id
           LEFT JOIN vouchers v ON vle.voucher_uuid = v.uuid
           ${whereClause}
           ORDER BY vle.event_timestamp DESC LIMIT ? OFFSET ?`,
          [...params, lim, offset]
        );
        return send.ok(res, { events: rows, total: countRow.total, page: pg, limit: lim, totalPages: Math.ceil(countRow.total / lim) });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getVoucherDetail: async (req, res) => {
      try {
        const { uuid } = req.params;
        let voucher = await getVoucherByUuid(pool, uuid);
        let source = 'active';

        if (!voucher) {
          const [histRows] = await pool.query('SELECT * FROM vouchers_historical WHERE uuid = ?', [uuid]);
          voucher = histRows[0] || null;
          source = 'historical';
        }
        if (!voucher) return send.notFound(res, 'Voucher not found');

        const [events] = await pool.query(
          `SELECT vle.*, u.email AS user_email FROM voucher_lifecycle_events vle LEFT JOIN users u ON vle.user_id = u.id WHERE vle.voucher_uuid = ? ORDER BY vle.event_timestamp DESC LIMIT 50`,
          [uuid]
        );

        return send.ok(res, { voucher, source, lifecycleEvents: events });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getUserGroups: async (req, res) => {
      try {
        const groupId = req.query.groupId || null;
        // Primary source: distinct user groups already synced into local DB (per-site if given)
        const dbWhere = groupId
          ? "user_group_id IS NOT NULL AND user_group_id != '' AND group_id = ?"
          : "user_group_id IS NOT NULL AND user_group_id != ''";
        const [dbGroups] = await pool.query(`
          SELECT DISTINCT user_group_id, user_group_name,
            AVG(time_period) AS avg_time_period,
            COUNT(*) AS voucher_count
          FROM vouchers
          WHERE ${dbWhere}
          GROUP BY user_group_id, user_group_name
          ORDER BY user_group_name
        `, groupId ? [groupId] : []);

        // Also try Ruijie API for richer data (e.g. authprofileid / profile UUID)
        let cloudGroups = [];
        let cloudSync = false;
        try {
          const result = await ruijieService.getUserGroups({ groupId });
          cloudGroups = result.data || [];
          cloudSync = result.cloudSync ?? false;
        } catch (_) { /* cloud unavailable, use DB only */ }

        // Merge: if cloud returned data, enrich DB groups with authProfileId
        const merged = dbGroups.map(dbg => {
          const match = cloudGroups.find(
            cg => String(cg.id) === String(dbg.user_group_id)
          );
          return {
            id: dbg.user_group_id,
            userGroupId: dbg.user_group_id,
            name: dbg.user_group_name,
            userGroupName: dbg.user_group_name,
            avgTimePeriod: dbg.avg_time_period,
            voucherCount: dbg.voucher_count,
            authProfileId: match?.authProfileId || null,
            timePeriod: match?.timePeriod || null,
            quota: match?.quota || null,
            downloadRateLimit: match?.downloadRateLimit || null,
            uploadRateLimit: match?.uploadRateLimit || null,
            noOfDevice: match?.noOfDevice || null,
          };
        });

        // If cloud returned groups not in DB, append them too
        for (const cg of cloudGroups) {
          const cgId = String(cg.id);
          if (!merged.find(m => String(m.id) === cgId)) {
            merged.push({
              id: cgId,
              userGroupId: cgId,
              name: cg.name || cg.userGroupName || `Group ${cgId}`,
              userGroupName: cg.name || cg.userGroupName || `Group ${cgId}`,
              avgTimePeriod: cg.timePeriod || null,
              voucherCount: 0,
              authProfileId: cg.authProfileId || null,
              timePeriod: cg.timePeriod || null,
              quota: cg.quota || null,
              downloadRateLimit: cg.downloadRateLimit || null,
              uploadRateLimit: cg.uploadRateLimit || null,
              noOfDevice: cg.noOfDevice || null,
            });
          }
        }

        return send.ok(res, { userGroups: merged, cloudSync });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    createVoucher: async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return send.bad(res, errors.array().map(e => e.msg).join(', '));

        const body = req.body;
        // Fallback: if no profile UUID provided, use user_group_id
        const profile = body.profile || body.user_group_id;
        // The site (Ruijie groupId) these vouchers belong to. Defaults to env group.
        const groupId = body.groupId || body.group_id || null;

        // Ruijie API 2.3.1: requires quantity, profile (UUID), userGroupId
        // Optionally 2.3.2: custom code via customerCreate endpoint
        let cloudResult;
        if (body.custom_code) {
          cloudResult = await ruijieService.createCustomVoucher(body.custom_code, {
            profile,
            userGroupId: body.user_group_id,
            groupId,
          });
        } else {
          cloudResult = await ruijieService.createVoucher({
            quantity: body.quantity || 1,
            profile,
            userGroupId: body.user_group_id,
            firstName: body.first_name,
            lastName: body.last_name,
            email: body.email,
            phone: body.phone,
            comment: body.comment,
            groupId,
          });
        }

        // Collect UUIDs from the create response so we know which vouchers were made
        const createdUuids = [];
        const cloudList = cloudResult?.data?.voucherData?.list ?? cloudResult?.data?.list ?? [];

        if (cloudList.length > 0) {
          for (const cv of cloudList) {
            // Do a lightweight insert with the sparse data we got from the create response
            const voucherData = transformVoucherData(cv, groupId);
            await upsertVoucher(pool, voucherData);
            await logLifecycleEvent(pool, { voucherUuid: voucherData.uuid, eventType: 'created', newStatus: voucherData.status, notes: 'Created via cloud API', userId: req.user.id });
            createdUuids.push(voucherData.uuid);
          }

          // ── Immediately re-sync from cloud to populate full info ──
          // The create API only returns sparse data (uuid, codeNo, status, expiryTime, limitClients).
          // The getList API returns the full record (package_name, time_period, quota, rate limits, etc.).
          // We fetch all vouchers and update the ones we just created.
          try {
            // Small delay to let the cloud settle the new records
            await new Promise(r => setTimeout(r, 500));
            const allCloudVouchers = await ruijieService.getAllVouchers({ groupId });
            const createdSet = new Set(createdUuids);
            let enrichedCount = 0;
            for (const externalVoucher of allCloudVouchers) {
              if (createdSet.has(externalVoucher.uuid)) {
                const fullData = transformVoucherData(externalVoucher, groupId);
                await upsertVoucher(pool, fullData);
                enrichedCount++;
              }
            }
            console.log(`Post-create sync: enriched ${enrichedCount}/${createdUuids.length} vouchers with full data`);
          } catch (syncErr) {
            // Non-fatal — the voucher was created, just missing full info until next manual sync
            console.warn('Post-create sync failed (non-fatal):', syncErr.message);
          }
        } else {
          // Cloud API unavailable or returned no list — create locally
          const qty = body.quantity || 1;
          for (let i = 0; i < qty; i++) {
            const uuid = crypto.randomUUID();
            const voucherData = {
              uuid,
              tenant_id: process.env.RUIJIE_TENANT_ID || '',
              voucher_code: body.custom_code || `V-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              name_ref: null,
              package_name: body.package_name || body.user_group_name || '',
              time_period: 0,
              used_time: 0,
              create_time: Date.now(),
              login_time: null,
              expiry_time: null,
              max_clients: 1,
              current_clients: 0,
              quota: 0,
              used_quota: 0,
              status: '1',
              qrcode_url: null,
              download_rate_limit: 0,
              upload_rate_limit: 0,
              bind_mac: 0,
              user_group_id: body.user_group_id || null,
              user_group_name: body.user_group_name || null,
              group_id: groupId,
              first_name: body.first_name || null,
              last_name: body.last_name || null,
              email: body.email || null,
              phone: body.phone || null,
              comment: body.comment || null,
              disable_status: 0,
              raw_data: { locallyCreated: true, cloudSync: false },
            };
            await upsertVoucher(pool, voucherData);
            await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'created', newStatus: '1', notes: 'Created locally (cloud API unavailable)', userId: req.user.id });
            createdUuids.push(uuid);
          }
        }

        // Re-fetch the final state of created vouchers from local DB to return full info
        const createdVouchers = [];
        for (const uid of createdUuids) {
          const v = await getVoucherByUuid(pool, uid);
          if (v) createdVouchers.push(v);
        }

        return send.created(res, { success: true, vouchers: createdVouchers, count: createdVouchers.length, cloudSync: cloudResult.cloudSync });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    updateVoucher: async (req, res) => {
      try {
        const { uuid } = req.params;
        const existing = await getVoucherByUuid(pool, uuid);
        if (!existing) return send.notFound(res, 'Voucher not found');

        const body = req.body;
        const updatableFields = ['name_ref', 'package_name', 'time_period', 'max_clients', 'quota',
          'download_rate_limit', 'upload_rate_limit', 'bind_mac', 'user_group_id', 'user_group_name',
          'first_name', 'last_name', 'email', 'phone', 'comment'];

        const changes = {};
        const setClauses = [];
        const setValues = [];

        for (const field of updatableFields) {
          if (body[field] !== undefined && String(body[field]) !== String(existing[field])) {
            changes[field] = { old: existing[field], new: body[field] };
            setClauses.push(`${field} = ?`);
            setValues.push(body[field]);
          }
        }

        if (setClauses.length === 0) return send.ok(res, { success: true, message: 'No changes detected' });

        const cloudResult = await ruijieService.updateVoucher(uuid, { ...body, groupId: existing.group_id });

        setClauses.push('last_synced = CURRENT_TIMESTAMP');
        await pool.query(`UPDATE vouchers SET ${setClauses.join(', ')} WHERE uuid = ?`, [...setValues, uuid]);

        await logLifecycleEvent(pool, {
          voucherUuid: uuid, eventType: 'updated',
          oldStatus: existing.status, newStatus: existing.status,
          notes: `Updated ${Object.keys(changes).length} field(s)`,
          details: { changes, cloudSync: cloudResult.cloudSync },
          userId: req.user.id,
        });

        const updated = await getVoucherByUuid(pool, uuid);
        return send.ok(res, { success: true, voucher: updated, cloudSync: cloudResult.cloudSync });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    deleteVoucher: async (req, res) => {
      try {
        const { uuid } = req.params;
        const existing = await getVoucherByUuid(pool, uuid);
        if (!existing) return send.notFound(res, 'Voucher not found');

        const cloudResult = await ruijieService.deleteVouchers([uuid], existing.group_id);

        await pool.query(
          `INSERT INTO vouchers_historical (original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
            time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
            status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id,
            first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, archived_reason)
           SELECT id, uuid, tenant_id, voucher_code, name_ref, package_name,
            time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
            status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id,
            first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, 'manually_deleted'
           FROM vouchers WHERE uuid = ?`,
          [uuid]
        );
        await pool.query('DELETE FROM vouchers WHERE uuid = ?', [uuid]);
        await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'deleted', oldStatus: existing.status, notes: 'Manually deleted', userId: req.user.id });

        return send.ok(res, { success: true, cloudSync: cloudResult.cloudSync });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    toggleVoucherStatus: async (req, res) => {
      try {
        const { uuid } = req.params;
        const existing = await getVoucherByUuid(pool, uuid);
        if (!existing) return send.notFound(res, 'Voucher not found');

        const isDisabled = existing.disable_status === 1;
        let cloudResult;

        if (isDisabled) {
          cloudResult = await ruijieService.enableVoucher(uuid, existing.group_id);
          await pool.query('UPDATE vouchers SET disable_status = 0, last_synced = CURRENT_TIMESTAMP WHERE uuid = ?', [uuid]);
          await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'enabled', oldStatus: existing.status, notes: 'Voucher enabled', userId: req.user.id });
        } else {
          cloudResult = await ruijieService.disableVoucher(uuid, existing.group_id);
          await pool.query('UPDATE vouchers SET disable_status = 1, last_synced = CURRENT_TIMESTAMP WHERE uuid = ?', [uuid]);
          await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'disabled', oldStatus: existing.status, notes: 'Voucher disabled', userId: req.user.id });
        }

        const updated = await getVoucherByUuid(pool, uuid);
        return send.ok(res, { success: true, voucher: updated, cloudSync: cloudResult.cloudSync });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    bulkOperation: async (req, res) => {
      try {
        const { action, uuids } = req.body;
        if (!action || !Array.isArray(uuids) || uuids.length === 0) return send.bad(res, 'action and uuids[] required');

        const results = { processed: 0, failed: 0, errors: [] };

        for (const uuid of uuids) {
          try {
            const voucher = await getVoucherByUuid(pool, uuid);
            if (!voucher) { results.failed++; results.errors.push(`${uuid}: not found`); continue; }

            if (action === 'delete') {
              await ruijieService.deleteVouchers([uuid], voucher.group_id);
              await pool.query(
                `INSERT INTO vouchers_historical (original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
                  time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
                  status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id,
                  first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, archived_reason)
                 SELECT id, uuid, tenant_id, voucher_code, name_ref, package_name,
                  time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
                  status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name, group_id,
                  first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, 'bulk_deleted'
                 FROM vouchers WHERE uuid = ?`, [uuid]
              );
              await pool.query('DELETE FROM vouchers WHERE uuid = ?', [uuid]);
            } else if (action === 'disable') {
              await ruijieService.disableVoucher(uuid, voucher.group_id);
              await pool.query('UPDATE vouchers SET disable_status = 1 WHERE uuid = ?', [uuid]);
            } else if (action === 'enable') {
              await ruijieService.enableVoucher(uuid, voucher.group_id);
              await pool.query('UPDATE vouchers SET disable_status = 0 WHERE uuid = ?', [uuid]);
            }

            await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'bulk_operation', notes: `Bulk ${action}`, userId: req.user.id });
            results.processed++;
          } catch (err) {
            results.failed++;
            results.errors.push(`${uuid}: ${err.message}`);
          }
        }

        return send.ok(res, { success: true, action, ...results });
      } catch (e) { console.error(e); return send.serverErr(res, e.message); }
    },

    // Excel-based sync of EVERY active site (one Ruijie groupId per village).
    // Delegates to the shared single-flight runGuardedSync (same advisory lock the
    // background scheduler uses, so a manual sync and a scheduled tick can never
    // double-run), responds IMMEDIATELY with the sync-log id, and the work runs in
    // the background. The UI polls voucher_sync_log for progress + final status.
    syncVouchers: async (req, res) => {
      const r = await runGuardedSync(req.user?.id ?? null);
      if (r.status === 'already-running') {
        return res.json({ success: true, syncId: r.syncId, status: 'running', message: 'A sync is already in progress' });
      }
      if (r.status === 'error') {
        return send.serverErr(res, 'Could not start sync');
      }
      return res.json({ success: true, syncId: r.syncId, status: 'running', message: 'Sync started' });
    },

    restoreVoucher: async (req, res) => {
      try {
        const { uuid } = req.params;
        const [historicalRows] = await pool.query('SELECT * FROM vouchers_historical WHERE uuid = ?', [uuid]);
        if (historicalRows.length === 0) return send.bad(res, 'Historical voucher not found');
        const historical = historicalRows[0];
        const [activeRows] = await pool.query('SELECT id FROM vouchers WHERE uuid = ?', [uuid]);
        if (activeRows.length > 0) return send.bad(res, 'Voucher already exists in active table');

        const voucherData = {
          uuid: historical.uuid, tenant_id: historical.tenant_id, voucher_code: historical.voucher_code,
          name_ref: historical.name_ref, package_name: historical.package_name, time_period: historical.time_period,
          used_time: historical.used_time, create_time: historical.create_time, login_time: historical.login_time,
          expiry_time: historical.expiry_time, max_clients: historical.max_clients, current_clients: historical.current_clients,
          quota: historical.quota, used_quota: historical.used_quota, status: historical.status,
          qrcode_url: historical.qrcode_url, download_rate_limit: historical.download_rate_limit,
          upload_rate_limit: historical.upload_rate_limit, bind_mac: historical.bind_mac,
          user_group_id: historical.user_group_id, user_group_name: historical.user_group_name,
          first_name: historical.first_name, last_name: historical.last_name, email: historical.email,
          phone: historical.phone, comment: historical.comment, disable_status: historical.disable_status,
          raw_data: historical.raw_data,
        };
        await upsertVoucher(pool, voucherData);
        await pool.query('DELETE FROM vouchers_historical WHERE uuid = ?', [uuid]);
        await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'restored', newStatus: historical.status, notes: 'Restored from historical', userId: req.user.id });

        return send.ok(res, { success: true, message: 'Voucher restored successfully' });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    testConnection: async (_req, res) => {
      try {
        const envCheck = { baseUrl: !!process.env.RUIJIE_API_BASE_URL, appId: !!process.env.RUIJIE_APP_ID, appSecret: !!process.env.RUIJIE_APP_SECRET, groupId: !!process.env.RUIJIE_GROUP_ID, tenantId: !!process.env.RUIJIE_TENANT_ID };
        const token = await ruijieService.getAccessToken();
        const result = await ruijieService.getVouchers(0, 1);
        return send.ok(res, {
          success: true, message: 'Connection successful', token: token ? 'Valid' : 'Invalid', environment: envCheck, voucherCount: result.total || 0,
          sampleVoucher: result.vouchers?.[0] ? { uuid: result.vouchers[0].uuid, voucherCode: result.vouchers[0].voucherCode ?? result.vouchers[0].codeNo, packageName: result.vouchers[0].packageName ?? result.vouchers[0].userGroupName, status: result.vouchers[0].status } : null,
        });
      } catch (error) {
        console.error('=== Connection Test Failed ===', error);
        return send.ok(res, { success: false, error: error.message, environment: { baseUrl: !!process.env.RUIJIE_API_BASE_URL, appId: !!process.env.RUIJIE_APP_ID, appSecret: !!process.env.RUIJIE_APP_SECRET, groupId: !!process.env.RUIJIE_GROUP_ID, tenantId: !!process.env.RUIJIE_TENANT_ID } });
      }
    },

    getSyncLogs: async (req, res) => {
      try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;
        const type = ['manual', 'auto'].includes(req.query.type) ? req.query.type : 'all';
        const { logs, total } = await getSyncLogsPage(pool, { limit, offset, type });
        return send.ok(res, { logs, total, page, limit });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getSettings: async (_req, res) => {
      try {
        const [rows] = await pool.query('SELECT * FROM app_settings ORDER BY setting_key');
        return send.ok(res, { settings: rows });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    updateSetting: async (req, res) => {
      try {
        // key/value/type arrive in the BODY (matches the PUT /api/settings route +
        // frontend settingsApi.update). setting_type is persisted so the value can
        // be parsed back correctly. Values are stored as strings.
        const { key, value, type } = req.body;
        if (!key) return send.bad(res, 'Setting key is required');
        const settingType = ['string', 'number', 'boolean', 'json'].includes(type) ? type : 'string';
        const strValue = value === null || value === undefined ? null : String(value);
        await pool.query(
          `INSERT INTO app_settings (setting_key, setting_value, setting_type, updated_by) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), setting_type = VALUES(setting_type), updated_by = VALUES(updated_by)`,
          [key, strValue, settingType, req.user?.id ?? null]
        );
        // Apply sync-schedule changes immediately (no restart required).
        if (key === 'sync_enabled' || key === 'sync_interval_minutes') {
          try { await syncScheduler?.reload(); } catch (e) { console.error('Scheduler reload failed:', e.message); }
        }
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/settings/smtp — SMTP config for the (future) email sender. The
    // password is NEVER returned to the client — only whether one is set.
    getSmtpSettings: async (_req, res) => {
      try {
        const [rows] = await pool.query('SELECT * FROM smtp_settings WHERE id = 1');
        const r = rows[0] || {};
        return send.ok(res, {
          smtp: {
            enabled: !!r.enabled,
            host: r.host || '',
            port: r.port ?? null,
            encryption: r.encryption || 'starttls', // 'starttls' | 'ssl' | 'none'
            username: r.username || '',
            fromName: r.from_name || '',
            fromEmail: r.from_email || '',
            hasPassword: !!r.password,
            updatedAt: r.updated_at || null,
          },
        });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // PUT /api/settings/smtp — upsert the single config row. A blank/omitted
    // password keeps the stored one (so admins never have to retype it). The
    // password is persisted server-side only.
    updateSmtpSettings: async (req, res) => {
      try {
        const b = req.body || {};
        const enabled = b.enabled ? 1 : 0;
        const host = b.host ? String(b.host).trim() : null;
        const port = (b.port === '' || b.port == null) ? null : parseInt(b.port, 10);
        if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
          return send.bad(res, 'Port must be between 1 and 65535');
        }
        const ALLOWED_ENC = ['starttls', 'ssl', 'none'];
        const encryption = ALLOWED_ENC.includes(String(b.encryption)) ? String(b.encryption) : 'starttls';
        const secure = encryption === 'ssl' ? 1 : 0; // implicit TLS (465) vs STARTTLS (587) / none
        const username = b.username ? String(b.username).trim() : null;
        const fromName = b.fromName ? String(b.fromName).trim() : null;
        const fromEmail = b.fromEmail ? String(b.fromEmail).trim() : null;
        if (fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) {
          return send.bad(res, 'From email is not a valid address');
        }
        // Keep the existing password when none is supplied in the request.
        const supplied = (b.password != null && String(b.password) !== '') ? String(b.password) : null;
        const [existing] = await pool.query('SELECT password FROM smtp_settings WHERE id = 1');
        const password = supplied != null ? supplied : (existing[0]?.password ?? null);

        await pool.query(
          `INSERT INTO smtp_settings (id, enabled, host, port, secure, encryption, username, password, from_name, from_email, updated_by)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             enabled = VALUES(enabled), host = VALUES(host), port = VALUES(port), secure = VALUES(secure),
             encryption = VALUES(encryption),
             username = VALUES(username), password = VALUES(password), from_name = VALUES(from_name),
             from_email = VALUES(from_email), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
          [enabled, host, port, secure, encryption, username, password, fromName, fromEmail, req.user?.id ?? null]
        );
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // Automatic-sync scheduler status for the Settings UI (current enabled/interval
    // + the most recent sync-log row for a "last synced" line).
    getSyncStatus: async (_req, res) => {
      try {
        const s = (typeof syncScheduler?.status === 'function') ? syncScheduler.status() : null;
        const [rows] = await pool.query(
          `SELECT id, status, sync_started_at, sync_completed_at, total_processed, total_archived, error_message
           FROM voucher_sync_log ORDER BY id DESC LIMIT 1`
        );
        return send.ok(res, {
          enabled: s ? s.enabled : null,
          intervalMinutes: s ? s.intervalMinutes : null,
          nextRunAt: s ? s.nextRunAt : null,
          lastSync: rows[0] || null,
        });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // Atomic update of the sync schedule: BOTH keys in ONE transaction + a SINGLE
    // scheduler reload afterward. This prevents the scheduler from ever observing a
    // half-updated pair (e.g. enabled=true armed against the OLD, more-aggressive
    // interval) that a two-call sequence could leave behind. Backs PUT /api/settings/sync.
    updateSyncSettings: async (req, res) => {
      const { enabled, intervalMinutes } = req.body || {};
      if (typeof enabled !== 'boolean') return send.bad(res, 'enabled (boolean) is required');
      const mins = Number(intervalMinutes);
      if (!Number.isFinite(mins)) return send.bad(res, 'intervalMinutes (number) is required');
      // Server-side floor/ceiling — the 5-min minimum protects the Ruijie quota
      // regardless of what the client sends (mirrors the scheduler's own clamp).
      const clamped = Math.min(1440, Math.max(5, Math.round(mins)));
      const uid = req.user?.id ?? null;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const upsert =
          `INSERT INTO app_settings (setting_key, setting_value, setting_type, updated_by) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), setting_type = VALUES(setting_type), updated_by = VALUES(updated_by)`;
        await conn.query(upsert, ['sync_enabled', enabled ? 'true' : 'false', 'boolean', uid]);
        await conn.query(upsert, ['sync_interval_minutes', String(clamped), 'number', uid]);
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
        console.error('updateSyncSettings failed:', e);
        return send.serverErr(res);
      }
      conn.release();

      // Single reload AFTER the commit → the scheduler reads a consistent pair.
      let status = null;
      try { status = await syncScheduler?.reload(); } catch (e) { console.error('Scheduler reload failed:', e.message); }
      return send.ok(res, { success: true, enabled, intervalMinutes: clamped, status });
    },

    // Wiring hook (server.js) + shared starter exposed for the scheduler.
    setSyncScheduler: (s) => { syncScheduler = s; },
    runGuardedSync,
  };
}
