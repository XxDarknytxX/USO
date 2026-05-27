// src/controllers/voucherController.js
import { validationResult } from "express-validator";
import crypto from "crypto";
import RuijieService from "../services/ruijieService.js";

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

async function getVoucherStats(pool) {
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
    GROUP BY package_name
    ORDER BY package_name
  `);
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

async function getVoucherList(pool, { page = 1, limit = 10, status, packageName, userGroupId, includeHistorical = false }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where = [];

  if (status) { where.push('v.status = ?'); params.push(status); }
  if (packageName) { where.push('v.package_name = ?'); params.push(packageName); }
  if (userGroupId) { where.push('v.user_group_id = ?'); params.push(userGroupId); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const tableName = includeHistorical ? 'vouchers_combined' : 'vouchers';

  const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM ${tableName} v ${whereClause}`, params);
  const [rows] = await pool.query(
    `SELECT v.*, vc.client_mac AS claimed_mac
     FROM ${tableName} v
     LEFT JOIN voucher_claims vc ON vc.voucher_code = v.voucher_code AND vc.status IN ('claimed', 'used')
     ${whereClause}
     ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { vouchers: rows, total: countRow.total, page, limit, totalPages: Math.ceil(countRow.total / limit) };
}

async function archiveVouchersNotInCloud(pool, cloudVoucherUuids, syncId) {
  const insertCols = `original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
    time_period, used_time, create_time, login_time, expiry_time, max_clients,
    current_clients, quota, used_quota, status, qrcode_url, download_rate_limit,
    upload_rate_limit, bind_mac, user_group_id, user_group_name, first_name,
    last_name, email, phone, comment, disable_status, raw_data, last_synced,
    archived_reason, sync_log_id`;
  const selectCols = `id, uuid, tenant_id, voucher_code, name_ref, package_name,
    time_period, used_time, create_time, login_time, expiry_time, max_clients,
    current_clients, quota, used_quota, status, qrcode_url, download_rate_limit,
    upload_rate_limit, bind_mac, user_group_id, user_group_name, first_name,
    last_name, email, phone, comment, disable_status, raw_data, last_synced,
    'removed_from_cloud', ?`;

  if (cloudVoucherUuids.length === 0) {
    const [result] = await pool.query(`INSERT INTO vouchers_historical (${insertCols}) SELECT ${selectCols} FROM vouchers`, [syncId]);
    const archivedCount = result.affectedRows;
    await pool.query('DELETE FROM vouchers');
    return archivedCount;
  }

  const placeholders = cloudVoucherUuids.map(() => '?').join(',');
  const [result] = await pool.query(
    `INSERT INTO vouchers_historical (${insertCols}) SELECT ${selectCols} FROM vouchers WHERE uuid NOT IN (${placeholders})`,
    [syncId, ...cloudVoucherUuids]
  );
  const archivedCount = result.affectedRows;
  if (archivedCount > 0) {
    await pool.query(`DELETE FROM vouchers WHERE uuid NOT IN (${placeholders})`, cloudVoucherUuids);
  }
  return archivedCount;
}

async function upsertVoucher(pool, voucherData) {
  const {
    uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
    create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
    status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
    user_group_id, user_group_name, first_name, last_name, email, phone, comment,
    disable_status, raw_data,
  } = voucherData;

  const [result] = await pool.query(
    `INSERT INTO vouchers (
      uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
      create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
      status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
      user_group_id, user_group_name, first_name, last_name, email, phone, comment,
      disable_status, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      tenant_id = VALUES(tenant_id), voucher_code = VALUES(voucher_code), name_ref = VALUES(name_ref),
      package_name = VALUES(package_name), time_period = VALUES(time_period), used_time = VALUES(used_time),
      create_time = VALUES(create_time), login_time = VALUES(login_time), expiry_time = VALUES(expiry_time),
      max_clients = VALUES(max_clients), current_clients = VALUES(current_clients), quota = VALUES(quota),
      used_quota = VALUES(used_quota), status = VALUES(status), qrcode_url = VALUES(qrcode_url),
      download_rate_limit = VALUES(download_rate_limit), upload_rate_limit = VALUES(upload_rate_limit),
      bind_mac = VALUES(bind_mac), user_group_id = VALUES(user_group_id), user_group_name = VALUES(user_group_name),
      first_name = VALUES(first_name), last_name = VALUES(last_name), email = VALUES(email),
      phone = VALUES(phone), comment = VALUES(comment), disable_status = VALUES(disable_status),
      raw_data = VALUES(raw_data), last_synced = CURRENT_TIMESTAMP`,
    [uuid, tenant_id, voucher_code, name_ref, package_name, time_period, used_time,
     create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
     status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac,
     user_group_id, user_group_name, first_name, last_name, email, phone, comment,
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

async function getRecentSyncLogs(pool, limit = 10) {
  const [rows] = await pool.query(
    `SELECT vsl.*, u.email AS user_email FROM voucher_sync_log vsl JOIN users u ON vsl.user_id = u.id ORDER BY vsl.sync_started_at DESC LIMIT ?`,
    [limit]
  );
  return rows;
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

function transformVoucherData(externalVoucher) {
  return {
    uuid: externalVoucher.uuid,
    tenant_id: externalVoucher.tenantId,
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

// ── Factory ─────────────────────────────────────────────────────

export function makeVoucherController(pool) {
  const ruijieService = new RuijieService();

  return {
    getStats: async (_req, res) => {
      try {
        const [stats, historicalStats] = await Promise.all([getVoucherStats(pool), getHistoricalStats(pool)]);
        const totalVouchers = stats.reduce((sum, item) => sum + Number(item.total || 0), 0);
        const totalHistorical = historicalStats.reduce((sum, item) => sum + Number(item.total_historical || 0), 0);
        return send.ok(res, { packageStats: stats, historicalStats, totalVouchers, totalHistorical, lastSync: await getLastSyncTime(pool) });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    getVouchers: async (req, res) => {
      try {
        const { page, limit, status, packageName, userGroupId, includeHistorical } = req.query;
        const result = await getVoucherList(pool, {
          page: parseInt(page) || 1, limit: parseInt(limit) || 10,
          status, packageName, userGroupId, includeHistorical: includeHistorical === 'true'
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
        const like = `%${q.trim()}%`;
        const searchFields = 'voucher_code LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR comment LIKE ? OR name_ref LIKE ? OR package_name LIKE ?';
        const searchParams = Array(8).fill(like);

        const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM vouchers WHERE ${searchFields}`, searchParams);
        const [rows] = await pool.query(
          `SELECT * FROM vouchers WHERE ${searchFields} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...searchParams, lim, offset]
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

    getUserGroups: async (_req, res) => {
      try {
        // Primary source: distinct user groups already synced into local DB
        const [dbGroups] = await pool.query(`
          SELECT DISTINCT user_group_id, user_group_name,
            AVG(time_period) AS avg_time_period,
            COUNT(*) AS voucher_count
          FROM vouchers
          WHERE user_group_id IS NOT NULL AND user_group_id != ''
          GROUP BY user_group_id, user_group_name
          ORDER BY user_group_name
        `);

        // Also try Ruijie API for richer data (e.g. authprofileid / profile UUID)
        let cloudGroups = [];
        let cloudSync = false;
        try {
          const result = await ruijieService.getUserGroups();
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

        // Ruijie API 2.3.1: requires quantity, profile (UUID), userGroupId
        // Optionally 2.3.2: custom code via customerCreate endpoint
        let cloudResult;
        if (body.custom_code) {
          cloudResult = await ruijieService.createCustomVoucher(body.custom_code, {
            profile,
            userGroupId: body.user_group_id,
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
          });
        }

        // Collect UUIDs from the create response so we know which vouchers were made
        const createdUuids = [];
        const cloudList = cloudResult?.data?.voucherData?.list ?? cloudResult?.data?.list ?? [];

        if (cloudList.length > 0) {
          for (const cv of cloudList) {
            // Do a lightweight insert with the sparse data we got from the create response
            const voucherData = transformVoucherData(cv);
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
            const allCloudVouchers = await ruijieService.getAllVouchers();
            const createdSet = new Set(createdUuids);
            let enrichedCount = 0;
            for (const externalVoucher of allCloudVouchers) {
              if (createdSet.has(externalVoucher.uuid)) {
                const fullData = transformVoucherData(externalVoucher);
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

        const cloudResult = await ruijieService.updateVoucher(uuid, body);

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

        const cloudResult = await ruijieService.deleteVouchers([uuid]);

        await pool.query(
          `INSERT INTO vouchers_historical (original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
            time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
            status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name,
            first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, archived_reason)
           SELECT id, uuid, tenant_id, voucher_code, name_ref, package_name,
            time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
            status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name,
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
          cloudResult = await ruijieService.enableVoucher(uuid);
          await pool.query('UPDATE vouchers SET disable_status = 0, last_synced = CURRENT_TIMESTAMP WHERE uuid = ?', [uuid]);
          await logLifecycleEvent(pool, { voucherUuid: uuid, eventType: 'enabled', oldStatus: existing.status, notes: 'Voucher enabled', userId: req.user.id });
        } else {
          cloudResult = await ruijieService.disableVoucher(uuid);
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
              await ruijieService.deleteVouchers([uuid]);
              await pool.query(
                `INSERT INTO vouchers_historical (original_voucher_id, uuid, tenant_id, voucher_code, name_ref, package_name,
                  time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
                  status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name,
                  first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, archived_reason)
                 SELECT id, uuid, tenant_id, voucher_code, name_ref, package_name,
                  time_period, used_time, create_time, login_time, expiry_time, max_clients, current_clients, quota, used_quota,
                  status, qrcode_url, download_rate_limit, upload_rate_limit, bind_mac, user_group_id, user_group_name,
                  first_name, last_name, email, phone, comment, disable_status, raw_data, last_synced, 'bulk_deleted'
                 FROM vouchers WHERE uuid = ?`, [uuid]
              );
              await pool.query('DELETE FROM vouchers WHERE uuid = ?', [uuid]);
            } else if (action === 'disable') {
              await ruijieService.disableVoucher(uuid);
              await pool.query('UPDATE vouchers SET disable_status = 1 WHERE uuid = ?', [uuid]);
            } else if (action === 'enable') {
              await ruijieService.enableVoucher(uuid);
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

    syncVouchers: async (req, res) => {
      const syncId = await createSyncLog(pool, req.user.id);
      try {
        const externalVouchers = await ruijieService.getAllVouchers();
        const cloudVoucherUuids = externalVouchers.map(v => v.uuid);
        const archivedCount = await archiveVouchersNotInCloud(pool, cloudVoucherUuids, syncId);

        let processedCount = 0, newCount = 0, updatedCount = 0;
        for (const externalVoucher of externalVouchers) {
          try {
            const voucherData = transformVoucherData(externalVoucher);
            const result = await upsertVoucher(pool, voucherData);
            processedCount++;
            if (result.affectedRows === 1) newCount++;
            else if (result.affectedRows === 2) updatedCount++;
          } catch (error) { console.error('Error processing voucher:', error); }
        }

        await updateSyncLog(pool, syncId, {
          sync_completed_at: new Date(), total_fetched: externalVouchers.length,
          total_processed: processedCount, total_new: newCount, total_updated: updatedCount,
          total_archived: archivedCount, status: 'completed',
        });

        return send.ok(res, { success: true, totalFetched: externalVouchers.length, totalProcessed: processedCount, newVouchers: newCount, updatedVouchers: updatedCount, archivedVouchers: archivedCount, syncId });
      } catch (error) {
        console.error('Sync failed:', error);
        await updateSyncLog(pool, syncId, { sync_completed_at: new Date(), status: 'failed', error_message: error.message });
        return send.serverErr(res, `Sync failed: ${error.message}`);
      }
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

    getSyncLogs: async (_req, res) => {
      try {
        const logs = await getRecentSyncLogs(pool, 20);
        return send.ok(res, { logs });
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
        const { key } = req.params;
        const { value } = req.body;
        await pool.query(
          `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
          [key, value, req.user.id]
        );
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },
  };
}
