// src/controllers/portalApiController.js
// Public API endpoints called by USO Portal (shared-secret auth)
//
// NOTE: this controller no longer talks to Ruijie Cloud. Voucher status/usage is
// served from the local mirror (refreshed by the manual POST /api/vouchers/sync);
// the per-request live lookups were removed to stop the `code: 44` API throttle.

import { loadSmtpTransport, buildReceipt } from "../services/mailer.js";
import { logEmailEvent } from "../services/emailLog.js";

const send = {
  ok: (res, data = {}) => res.json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

const log = (...m) => console.log(new Date().toISOString(), '[PortalAPI]', ...m);

// Resolve which site (Ruijie network group) a public request is for.
// USO Portal passes ?hostname=<the site domain the customer is on>; admin/debug
// may pass ?groupId=. When a hostname is given but doesn't match a site we fall
// back to the env default site so a public caller never sees every site's plans.
// Returns null only when there's no site signal at all (internal id lookups).
async function resolveSiteGroup(pool, req) {
  const qGroup = (req.query.groupId || '').toString().trim();
  if (qGroup) return qGroup;
  const host = (req.query.hostname || '').toString().split(':')[0].trim().toLowerCase();
  if (host) {
    try {
      const [rows] = await pool.query(
        'SELECT ruijie_group_id FROM network_projects WHERE LOWER(hostname) = ? LIMIT 1',
        [host]
      );
      if (rows[0] && rows[0].ruijie_group_id) return rows[0].ruijie_group_id;
    } catch { /* ignore lookup failure */ }
    return process.env.RUIJIE_GROUP_ID || null; // host given but unmatched → default site
  }
  return null; // no site signal → caller gets all plans
}

// In-memory live-data cache: voucherCode → { data, timestamp }
const liveVoucherCache = new Map();
const LIVE_CACHE_TTL = 20000; // 20 seconds — fresh enough for status page, avoids hammering API

export function makePortalApiController(pool) {

  // Periodic cleanup: release expired voucher claims (older than 30 min, still 'claimed')
  setInterval(async () => {
    try {
      const [result] = await pool.query(
        `UPDATE voucher_claims SET status = 'expired', released_at = NOW()
         WHERE status = 'claimed' AND claimed_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
      );
      if (result.affectedRows > 0) {
        log(`Cleaned up ${result.affectedRows} expired voucher claims`);
      }
    } catch (e) {
      log('Claim cleanup error:', e.message);
    }
  }, 5 * 60 * 1000); // every 5 minutes

  return {
    // GET /api/portal/plans - returns active plans formatted for USO Portal
    getPortalPlans: async (req, res) => {
      try {
        const groupId = await resolveSiteGroup(pool, req);
        const where = ['is_active = 1'];
        const params = [];
        if (groupId) { where.push('group_id = ?'); params.push(groupId); }
        const [plans] = await pool.query(
          `SELECT * FROM portal_plan_configs WHERE ${where.join(' AND ')} ORDER BY category, sort_order, name`,
          params
        );

        // Tally AVAILABLE (unused, unclaimed) vouchers per user group so a plan
        // with none left can be shown "sold out" and blocked before payment.
        // Mirrors the claim-voucher matching exactly: status '1', not disabled,
        // not already claimed, matched by user_group_id OR (site group_id + name).
        const availWhere = [
          "v.status = '1'",
          "v.disable_status = 0",
          "v.id NOT IN (SELECT vc.voucher_id FROM voucher_claims vc WHERE vc.status IN ('claimed','used','manually_assigned') AND vc.voucher_id IS NOT NULL)",
        ];
        const availParams = [];
        if (groupId) { availWhere.push('v.group_id = ?'); availParams.push(groupId); }
        const [availRows] = await pool.query(
          `SELECT v.user_group_id AS ugid, v.group_id AS gid, v.user_group_name AS ugname, COUNT(*) AS cnt
             FROM vouchers v
            WHERE ${availWhere.join(' AND ')}
            GROUP BY v.user_group_id, v.group_id, v.user_group_name`,
          availParams
        );
        const availableFor = (p) => {
          const pid = p.user_group_id != null ? String(p.user_group_id) : '';
          const pgid = p.group_id != null ? String(p.group_id) : '';
          const pname = (p.user_group_name || '').toLowerCase();
          let n = 0;
          for (const r of availRows) {
            const byId = pid !== '' && r.ugid != null && String(r.ugid) === pid;
            const byName =
              pgid !== '' && pname !== '' && r.gid != null &&
              String(r.gid) === pgid && (r.ugname || '').toLowerCase() === pname;
            if (byId || byName) n += Number(r.cnt);
          }
          return n;
        };

        // Format to match the exact shape the USO Portal frontend expects
        const formatted = plans.map(p => {
          const availableCount = availableFor(p);
          return {
            id: p.plan_key,
            name: p.name,
            data: p.data_allowance,
            icon: p.icon,
            category: p.category,
            price: `$${Number(p.price).toFixed(2)}`,
            popular: !!p.popular,
            features: typeof p.features === 'string' ? JSON.parse(p.features) : p.features,
            description: p.description || '',
            // Extra fields for voucher claim
            userGroupId: p.user_group_id,
            planConfigId: p.id,
            // Availability — so the portal can show "sold out" + block purchase.
            availableCount,
            soldOut: availableCount === 0,
          };
        });

        return res.json(formatted);
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal/categories - returns categories derived from active plans
    getPortalCategories: async (req, res) => {
      try {
        const groupId = await resolveSiteGroup(pool, req);
        const where = ['is_active = 1'];
        const params = [];
        if (groupId) { where.push('group_id = ?'); params.push(groupId); }
        const [rows] = await pool.query(
          `SELECT category, COUNT(*) AS count
           FROM portal_plan_configs
           WHERE ${where.join(' AND ')}
           GROUP BY category
           ORDER BY FIELD(category, 'daily', 'weekly', 'monthly', 'custom')`,
          params
        );

        const result = rows.map(r => ({
          id: r.category,
          name: r.category[0].toUpperCase() + r.category.slice(1),
          count: r.count,
        }));

        return res.json(result);
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal/receipt — email a purchase receipt to the customer.
    // Called (fire-and-forget) by USO Portal after a voucher is claimed. Looks up
    // the email from the M-PAiSA mapping and only sends when the feature is enabled
    // AND this site is in the allowed group set. Always 200s (best-effort).
    sendPurchaseReceipt: async (req, res) => {
      const { phone, voucherCode, host, planName, dataAllowance, amount, transactionId } = req.body || {};
      // Common identity fields for every log row this request may write.
      const base = {
        voucherCode: voucherCode || null,
        phone: phone || null,
        amount: amount ?? null,
        transactionId: transactionId || null,
      };
      // EVERY outcome is logged, including the configuration skips. They were
      // originally left out as "expected filtering", but that made an absent
      // receipt undiagnosable: a disabled feature, a village not on the list,
      // and the USO portal never calling at all produced exactly the same
      // thing — nothing. One row per purchase is proportional, not noise, and
      // it is the only way to tell those three cases apart from Portal Logs.
      const skip = (reason, groupId = null) => {
        logEmailEvent(pool, {
          eventType: 'receipt_email_skipped', status: 'skipped', reason,
          message: `Receipt not sent: ${reason}`, groupId, ...base,
        });
        return send.ok(res, { sent: false, reason, ...(groupId != null ? { groupId } : {}) });
      };

      try {
        if (!voucherCode) return send.ok(res, { sent: false, reason: 'missing_voucher' });

        // Feature settings (app_settings): master toggle + allowed site group ids.
        const [srows] = await pool.query(
          "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('receipt_emails_enabled','receipt_group_ids')"
        );
        const s = Object.fromEntries(srows.map((r) => [r.setting_key, r.setting_value]));
        if (String(s.receipt_emails_enabled || '').toLowerCase() !== 'true') {
          logEmailEvent(pool, {
            eventType: 'receipt_email_skipped', status: 'skipped', reason: 'disabled',
            message: 'Receipt not sent: purchase receipts are turned off in Settings', ...base,
          });
          return send.ok(res, { sent: false, reason: 'disabled' });
        }
        const allowed = String(s.receipt_group_ids || '7847952')
          .split(',').map((x) => x.trim()).filter(Boolean);

        // Resolve which village this purchase belongs to.
        //
        // The VOUCHER decides, not the host. This used to read the host first,
        // which is wrong on any unpinned instance: site1.vodafonefiji.cloud
        // serves every village (sites.json groupId: null), so a Vunisei purchase
        // made through it resolved to the site1 project and was judged against
        // THAT village's receipt setting — silently skipping receipts for every
        // purchase routed through the shared host. The voucher was claimed for
        // one specific village's plan; that is the ground truth. Host is only a
        // last resort, for a code we cannot find at all.
        const hostNorm = String(host || '').split(':')[0].trim().toLowerCase();
        let groupId = null;

        const [vr] = await pool.query('SELECT group_id FROM vouchers WHERE voucher_code = ? LIMIT 1', [voucherCode]);
        groupId = vr[0]?.group_id || null;

        // Voucher row gone (archived by a sync) — fall back to the plan the
        // claim was made against, which also carries the village.
        if (!groupId && transactionId) {
          const [cr] = await pool.query(
            `SELECT pc.group_id FROM voucher_claims vc
               JOIN portal_plan_configs pc ON pc.id = vc.plan_config_id
              WHERE vc.transaction_id = ? LIMIT 1`,
            [transactionId]
          );
          groupId = cr[0]?.group_id || null;
        }

        if (!groupId && hostNorm) {
          const [pr] = await pool.query(
            'SELECT ruijie_group_id FROM network_projects WHERE LOWER(hostname) = ? LIMIT 1', [hostNorm]
          );
          groupId = pr[0]?.ruijie_group_id || null;
        }

        if (!groupId || !allowed.includes(String(groupId))) {
          // Say WHICH village was resolved and what the allow-list holds — the
          // usual causes are an unsaved settings change, or a host/voucher that
          // does not map to a village at all (groupId null).
          //
          // The reason on the wire must MATCH the reason logged. It used to
          // always say 'site_not_enabled', so the portal's own log claimed a
          // village was unticked even when the truth was that no village could
          // be worked out at all — two different faults, one misleading label.
          const reason = groupId ? 'site_not_enabled' : 'site_unresolved';
          logEmailEvent(pool, {
            eventType: 'receipt_email_skipped', status: 'skipped',
            reason,
            message: groupId
              ? `Receipt not sent: village ${groupId} is not selected for receipts (enabled: ${allowed.join(', ') || 'none'})`
              : `Receipt not sent: could not work out which village this purchase belongs to (host "${hostNorm || 'none'}", voucher ${voucherCode})`,
            groupId, ...base,
          });
          return send.ok(res, { sent: false, reason, groupId: groupId || null });
        }

        // Customer email from the M-PAiSA mapping. Match the phone tolerantly:
        // strip non-digits, and also try without a Fiji country code (679…) and
        // the last 7 digits, since the callback and the report export can format
        // the same number differently.
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return skip('no_phone', groupId);
        // Normalise BOTH sides. The old version only widened the incoming
        // number, and for a bare 7-digit callback (which is every Fiji mobile)
        // both of its widening branches were dead — leaving a single exact
        // match, so any stored row carrying a trunk 0 or a 679 was unreachable.
        let core = digits.replace(/^0+/, '');
        if (core.length > 7 && core.startsWith('679')) core = core.slice(3);
        const last7 = core.length > 7 ? core.slice(-7) : core;
        const [mr] = await pool.query(
          `SELECT email FROM mpaisa_mappings
            WHERE number = ? OR number = ? OR RIGHT(number, 7) = ?
            ORDER BY (number = ?) DESC
            LIMIT 1`,
          [digits, core, last7, core]
        );
        const email = mr[0]?.email || null;
        if (!email) return skip('no_mapping', groupId);

        const smtp = await loadSmtpTransport(pool);
        if (!smtp) return skip('smtp_not_configured', groupId);

        // Deep-link to THIS voucher rather than bare /status. /status resolves by
        // device (session or MAC) and one number can hold several live vouchers
        // at once, so a bare link can legitimately land on a different one than
        // the email is about.
        const statusUrl = hostNorm
          ? `https://${hostNorm}/status${voucherCode ? `/${encodeURIComponent(voucherCode)}` : ''}`
          : null;
        const mail = buildReceipt({ voucherCode, statusUrl, planName, dataAllowance, amount });
        try {
          await smtp.transport.sendMail({
            from: smtp.from, to: email,
            subject: mail.subject, text: mail.text, html: mail.html,
            attachments: mail.attachments,
          });
        } catch (sendErr) {
          console.error('[receipt] SMTP send failed:', sendErr.message);
          logEmailEvent(pool, {
            eventType: 'receipt_email_failed', status: 'failed', reason: 'send_error',
            to: email, subject: mail.subject, template: 'receipt',
            message: `Receipt send failed to ${email}`, error: sendErr.message, groupId, ...base,
          });
          return send.ok(res, { sent: false, reason: 'send_error', error: sendErr.message });
        }
        log(`Receipt emailed to ${email} for voucher ${voucherCode} (group ${groupId})`);
        logEmailEvent(pool, {
          eventType: 'receipt_email_sent', status: 'sent',
          to: email, subject: mail.subject, template: 'receipt',
          message: `Receipt emailed to ${email}`, groupId, ...base,
        });
        return send.ok(res, { sent: true, to: email });
      } catch (e) {
        console.error('[receipt] send failed:', e.message);
        logEmailEvent(pool, {
          eventType: 'receipt_email_failed', status: 'failed', reason: 'error',
          message: 'Receipt handler error', error: e.message, ...base,
        });
        return send.ok(res, { sent: false, reason: 'error', error: e.message });
      }
    },

    // POST /api/portal/claim-voucher
    claimVoucher: async (req, res) => {
      const { userGroupId, planConfigId, transactionId, sessionId, clientMac } = req.body;

      if (!userGroupId || !planConfigId || !transactionId) {
        return send.bad(res, 'userGroupId, planConfigId, and transactionId are required');
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Check plan config exists and is active
        const [configRows] = await conn.query(
          'SELECT id, group_id, user_group_name FROM portal_plan_configs WHERE id = ? AND is_active = 1',
          [planConfigId]
        );
        if (configRows.length === 0) {
          await conn.rollback();
          conn.release();
          return send.bad(res, 'Plan config not found or inactive');
        }

        // Check if this transaction already has a claim
        const [existingClaim] = await conn.query(
          'SELECT * FROM voucher_claims WHERE transaction_id = ?',
          [transactionId]
        );
        if (existingClaim.length > 0) {
          await conn.rollback();
          conn.release();
          // Return the existing claim (idempotent)
          const claim = existingClaim[0];
          return send.ok(res, {
            success: true,
            voucherCode: claim.voucher_code,
            voucherUuid: claim.voucher_uuid,
            claimId: claim.id,
            expiresAt: claim.expires_at,
            cached: true,
          });
        }

        // Find an available voucher (FOR UPDATE to prevent races). Match to the
        // plan's user group by user_group_id when the voucher carries one (legacy
        // API-synced), OR by (site group_id + group NAME) for Excel-synced
        // vouchers, which have NO user_group_id (the Excel export only carries the
        // group name). A user_group_id is itself site-unique, so the id branch is
        // already site-scoped; the name branch is scoped by group_id. Ruijie keeps
        // projects isolated (a voucher only auths a device whose session is in the
        // same project), so a cross-site voucher wouldn't work anyway.
        const planGroupId = configRows[0].group_id || null;
        const planUserGroupName = configRows[0].user_group_name || '';
        const [vouchers] = await conn.query(
          `SELECT v.id, v.uuid, v.voucher_code
           FROM vouchers v
           WHERE v.status = '1'
             AND v.disable_status = 0
             AND v.id NOT IN (
               SELECT vc.voucher_id FROM voucher_claims vc
               WHERE vc.status IN ('claimed', 'used', 'manually_assigned') AND vc.voucher_id IS NOT NULL
             )
             AND (
               (v.user_group_id <> '' AND v.user_group_id = ? COLLATE utf8mb4_0900_ai_ci)
               OR (? IS NOT NULL AND v.group_id = ? COLLATE utf8mb4_0900_ai_ci
                   AND v.user_group_name = ? COLLATE utf8mb4_0900_ai_ci)
             )
           ORDER BY v.create_time ASC
           LIMIT 1
           FOR UPDATE`,
          [userGroupId, planGroupId, planGroupId, planUserGroupName]
        );

        if (vouchers.length === 0) {
          await conn.rollback();
          conn.release();
          log(`No vouchers available for userGroupId=${userGroupId}, transactionId=${transactionId}`);
          return send.ok(res, {
            success: false,
            error: 'no_vouchers_available',
            message: 'No unused vouchers available for this plan',
          });
        }

        const voucher = vouchers[0];
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min expiry

        // Create the claim
        const [claimResult] = await conn.query(
          `INSERT INTO voucher_claims
           (voucher_id, voucher_uuid, voucher_code, plan_config_id, user_group_id,
            transaction_id, session_id, client_mac, status, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?)`,
          [voucher.id, voucher.uuid, voucher.voucher_code, planConfigId, userGroupId,
           transactionId, sessionId || null, clientMac || null, expiresAt]
        );

        await conn.commit();
        conn.release();

        log(`Voucher ${voucher.voucher_code} claimed for transaction ${transactionId} (plan config ${planConfigId})`);

        return send.ok(res, {
          success: true,
          voucherCode: voucher.voucher_code,
          voucherUuid: voucher.uuid,
          claimId: claimResult.insertId,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (e) {
        await conn.rollback().catch(() => {});
        conn.release();

        if (e.code === 'ER_DUP_ENTRY') {
          // Transaction already claimed - race condition handled
          return send.ok(res, {
            success: false,
            error: 'claim_conflict',
            message: 'Transaction already has a voucher claim',
          });
        }

        console.error('Claim voucher error:', e);
        return send.serverErr(res, 'Failed to claim voucher');
      }
    },

    // POST /api/portal/release-voucher
    releaseVoucher: async (req, res) => {
      const { transactionId, claimId } = req.body;

      if (!transactionId) {
        return send.bad(res, 'transactionId is required');
      }

      try {
        const where = claimId
          ? 'id = ? AND transaction_id = ?'
          : 'transaction_id = ?';
        const params = claimId
          ? [claimId, transactionId]
          : [transactionId];

        const [result] = await pool.query(
          `UPDATE voucher_claims SET status = 'released', released_at = NOW()
           WHERE ${where} AND status = 'claimed'`,
          params
        );

        if (result.affectedRows === 0) {
          return send.ok(res, { success: false, message: 'No claimable voucher found for this transaction' });
        }

        log(`Voucher released for transaction ${transactionId}`);
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal/reserve-voucher — for a "paid but auth failed" manual
    // assistance case, KEEP the claimed voucher reserved for that customer
    // (status 'manually_assigned') instead of releasing it to the pool. The
    // Ruijie voucher is still unused, so the customer can redeem this exact code
    // via the manual voucher-login. The pool-pick excludes 'manually_assigned'
    // so it is never re-sold.
    reserveVoucherForManual: async (req, res) => {
      const { transactionId, claimId } = req.body;
      if (!transactionId) return send.bad(res, 'transactionId is required');
      try {
        const where = claimId ? 'id = ? AND transaction_id = ?' : 'transaction_id = ?';
        const params = claimId ? [claimId, transactionId] : [transactionId];
        const [result] = await pool.query(
          `UPDATE voucher_claims SET status = 'manually_assigned', released_at = NULL
           WHERE ${where} AND status = 'claimed'`,
          params
        );
        if (result.affectedRows === 0) {
          return send.ok(res, { success: false, message: 'No claimable voucher found for this transaction' });
        }
        log(`Voucher reserved (manually_assigned) for transaction ${transactionId}`);
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal/mark-used - mark a claimed voucher as used (after successful auth)
    markVoucherUsed: async (req, res) => {
      const { transactionId } = req.body;

      if (!transactionId) {
        return send.bad(res, 'transactionId is required');
      }

      try {
        const [result] = await pool.query(
          `UPDATE voucher_claims SET status = 'used', used_at = NOW()
           WHERE transaction_id = ? AND status = 'claimed'`,
          [transactionId]
        );

        return send.ok(res, { success: result.affectedRows > 0 });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal/voucher-status/:voucherCode - public usage data for status page.
    // LOCAL MIRROR ONLY: reads the local `vouchers` table (refreshed by the manual
    // sync). No Ruijie Cloud call — the per-request live lookup was a code:44 driver
    // and Ruijie's list API returns 0 for used data anyway. So usage/status is as
    // fresh as the last sync; a 20s in-memory cache sits in front of the DB read.
    getVoucherStatus: async (req, res) => {
      const { voucherCode } = req.params;

      if (!voucherCode || voucherCode.trim().length === 0) {
        return send.bad(res, 'voucherCode is required');
      }

      const code = voucherCode.trim();

      // Helper: build the response object from a voucher record.
      // disableStatus (0/1) is tracked in the local DB — admin deactivation
      // is NOT reflected in Ruijie's voucher list, so it must be merged in.
      const buildResponse = (v, disableStatus = Number(v.disable_status) || 0) => {
        const now = Date.now();
        const remainingQuota = Math.max(0, (v.quota || 0) - (v.used_quota || 0));
        const remainingTime = Math.max(0, (v.time_period || 0) - (v.used_time || 0));

        // Normalise expiry_time to milliseconds.
        // Ruijie Cloud may return seconds (10-digit) or ms (13-digit).
        let expiryMs = null;
        if (v.expiry_time && v.expiry_time > 0) {
          expiryMs = v.expiry_time < 1e12 ? v.expiry_time * 1000 : v.expiry_time;
        }

        // Ruijie Cloud status codes:
        //   '1' = Unused (not yet activated)
        //   '2' = In-use  (active / connected)
        //   '3' = Expired
        const statusStr = String(v.status);
        const isDisabled = Number(disableStatus) === 1;
        const isExpired = statusStr === '3' || (expiryMs !== null && expiryMs < now);
        // Also treat as inactive if data quota or time is fully consumed
        const dataExhausted = v.quota > 0 && remainingQuota <= 0;
        const timeExhausted = v.time_period > 0 && remainingTime <= 0;
        // Usable only if unused/in-use, not expired, not exhausted, not disabled.
        // (String() so a numeric DB status still matches '1'/'2'.)
        const isActive =
          (statusStr === '1' || statusStr === '2') &&
          !isExpired && !dataExhausted && !timeExhausted && !isDisabled;

        return {
          voucherCode: v.voucher_code,
          status: v.status,
          isActive,
          isExpired,
          disabled: isDisabled,
          quota: v.quota,
          usedQuota: v.used_quota,
          remainingQuota,
          timePeriod: v.time_period,
          usedTime: v.used_time,
          remainingTime,
          expiryTime: v.expiry_time,
          loginTime: v.login_time,
          createTime: v.create_time,
          currentClients: v.current_clients,
          maxClients: v.max_clients,
          downloadRateLimit: v.download_rate_limit,
          uploadRateLimit: v.upload_rate_limit,
          packageName: v.package_name,
          userGroupName: v.user_group_name,
        };
      };

      try {
        // 1. In-memory cache — cheap short-circuit for the status page's polling.
        const cached = liveVoucherCache.get(code);
        if (cached && Date.now() - cached.timestamp < LIVE_CACHE_TTL) {
          return send.ok(res, cached.data);
        }

        // 2. LOCAL MIRROR ONLY. We deliberately do NOT live-query Ruijie Cloud
        //    per status check anymore — that (plus the network collector) was the
        //    driver of the `code: 44` throttle, and Ruijie's list API returns 0
        //    for used data anyway. Status/usage here is as fresh as the last
        //    MANUAL voucher sync (POST /api/vouchers/sync). buildResponse reads
        //    the admin `disable_status` straight off the same row.
        const [rows] = await pool.query(
          `SELECT voucher_code, status, quota, used_quota, time_period, used_time,
                  expiry_time, login_time, current_clients, max_clients,
                  download_rate_limit, upload_rate_limit, package_name, user_group_name,
                  create_time, disable_status
           FROM vouchers WHERE voucher_code = ?`,
          [code]
        );

        if (rows.length === 0) {
          return res.status(404).json({ error: 'Voucher not found' });
        }

        const responseData = buildResponse(rows[0]);
        liveVoucherCache.set(code, { data: responseData, timestamp: Date.now() });
        return send.ok(res, responseData);
      } catch (e) {
        console.error('getVoucherStatus error:', e);
        return send.serverErr(res);
      }
    },

    // POST /api/portal/audit-log
    ingestAuditLog: async (req, res) => {
      log('>> Received audit log request');
      log('   Headers:', JSON.stringify({
        'content-type': req.headers['content-type'],
        'x-portal-secret': req.headers['x-portal-secret'] ? '***SET***' : '***MISSING***',
      }));
      log('   Body:', JSON.stringify(req.body, null, 2));

      const {
        eventType, transactionId, sessionId, planKey, userGroupId,
        voucherCode, amount, customerPhone, eventData, eventTimestamp,
      } = req.body;

      if (!eventType) {
        log('   XX Rejected: eventType missing');
        return send.bad(res, 'eventType is required');
      }

      try {
        const sourceIp = req.ip || req.connection?.remoteAddress || 'unknown';

        // Convert ISO 8601 timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
        let mysqlTimestamp;
        if (eventTimestamp) {
          const d = new Date(eventTimestamp);
          mysqlTimestamp = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0') + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0') + ':' +
            String(d.getSeconds()).padStart(2, '0');
        } else {
          mysqlTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

        const insertParams = [
          eventType, transactionId || null, sessionId || null,
          planKey || null, userGroupId || null, voucherCode || null,
          amount || null, customerPhone || null,
          eventData ? JSON.stringify(eventData) : null,
          sourceIp, mysqlTimestamp,
        ];

        log(`   Inserting [${eventType}] txn=${transactionId || 'N/A'} session=${sessionId || 'N/A'} plan=${planKey || 'N/A'} voucher=${voucherCode || 'N/A'} amount=${amount || 'N/A'} phone=${customerPhone || 'N/A'}`);

        const [result] = await pool.query(
          `INSERT INTO portal_audit_logs
           (event_type, transaction_id, session_id, plan_key, user_group_id,
            voucher_code, amount, customer_phone, event_data, source_ip, event_timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          insertParams
        );

        log(`   << Audit log saved with id=${result.insertId}`);
        return send.ok(res, { success: true, logId: result.insertId });
      } catch (e) {
        log('   XX Audit log insert FAILED:', e.message);
        console.error(e);
        return send.serverErr(res);
      }
    },
  };
}
