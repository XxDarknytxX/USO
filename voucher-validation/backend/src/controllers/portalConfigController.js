// src/controllers/portalConfigController.js
// Admin CRUD for portal plan configurations + audit log viewing

import { loadSmtpTransport, buildManualAssist, buildReceipt, inlineLogo } from "../services/mailer.js";
import { logEmailEvent } from "../services/emailLog.js";

const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

// Ordered exactly like the overallStatus cascade in getTransactionFlows, so an
// SQL pre-filter can pick the SAME transactions whose *computed* status matches
// — a transaction has status X iff it has an event in X's set AND none from a
// higher-priority set. This is what makes the Status filter (and "manual
// assistance") work across ALL transactions instead of just the current page.
const TXN_STATUS_EVENT_SETS = [
  ['success', ['auth_success', 'manual_auth_success']],
  ['manual_assistance', ['manual_assistance_created']],
  ['auth_failed', ['auth_failed', 'case_creation_failed', 'manual_auth_failed']],
  ['payment_failed', ['payment_failed']],
  ['system_error', ['system_error']],
  ['handshake_failed', ['handshake_failed', 'handshake_error']],
  ['voucher_failed', ['voucher_claim_failed', 'voucher_service_error']],
  ['no_session', ['no_session_id']],
];

const _inSub = (types) =>
  `transaction_id IN (SELECT transaction_id FROM portal_audit_logs WHERE event_type IN (${types.map(() => '?').join(',')}))`;
const _notInSub = (types) =>
  `transaction_id NOT IN (SELECT transaction_id FROM portal_audit_logs WHERE event_type IN (${types.map(() => '?').join(',')}))`;

// Returns { sql, params } for a status value, or null when the status needs no
// SQL constraint. Kept in lock-step with the JS overallStatus cascade below.
function txnStatusFilterSql(status) {
  if (!status) return null;
  if (status === 'paid_unclaimed') {
    return { sql: `${_inSub(['payment_success'])} AND ${_notInSub(['voucher_claimed'])}`, params: ['payment_success', 'voucher_claimed'] };
  }
  if (status === 'in_progress') {
    const all = TXN_STATUS_EVENT_SETS.flatMap(([, t]) => t);
    return { sql: _notInSub(all), params: all };
  }
  const idx = TXN_STATUS_EVENT_SETS.findIndex(([k]) => k === status);
  if (idx === -1) return null;
  const own = TXN_STATUS_EVENT_SETS[idx][1];
  const higher = TXN_STATUS_EVENT_SETS.slice(0, idx).flatMap(([, t]) => t);
  return higher.length
    ? { sql: `${_inSub(own)} AND ${_notInSub(higher)}`, params: [...own, ...higher] }
    : { sql: _inSub(own), params: own };
}

export function makePortalConfigController(pool) {
  return {
    // GET /api/portal-config/plans
    getPlans: async (req, res) => {
      try {
        const { category, active, groupId, groupIds } = req.query;
        const where = [];
        const params = [];

        if (category) { where.push('p.category = ?'); params.push(category); }
        if (active !== undefined) { where.push('p.is_active = ?'); params.push(active === 'true' ? 1 : 0); }
        if (groupId) {
          where.push('p.group_id = ?');
          params.push(groupId);
        } else if (groupIds) {
          // Subset of villages — the admin's "All Villages" display filter with
          // some sites removed. Comma-separated group ids → p.group_id IN (...).
          const ids = String(groupIds).split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length) {
            where.push(`p.group_id IN (${ids.map(() => '?').join(',')})`);
            params.push(...ids);
          }
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [plans] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM vouchers v
             WHERE v.status = '1'
               AND v.disable_status = 0
               AND v.id NOT IN (
                 SELECT vc.voucher_id FROM voucher_claims vc
                 WHERE vc.status IN ('claimed','used','manually_assigned') AND vc.voucher_id IS NOT NULL
               )
               -- Match a voucher to this plan's user group by the Ruijie
               -- user_group_id when the voucher carries one (legacy API-synced),
               -- OR by (village group_id + group NAME) for Excel-synced vouchers,
               -- which have no user_group_id. The group_id keeps the count scoped
               -- to THIS village so same-named profiles in other villages don't
               -- inflate it.
               AND (
                 (v.user_group_id <> '' AND v.user_group_id COLLATE utf8mb4_0900_ai_ci = p.user_group_id COLLATE utf8mb4_0900_ai_ci)
                 OR (p.group_id IS NOT NULL
                     AND v.group_id COLLATE utf8mb4_0900_ai_ci = p.group_id COLLATE utf8mb4_0900_ai_ci
                     AND v.user_group_name COLLATE utf8mb4_0900_ai_ci = p.user_group_name COLLATE utf8mb4_0900_ai_ci)
               )
            ) AS available_vouchers
           FROM portal_plan_configs p
           ${whereClause}
           ORDER BY p.category, p.sort_order, p.name`,
          params
        );

        // Parse features JSON and map snake_case DB columns to camelCase for frontend
        const parsed = plans.map(p => ({
          ...p,
          features: typeof p.features === 'string' ? JSON.parse(p.features) : p.features,
          planKey: p.plan_key,
          userGroupId: p.user_group_id,
          userGroup: p.user_group_id,
          userGroupName: p.user_group_name,
          groupId: p.group_id,
          dataAllowance: p.data_allowance,
          sortOrder: p.sort_order,
          isActive: !!p.is_active,
          availableVouchers: p.available_vouchers,
        }));

        return send.ok(res, { plans: parsed, total: parsed.length });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/plans/:id
    getPlan: async (req, res) => {
      try {
        const [rows] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM vouchers v
             WHERE v.status = '1'
               AND v.disable_status = 0
               AND v.id NOT IN (
                 SELECT vc.voucher_id FROM voucher_claims vc
                 WHERE vc.status IN ('claimed','used','manually_assigned') AND vc.voucher_id IS NOT NULL
               )
               -- Match a voucher to this plan's user group by the Ruijie
               -- user_group_id when the voucher carries one (legacy API-synced),
               -- OR by (village group_id + group NAME) for Excel-synced vouchers,
               -- which have no user_group_id. The group_id keeps the count scoped
               -- to THIS village so same-named profiles in other villages don't
               -- inflate it.
               AND (
                 (v.user_group_id <> '' AND v.user_group_id COLLATE utf8mb4_0900_ai_ci = p.user_group_id COLLATE utf8mb4_0900_ai_ci)
                 OR (p.group_id IS NOT NULL
                     AND v.group_id COLLATE utf8mb4_0900_ai_ci = p.group_id COLLATE utf8mb4_0900_ai_ci
                     AND v.user_group_name COLLATE utf8mb4_0900_ai_ci = p.user_group_name COLLATE utf8mb4_0900_ai_ci)
               )
            ) AS available_vouchers
           FROM portal_plan_configs p WHERE p.id = ?`,
          [req.params.id]
        );
        if (!rows[0]) return send.notFound(res, 'Plan config not found');

        const plan = rows[0];
        plan.features = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
        plan.planKey = plan.plan_key;
        plan.userGroupId = plan.user_group_id;
        plan.userGroup = plan.user_group_id;
        plan.userGroupName = plan.user_group_name;
        plan.groupId = plan.group_id;
        plan.dataAllowance = plan.data_allowance;
        plan.sortOrder = plan.sort_order;
        plan.isActive = !!plan.is_active;
        plan.availableVouchers = plan.available_vouchers;
        return send.ok(res, { plan });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal-config/plans
    createPlan: async (req, res) => {
      try {
        console.log('[PortalConfig] createPlan received body:', JSON.stringify(req.body, null, 2));

        const {
          userGroupId, userGroup, userGroupName, groupId, planKey, name, category, price, currency,
          dataAllowance, icon, popular, description, features, sortOrder, isActive
        } = req.body;

        // Accept both userGroupId and userGroup (frontend sends userGroup)
        const resolvedUserGroupId = userGroupId || userGroup;
        // Site (Ruijie network group) this plan belongs to. Defaults to the
        // env site (site1) so single-site installs keep working.
        const resolvedGroupId = (groupId && String(groupId).trim()) || process.env.RUIJIE_GROUP_ID || null;

        // Detailed validation with specific error messages
        const missing = [];
        if (!resolvedUserGroupId) missing.push(`userGroupId/userGroup (got: userGroupId=${JSON.stringify(userGroupId)}, userGroup=${JSON.stringify(userGroup)})`);
        if (!planKey) missing.push(`planKey (got: ${JSON.stringify(planKey)})`);
        if (!name) missing.push(`name (got: ${JSON.stringify(name)})`);
        if (!category) missing.push(`category (got: ${JSON.stringify(category)})`);
        if (price === undefined || price === null || price === '') missing.push(`price (got: ${JSON.stringify(price)})`);
        if (features === undefined || features === null) missing.push(`features (got: ${JSON.stringify(features)})`);

        if (missing.length > 0) {
          console.log('[PortalConfig] createPlan validation failed. Missing fields:', missing);
          console.log('[PortalConfig] All body keys received:', Object.keys(req.body));
          return send.bad(res, `Missing required fields: ${missing.join(', ')}`);
        }

        // dataAllowance is optional — auto-derive from user group name if not provided
        const resolvedDataAllowance = dataAllowance || userGroupName || name || 'Standard';

        const [result] = await pool.query(
          `INSERT INTO portal_plan_configs
           (user_group_id, user_group_name, group_id, plan_key, name, category, price, currency,
            data_allowance, icon, popular, description, features, sort_order, is_active, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            resolvedUserGroupId, userGroupName || null, resolvedGroupId, planKey, name, category,
            price, currency || 'FJD', resolvedDataAllowance,
            icon || 'fas fa-calendar-day', popular || false,
            description || null, JSON.stringify(features || []),
            sortOrder || 0, isActive !== false ? 1 : 0, req.user.id,
          ]
        );

        const [rows] = await pool.query('SELECT * FROM portal_plan_configs WHERE id = ?', [result.insertId]);
        const plan = rows[0];
        plan.features = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
        plan.planKey = plan.plan_key;
        plan.userGroupId = plan.user_group_id;
        plan.userGroup = plan.user_group_id;
        plan.userGroupName = plan.user_group_name;
        plan.groupId = plan.group_id;
        plan.dataAllowance = plan.data_allowance;
        plan.sortOrder = plan.sort_order;
        plan.isActive = !!plan.is_active;

        return send.created(res, { success: true, plan });
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return send.bad(res, `Plan key already exists`);
        console.error(e); return send.serverErr(res);
      }
    },

    // PUT /api/portal-config/plans/:id
    updatePlan: async (req, res) => {
      try {
        console.log('[PortalConfig] updatePlan id:', req.params.id, 'body:', JSON.stringify(req.body, null, 2));

        const [existing] = await pool.query('SELECT * FROM portal_plan_configs WHERE id = ?', [req.params.id]);
        if (!existing[0]) return send.notFound(res, 'Plan config not found');

        // Normalize frontend field aliases before processing
        if (req.body.userGroup !== undefined && req.body.userGroupId === undefined) {
          req.body.userGroupId = req.body.userGroup;
        }

        const fields = [
          'user_group_id', 'user_group_name', 'group_id', 'plan_key', 'name', 'category', 'price', 'currency',
          'data_allowance', 'icon', 'popular', 'description', 'features', 'sort_order', 'is_active',
        ];
        const bodyMap = {
          user_group_id: 'userGroupId', user_group_name: 'userGroupName', plan_key: 'planKey', group_id: 'groupId',
          data_allowance: 'dataAllowance', sort_order: 'sortOrder', is_active: 'isActive',
        };

        const setClauses = [];
        const values = [];

        for (const field of fields) {
          const bodyKey = bodyMap[field] || field;
          if (req.body[bodyKey] !== undefined) {
            setClauses.push(`${field} = ?`);
            values.push(field === 'features' ? JSON.stringify(req.body[bodyKey]) : req.body[bodyKey]);
          }
        }

        if (setClauses.length === 0) return send.ok(res, { success: true, message: 'No changes' });

        setClauses.push('updated_by = ?');
        values.push(req.user.id);
        values.push(req.params.id);

        await pool.query(
          `UPDATE portal_plan_configs SET ${setClauses.join(', ')} WHERE id = ?`,
          values
        );

        const [rows] = await pool.query('SELECT * FROM portal_plan_configs WHERE id = ?', [req.params.id]);
        const plan = rows[0];
        plan.features = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
        plan.planKey = plan.plan_key;
        plan.userGroupId = plan.user_group_id;
        plan.userGroup = plan.user_group_id;
        plan.userGroupName = plan.user_group_name;
        plan.groupId = plan.group_id;
        plan.dataAllowance = plan.data_allowance;
        plan.sortOrder = plan.sort_order;
        plan.isActive = !!plan.is_active;

        return send.ok(res, { success: true, plan });
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return send.bad(res, `Plan key already exists`);
        console.error(e); return send.serverErr(res);
      }
    },

    // DELETE /api/portal-config/plans/:id
    deletePlan: async (req, res) => {
      try {
        const [existing] = await pool.query('SELECT * FROM portal_plan_configs WHERE id = ?', [req.params.id]);
        if (!existing[0]) return send.notFound(res, 'Plan config not found');

        await pool.query('DELETE FROM portal_plan_configs WHERE id = ?', [req.params.id]);
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // PUT /api/portal-config/plans/reorder
    reorderPlans: async (req, res) => {
      try {
        const { orders } = req.body;
        if (!Array.isArray(orders) || orders.length === 0) {
          return send.bad(res, 'orders array required');
        }

        for (const { id, sortOrder } of orders) {
          await pool.query('UPDATE portal_plan_configs SET sort_order = ?, updated_by = ? WHERE id = ?',
            [sortOrder, req.user.id, id]);
        }

        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/transaction-flows
    // Returns recent transactions with all their events grouped as a timeline
    getTransactionFlows: async (req, res) => {
      try {
        const { page, limit, transactionId, sessionId, status, voucherCode, phone, startDate, endDate } = req.query;
        const pg = parseInt(page) || 1;
        const lim = Math.min(parseInt(limit) || 30, 100);
        const offset = (pg - 1) * lim;

        // Step 1: get distinct transaction IDs matching filters
        const where = ['transaction_id IS NOT NULL'];
        const params = [];

        if (transactionId) { where.push('transaction_id LIKE ?'); params.push(`%${transactionId}%`); }
        if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
        if (startDate) { where.push('event_timestamp >= ?'); params.push(startDate); }
        if (endDate) { where.push('event_timestamp <= ?'); params.push(endDate); }
        // Search by voucher code — a txn matches if ANY of its events carries it.
        if (voucherCode) {
          where.push('transaction_id IN (SELECT transaction_id FROM portal_audit_logs WHERE voucher_code LIKE ? AND transaction_id IS NOT NULL)');
          params.push(`%${voucherCode}%`);
        }
        // Search by M-PAiSA payer phone — a txn matches if ANY event carries it.
        if (phone) {
          where.push('transaction_id IN (SELECT transaction_id FROM portal_audit_logs WHERE customer_phone LIKE ? AND transaction_id IS NOT NULL)');
          params.push(`%${phone}%`);
        }
        // Status filter applied in SQL (not post-pagination) so it spans ALL
        // transactions and the count/pages are correct — this is what makes the
        // "manual assistance" (and every other status) filter actually work.
        const sf = txnStatusFilterSql(status);
        if (sf) { where.push(`(${sf.sql})`); params.push(...sf.params); }

        const whereClause = `WHERE ${where.join(' AND ')}`;

        // Get count of distinct transactions
        const [[countRow]] = await pool.query(
          `SELECT COUNT(DISTINCT transaction_id) AS total FROM portal_audit_logs ${whereClause}`, params
        );

        // Get paginated distinct transaction IDs (ordered by latest event)
        const [txnRows] = await pool.query(
          `SELECT transaction_id,
                  MIN(event_timestamp) AS started_at,
                  MAX(event_timestamp) AS last_event_at,
                  MAX(session_id) AS session_id,
                  MAX(plan_key) AS plan_key,
                  MAX(customer_phone) AS customer_phone,
                  MAX(amount) AS amount,
                  MAX(voucher_code) AS voucher_code,
                  COUNT(*) AS event_count
           FROM portal_audit_logs ${whereClause}
           GROUP BY transaction_id
           ORDER BY MAX(event_timestamp) DESC
           LIMIT ? OFFSET ?`,
          [...params, lim, offset]
        );

        if (txnRows.length === 0) {
          return send.ok(res, { transactions: [], total: countRow.total, page: pg, limit: lim, totalPages: Math.ceil(countRow.total / lim) });
        }

        // Step 2: fetch all events for these transactions
        const txnIds = txnRows.map(r => r.transaction_id);
        const placeholders = txnIds.map(() => '?').join(',');
        const [allEvents] = await pool.query(
          `SELECT * FROM portal_audit_logs
           WHERE transaction_id IN (${placeholders})
           ORDER BY event_timestamp ASC`,
          txnIds
        );

        // Parse event_data safely
        const parsedEvents = allEvents.map(e => {
          let eventData = e.event_data;
          if (typeof eventData === 'string') {
            try { eventData = JSON.parse(eventData); } catch { /* keep */ }
          }
          return { ...e, event_data: eventData };
        });

        // Step 3: group events by transaction_id
        const eventsMap = {};
        for (const ev of parsedEvents) {
          if (!eventsMap[ev.transaction_id]) eventsMap[ev.transaction_id] = [];
          eventsMap[ev.transaction_id].push(ev);
        }

        // Step 4: determine overall status for each transaction
        const transactions = txnRows.map(txn => {
          const events = eventsMap[txn.transaction_id] || [];
          const eventTypes = events.map(e => e.event_type);

          let overallStatus = 'in_progress';
          if (eventTypes.includes('auth_success') || eventTypes.includes('manual_auth_success')) overallStatus = 'success';
          else if (eventTypes.includes('manual_assistance_created')) overallStatus = 'manual_assistance';
          else if (eventTypes.includes('auth_failed') || eventTypes.includes('case_creation_failed') || eventTypes.includes('manual_auth_failed')) overallStatus = 'auth_failed';
          else if (eventTypes.includes('payment_failed')) overallStatus = 'payment_failed';
          else if (eventTypes.includes('system_error')) overallStatus = 'system_error';
          else if (eventTypes.includes('handshake_failed') || eventTypes.includes('handshake_error')) overallStatus = 'handshake_failed';
          else if (eventTypes.includes('voucher_claim_failed') || eventTypes.includes('voucher_service_error')) overallStatus = 'voucher_failed';
          else if (eventTypes.includes('no_session_id')) overallStatus = 'no_session';

          // Payment ↔ voucher lifecycle: paid = money received; claimed = a
          // voucher was assigned. paidUnclaimed = the customer PAID but no
          // voucher was ever claimed — the case to flag (they're owed a voucher
          // and it's the gap behind "sold count ≠ paid count").
          const paid = eventTypes.includes('payment_success');
          const claimed = eventTypes.includes('voucher_claimed');
          const claimEv = events.find((e) => e.event_type === 'voucher_claimed');
          const voucherCode = claimEv?.voucher_code || txn.voucher_code || null;
          const paidUnclaimed = paid && !claimed;

          return {
            transactionId: txn.transaction_id,
            sessionId: txn.session_id,
            planKey: txn.plan_key,
            customerPhone: txn.customer_phone,
            amount: txn.amount,
            startedAt: txn.started_at,
            lastEventAt: txn.last_event_at,
            eventCount: txn.event_count,
            overallStatus,
            paid,
            claimed,
            voucherCode,
            paidUnclaimed,
            events,
          };
        });

        // Optional: filter by computed status ("paid_unclaimed" is a virtual
        // filter over the paid-but-no-voucher flag, not an overallStatus value).
        let filtered = transactions;
        if (status === 'paid_unclaimed') {
          filtered = transactions.filter((t) => t.paidUnclaimed);
        } else if (status) {
          filtered = transactions.filter((t) => t.overallStatus === status);
        }

        return send.ok(res, {
          transactions: filtered,
          total: countRow.total,
          page: pg,
          limit: lim,
          totalPages: Math.ceil(countRow.total / lim),
        });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/audit-logs
    getAuditLogs: async (req, res) => {
      try {
        const { page, limit, eventType, transactionId, sessionId, startDate, endDate } = req.query;
        const pg = parseInt(page) || 1;
        const lim = Math.min(parseInt(limit) || 50, 200);
        const offset = (pg - 1) * lim;

        const where = [];
        const params = [];

        if (eventType) { where.push('event_type = ?'); params.push(eventType); }
        if (transactionId) { where.push('transaction_id = ?'); params.push(transactionId); }
        if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
        if (startDate) { where.push('event_timestamp >= ?'); params.push(startDate); }
        if (endDate) { where.push('event_timestamp <= ?'); params.push(endDate); }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [[countRow]] = await pool.query(
          `SELECT COUNT(*) AS total FROM portal_audit_logs ${whereClause}`, params
        );
        const [logs] = await pool.query(
          `SELECT * FROM portal_audit_logs ${whereClause} ORDER BY event_timestamp DESC LIMIT ? OFFSET ?`,
          [...params, lim, offset]
        );

        // Parse event_data JSON (safe — never crashes on malformed data)
        const parsed = logs.map(l => {
          let eventData = l.event_data;
          if (typeof eventData === 'string') {
            try { eventData = JSON.parse(eventData); } catch { /* keep as string */ }
          }
          return { ...l, event_data: eventData };
        });

        return send.ok(res, {
          logs: parsed,
          total: countRow.total,
          page: pg,
          limit: lim,
          totalPages: Math.ceil(countRow.total / lim),
        });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/revenue?groupId=XXXX
    // Sales revenue aggregated from SUCCESSFUL (auth_success) transactions in
    // portal_audit_logs, mapped to a village via plan_key -> plan.group_id.
    // Returns total / this-month / today + per-village + a 6-month trend.
    getRevenue: async (req, res) => {
      try {
        const groupId = req.query.groupId ? String(req.query.groupId) : null;
        // Viewer scope: only count revenue for the viewer's assigned villages.
        // Empty set -> nothing matches -> zeroed totals (never all villages).
        const scope = req.scope || { isViewer: false };
        const allowedGroups = scope.isViewer ? new Set((scope.groupIds || []).map(String)) : null;

        // One row per PAID transaction: amount, when, which plan. Revenue is
        // money RECEIVED (payment_success / M-PAiSA callback), NOT internet
        // access (auth_success). Keying on auth_success silently dropped every
        // "paid but auth failed" case — real money that never reconciled and
        // made revenue look frozen while those cases piled up. We also stamp the
        // revenue timestamp from the payment event so date buckets are accurate.
        const [txns] = await pool.query(
          `SELECT tx.amount, tx.ts, tx.plan_key, tx.user_group_id
             FROM (
               SELECT transaction_id,
                      MAX(amount)          AS amount,
                      MAX(CASE WHEN event_type = 'payment_success' THEN event_timestamp END) AS ts,
                      MAX(plan_key)        AS plan_key,
                      MAX(user_group_id)   AS user_group_id,
                      SUM(CASE WHEN event_type = 'payment_success' THEN 1 ELSE 0 END) AS paid
                 FROM portal_audit_logs
                WHERE transaction_id IS NOT NULL
                GROUP BY transaction_id
             ) tx
            WHERE tx.paid > 0 AND tx.amount IS NOT NULL AND tx.amount > 0`
        );

        // plan_key / user_group_id -> village ruijie group_id
        const [plans] = await pool.query(
          `SELECT plan_key, group_id, user_group_id FROM portal_plan_configs`
        );
        const byPlan = {}, byUserGroup = {};
        for (const p of plans) {
          if (p.plan_key) byPlan[p.plan_key] = p.group_id || null;
          if (p.user_group_id) byUserGroup[String(p.user_group_id)] = p.group_id || null;
        }
        const resolveGroup = (t) =>
          byPlan[t.plan_key] ?? byUserGroup[String(t.user_group_id)] ?? null;

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const mKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const months = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({ key: mKey(d), label: d.toLocaleString("en", { month: "short" }), revenue: 0, count: 0 });
        }
        const mIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));

        let total = 0, totalCount = 0, month = 0, monthCount = 0, today = 0, todayCount = 0;
        const perSite = {};

        for (const t of txns) {
          const grp = resolveGroup(t);
          if (groupId && String(grp) !== String(groupId)) continue;
          if (allowedGroups && !allowedGroups.has(String(grp))) continue; // viewer scope
          const amt = Number(t.amount) || 0;
          const ts = t.ts ? new Date(t.ts) : null;
          total += amt; totalCount++;
          if (ts && ts >= startOfMonth) { month += amt; monthCount++; }
          if (ts && ts >= startOfDay) { today += amt; todayCount++; }
          const key = grp == null ? "unassigned" : String(grp);
          if (!perSite[key]) perSite[key] = { groupId: grp, revenue: 0, count: 0, month: 0, monthCount: 0 };
          perSite[key].revenue += amt; perSite[key].count++;
          if (ts && ts >= startOfMonth) { perSite[key].month += amt; perSite[key].monthCount++; }
          if (ts) {
            const mk = mKey(new Date(ts.getFullYear(), ts.getMonth(), 1));
            if (mk in mIdx) { months[mIdx[mk]].revenue += amt; months[mIdx[mk]].count++; }
          }
        }

        return send.ok(res, {
          total, totalCount, month, monthCount, today, todayCount,
          perSite: Object.values(perSite),
          monthly: months,
          groupId,
        });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/breakdown?month=YYYY-MM&groupId=XXXX
    //
    // Everything about ONE month, in one call. Aggregated from
    // portal_audit_logs (money + outcomes) joined to portal_plan_configs for
    // plan/village identity, plus voucher_claims for units sold.
    //
    // Deliberately two-stage: the inner query picks the transaction_ids whose
    // payment_success falls inside the window, then the outer one rolls up ALL
    // rows of just those transactions. Filtering event_timestamp in the outer
    // GROUP BY instead would drop the sibling rows that carry amount/plan_key,
    // silently under-reporting revenue.
    getBreakdown: async (req, res) => {
      try {
        // Village scope. Three independent narrowings, INTERSECTED - this used
        // to honour only `groupId` and the viewer's own list, which meant the
        // global dashboard ignored the "All Villages" set from Settings and
        // every figure below the fold counted all 33 villages while the cards
        // above it counted the selected ones.
        //   groupId  - scope switcher pinned to one village
        //   groupIds - the "All Villages" set (csv). PRESENT BUT EMPTY means no
        //              village is in scope, which must read as zeroes, not as
        //              "no filter" - hence the `!== undefined` test.
        //   req.scope- a viewer's permitted villages
        const scope = req.scope || { isViewer: false };
        const narrow = (set, list) => {
          const next = new Set(list.map(String).filter(Boolean));
          return set ? new Set([...next].filter((g) => set.has(g))) : next;
        };
        let allowed = null; // null = every village
        if (req.query.groupId) allowed = narrow(allowed, [String(req.query.groupId)]);
        if (req.query.groupIds !== undefined) {
          allowed = narrow(allowed, String(req.query.groupIds).split(','));
        }
        if (scope.isViewer) allowed = narrow(allowed, scope.groupIds || []);

        // Which months actually have sales — drives the picker so it can never
        // offer a month that renders empty.
        const [monthRows] = await pool.query(
          `SELECT DATE_FORMAT(event_timestamp, '%Y-%m') AS month, COUNT(*) AS txns
             FROM portal_audit_logs
            WHERE event_type = 'payment_success' AND transaction_id IS NOT NULL
            GROUP BY month ORDER BY month DESC`
        );
        const months = monthRows.map((r) => ({ month: r.month, txns: Number(r.txns) }));

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        // The window being reported on. `range` gives the three moving presets,
        // `month` a fixed calendar month; anything unrecognised falls back to
        // the newest month with sales, which is the original behaviour.
        const range = String(req.query.range || '').toLowerCase();
        const monthParam = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : null;
        let selection, from, to, bucket;
        if (range === 'all') {
          selection = 'all';
          bucket = 'month';
          const oldest = months.length ? months[months.length - 1].month : ym(now);
          const [oy, om] = oldest.split('-').map(Number);
          from = new Date(oy, om - 1, 1);
          to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else if (range === 'week') {
          selection = 'week';
          bucket = 'day';
          // The last 7 days INCLUDING today, so the current day is never a
          // half-empty bar hanging off the end.
          to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 7);
        } else if (range === 'month') {
          selection = 'month';
          bucket = 'day';
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else {
          selection = monthParam || months[0]?.month || ym(now);
          bucket = 'day';
          const [yy, mm] = selection.split('-').map(Number);
          from = new Date(yy, mm - 1, 1);
          to = new Date(yy, mm, 1);
        }

        // Nothing in scope: answer in the normal shape with zeroes, but keep the
        // month list so the picker still works.
        if (allowed && allowed.size === 0) {
          return send.ok(res, {
            month: selection, selection, months, dailyUnit: bucket,
            fromDate: ymd(from), toDate: ymd(new Date(to.getTime() - 1)),
            // Fully zeroed rather than {} so every card reads 0 instead of
            // formatting an undefined.
            totals: {
              revenue: 0, transactions: 0, customers: 0, avgSale: 0, connected: 0,
              connectedPct: 0, manualCases: 0, paidNoVoucher: 0, revenueAtRisk: 0, sold: 0,
            },
            daily: [], byPlan: [], byVillage: [], byHour: [], outcomes: [], soldByPlan: [],
          });
        }

        const [txns] = await pool.query(
          `SELECT l.transaction_id,
                  MAX(l.amount)        AS amount,
                  MAX(CASE WHEN l.event_type='payment_success' THEN l.event_timestamp END) AS ts,
                  MAX(l.plan_key)      AS plan_key,
                  MAX(l.user_group_id) AS user_group_id,
                  MAX(l.customer_phone) AS customer_phone,
                  MAX(l.event_type='voucher_claimed')             AS has_voucher,
                  MAX(l.event_type='auth_success')                AS has_auth,
                  MAX(l.event_type='manual_assistance_created')   AS has_manual
             FROM portal_audit_logs l
             JOIN (SELECT DISTINCT transaction_id
                     FROM portal_audit_logs
                    WHERE event_type='payment_success' AND transaction_id IS NOT NULL
                      AND event_timestamp >= ? AND event_timestamp < ?) w
               ON w.transaction_id = l.transaction_id
            GROUP BY l.transaction_id`,
          [from, to]
        );

        // Same plan_key/user_group_id -> village resolution the dashboard uses,
        // so these numbers agree with it instead of quietly diverging.
        const [plans] = await pool.query(
          `SELECT plan_key, name, group_id, user_group_id FROM portal_plan_configs`
        );
        const byPlanKey = {}, byUserGroup = {}, planName = {};
        for (const p of plans) {
          if (p.plan_key) { byPlanKey[p.plan_key] = p.group_id || null; planName[p.plan_key] = p.name || p.plan_key; }
          if (p.user_group_id) byUserGroup[String(p.user_group_id)] = p.group_id || null;
        }
        const resolveGroup = (t) => byPlanKey[t.plan_key] ?? byUserGroup[String(t.user_group_id)] ?? null;

        const [projects] = await pool.query(`SELECT name, ruijie_group_id FROM network_projects`);
        const villageName = Object.fromEntries(projects.filter((p) => p.ruijie_group_id).map((p) => [String(p.ruijie_group_id), p.name]));

        // Bucket the series over the WINDOW, not over a fixed calendar month:
        // "this week" can straddle two months and "all time" spans years, so the
        // old day-of-month indexing would have silently dropped or collided
        // points. Days are labelled bare ("14") within a single month and dated
        // ("14 Aug") when the window crosses one.
        const daily = [];
        const bucketAt = new Map();
        if (bucket === 'month') {
          for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
            bucketAt.set(ym(d), daily.length);
            daily.push({ d: `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, revenue: 0, count: 0 });
          }
        } else {
          const last = new Date(to.getTime() - 1);
          const oneMonth = from.getFullYear() === last.getFullYear() && from.getMonth() === last.getMonth();
          for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
            bucketAt.set(ymd(d), daily.length);
            daily.push({ d: oneMonth ? String(d.getDate()) : `${d.getDate()} ${MON[d.getMonth()]}`, revenue: 0, count: 0 });
          }
        }
        const byHour = Array.from({ length: 24 }, (_, h) => ({ h: String(h).padStart(2, '0'), count: 0, revenue: 0 }));
        const planAgg = {}, villageAgg = {};
        const phones = new Set();
        let revenue = 0, count = 0, connected = 0, manual = 0, noVoucher = 0, atRisk = 0;

        for (const t of txns) {
          const grp = resolveGroup(t);
          if (allowed && !allowed.has(String(grp))) continue;
          const amt = Number(t.amount) || 0;
          if (!(amt > 0)) continue;
          const ts = t.ts ? new Date(t.ts) : null;
          revenue += amt; count++;
          if (t.customer_phone) phones.add(String(t.customer_phone));
          if (Number(t.has_auth)) connected++; else atRisk += amt;
          if (Number(t.has_manual)) manual++;
          if (!Number(t.has_voucher)) noVoucher++;
          if (ts) {
            const bi = bucketAt.get(bucket === 'month' ? ym(ts) : ymd(ts));
            if (bi !== undefined) { daily[bi].revenue += amt; daily[bi].count++; }
            const hi = ts.getHours();
            byHour[hi].count++; byHour[hi].revenue += amt;
          }
          const pk = t.plan_key || 'unknown';
          const pn = planName[pk] || pk;
          if (!planAgg[pn]) planAgg[pn] = { name: pn, revenue: 0, count: 0 };
          planAgg[pn].revenue += amt; planAgg[pn].count++;
          const vk = grp == null ? 'unassigned' : String(grp);
          if (!villageAgg[vk]) villageAgg[vk] = { groupId: grp, name: villageName[vk] || (grp ? `Group ${grp}` : 'Unassigned'), revenue: 0, count: 0 };
          villageAgg[vk].revenue += amt; villageAgg[vk].count++;
        }

        // What happened across the whole window, money or not — the failure
        // types are as interesting as the successes. Grouped by the same
        // plan/user-group keys the village resolution uses so this narrows with
        // the rest of the page; it used to count every village unconditionally.
        //
        // Attribution is per TRANSACTION, not per row. Most audit rows carry no
        // plan_key of their own — manual_assistance_resolved and token_mismatch
        // write neither plan_key nor user_group_id — so judging each row alone
        // would resolve them to no village and drop them from every scoped view,
        // turning those counts into a structural zero. The derived table repeats
        // the MAX() rollup the money query already uses so a bare row inherits
        // its transaction's village.
        //
        // The third COALESCE arm is for the email events: emailLog.js has no
        // group_id column to write to, so it puts the VILLAGE id in
        // user_group_id, which no plan config will ever match.
        //
        // COLLATE on both joins because portal_audit_logs and
        // portal_plan_configs do not share one.
        const [eventRows] = await pool.query(
          `SELECT l.event_type,
                  COALESCE(pk.group_id      COLLATE utf8mb4_unicode_ci,
                           pu.group_id      COLLATE utf8mb4_unicode_ci,
                           t.user_group_id  COLLATE utf8mb4_unicode_ci) AS grp,
                  COUNT(*) AS c
             FROM portal_audit_logs l
             LEFT JOIN (
                   SELECT transaction_id,
                          MAX(plan_key)      AS plan_key,
                          MAX(user_group_id) AS user_group_id
                     FROM portal_audit_logs
                    WHERE transaction_id IS NOT NULL
                      AND event_timestamp >= ? AND event_timestamp < ?
                    GROUP BY transaction_id
                 ) t ON t.transaction_id = l.transaction_id
             LEFT JOIN portal_plan_configs pk
                    ON pk.plan_key COLLATE utf8mb4_unicode_ci = t.plan_key COLLATE utf8mb4_unicode_ci
             LEFT JOIN portal_plan_configs pu
                    ON pu.user_group_id COLLATE utf8mb4_unicode_ci = t.user_group_id COLLATE utf8mb4_unicode_ci
            WHERE l.event_timestamp >= ? AND l.event_timestamp < ?
            GROUP BY l.event_type, grp`,
          [from, to, from, to]
        );
        const outcomeAgg = {};
        for (const e of eventRows) {
          const grp = e.grp == null ? null : String(e.grp);
          // An event that resolves to NO village (a process-level system_error
          // with no transaction at all) belongs to none of them, so it is shown
          // in every scope rather than hidden from all of them.
          if (allowed && grp != null && !allowed.has(grp)) continue;
          outcomeAgg[e.event_type] = (outcomeAgg[e.event_type] || 0) + Number(e.c);
        }
        const events = Object.entries(outcomeAgg)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count);

        // Units sold, straight from the claim ledger (one row per purchase).
        const allowedList = allowed ? [...allowed] : null;
        const [claims] = await pool.query(
          `SELECT pc.name AS plan, COUNT(*) AS sold
             FROM voucher_claims vc
             JOIN portal_plan_configs pc ON pc.id = vc.plan_config_id
            WHERE vc.claimed_at >= ? AND vc.claimed_at < ?
              AND vc.status IN ('claimed','used','manually_assigned')
              ${allowedList ? 'AND pc.group_id IN (?)' : ''}
            GROUP BY pc.name ORDER BY sold DESC`,
          allowedList ? [from, to, allowedList] : [from, to]
        );

        const round = (n) => Math.round(n * 100) / 100;
        return send.ok(res, {
          month: selection, // legacy name; 'all' | 'week' | 'month' | 'YYYY-MM'
          selection,
          months,
          dailyUnit: bucket,
          fromDate: ymd(from),
          toDate: ymd(new Date(to.getTime() - 1)),
          totals: {
            revenue: round(revenue),
            transactions: count,
            customers: phones.size,
            avgSale: count ? round(revenue / count) : 0,
            connected,
            connectedPct: count ? Math.round((connected / count) * 100) : 0,
            manualCases: manual,
            paidNoVoucher: noVoucher,
            revenueAtRisk: round(atRisk),
            sold: claims.reduce((a, c) => a + Number(c.sold), 0),
          },
          daily: daily.map((d) => ({ ...d, revenue: round(d.revenue) })),
          byHour,
          byPlan: Object.values(planAgg).sort((a, b) => b.revenue - a.revenue).map((p) => ({ ...p, revenue: round(p.revenue) })),
          byVillage: Object.values(villageAgg).sort((a, b) => b.revenue - a.revenue).map((v) => ({ ...v, revenue: round(v.revenue) })),
          outcomes: events,
          soldByPlan: claims.map((c) => ({ name: c.plan, sold: Number(c.sold) })),
        });
      } catch (e) { console.error('[breakdown]', e); return send.serverErr(res); }
    },

    // GET /api/portal-config/manual-assistance?status=open|resolved|all
    // A "manual assistance" case = a transaction that has a
    // manual_assistance_created audit event (paid but Ruijie auth failed). It's
    // "resolved" once a manual_assistance_resolved event exists for it. The
    // reserved voucher (from the keep-voucher change) is the code to hand over.
    getManualAssistance: async (req, res) => {
      try {
        const status = req.query.status || 'open';
        const [rows] = await pool.query(`
          SELECT tx.*, pc.name AS plan_name
          FROM (
            SELECT transaction_id,
                   MAX(customer_phone) AS customer_phone,
                   MAX(amount) AS amount,
                   MAX(plan_key) AS plan_key,
                   MAX(voucher_code) AS voucher_code,
                   MAX(session_id) AS session_id,
                   MIN(CASE WHEN event_type='manual_assistance_created' THEN event_timestamp END) AS created_at,
                   MAX(CASE WHEN event_type='manual_assistance_resolved' THEN 1 ELSE 0 END) AS resolved,
                   MAX(CASE WHEN event_type='manual_assistance_resolved' THEN event_timestamp END) AS resolved_at
            FROM portal_audit_logs
            WHERE transaction_id IS NOT NULL
            GROUP BY transaction_id
            HAVING SUM(CASE WHEN event_type='manual_assistance_created' THEN 1 ELSE 0 END) > 0
          ) tx
          LEFT JOIN portal_plan_configs pc
            ON pc.plan_key COLLATE utf8mb4_unicode_ci = tx.plan_key COLLATE utf8mb4_unicode_ci
          ORDER BY tx.resolved ASC, tx.created_at DESC
        `);
        // Which of these customers we can email their code to. Resolved in ONE
        // pass over mpaisa_mappings rather than a per-case subquery: RIGHT() can
        // never use the index either way, so this keeps it to a single scan no
        // matter how many cases are open (the list is unbounded). Last 7 digits
        // is the tolerant match — bare, trunk-0 and 679-prefixed forms all agree
        // there. Display only; the send path re-resolves authoritatively.
        const last7 = (p) => {
          const d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
          return d.length > 7 ? d.slice(-7) : d;
        };
        const keys = [...new Set(rows.map((r) => last7(r.customer_phone)).filter(Boolean))];
        const emailByPhone = new Map();
        if (keys.length) {
          const [mm] = await pool.query(
            'SELECT RIGHT(number, 7) AS k, email FROM mpaisa_mappings WHERE RIGHT(number, 7) IN (?)',
            [keys]
          );
          for (const m of mm) if (!emailByPhone.has(m.k)) emailByPhone.set(m.k, m.email);
        }

        const cases = rows.map((r) => ({
          transactionId: r.transaction_id,
          customerPhone: r.customer_phone,
          amount: r.amount,
          planKey: r.plan_key,
          planName: r.plan_name || r.plan_key || null,
          voucherCode: r.voucher_code,
          customerEmail: emailByPhone.get(last7(r.customer_phone)) || null,
          sessionId: r.session_id,
          createdAt: r.created_at,
          resolved: !!r.resolved,
          resolvedAt: r.resolved_at,
        }));
        const unresolvedCount = cases.filter((c) => !c.resolved).length;
        const filtered =
          status === 'all' ? cases
          : status === 'resolved' ? cases.filter((c) => c.resolved)
          : cases.filter((c) => !c.resolved);
        return send.ok(res, { cases: filtered, unresolvedCount, total: cases.length });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal-config/manual-assistance/:transactionId/resolve
    resolveManualAssistance: async (req, res) => {
      const transactionId = req.params.transactionId;
      if (!transactionId) return send.bad(res, 'transactionId is required');
      try {
        const [[dup]] = await pool.query(
          `SELECT COUNT(*) AS n FROM portal_audit_logs WHERE transaction_id = ? AND event_type = 'manual_assistance_resolved'`,
          [transactionId]
        );
        if (!dup.n) {
          await pool.query(
            `INSERT INTO portal_audit_logs (event_type, transaction_id, event_data, source_ip, event_timestamp)
             VALUES ('manual_assistance_resolved', ?, ?, 'admin-ui', NOW())`,
            [transactionId, JSON.stringify({ resolvedBy: req.user?.email || 'admin', resolvedAt: new Date().toISOString() })]
          );
        }
        return send.ok(res, { success: true });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // POST /api/portal-config/manual-assistance/:transactionId/email { email? }
    // Emails the reserved voucher code to the customer.
    //
    // Admin-triggered rather than automatic on resolve: support usually reads the
    // code out over the phone first, and "sorted" can be reached several ways, so
    // firing on resolve would send mail nobody asked for. Sending does NOT resolve
    // the case either - the two actions stay independent.
    //
    // `email` in the body overrides the M-PAiSA mapping, which is what makes this
    // usable for the many cases that have no mapping row at all.
    emailManualAssistance: async (req, res) => {
      const transactionId = req.params.transactionId;
      if (!transactionId) return send.bad(res, 'transactionId is required');
      const override = String(req.body?.email || '').trim();
      if (override && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(override)) {
        return send.bad(res, 'Enter a valid email address.');
      }
      const sentBy = req.user?.email || 'admin';
      try {
        // Rebuild the case from its audit trail - same aggregate the list uses.
        // No GROUP BY, so an unknown transaction still returns one all-NULL row
        // and is_case tells us it was never a manual-assistance case.
        const [[c]] = await pool.query(
          `SELECT MAX(customer_phone) AS customer_phone,
                  MAX(amount)         AS amount,
                  MAX(plan_key)       AS plan_key,
                  MAX(voucher_code)   AS voucher_code,
                  SUM(CASE WHEN event_type = 'manual_assistance_created' THEN 1 ELSE 0 END) AS is_case
             FROM portal_audit_logs WHERE transaction_id = ?`,
          [transactionId]
        );
        if (!c || !Number(c.is_case)) {
          return send.notFound(res, 'No manual assistance case for that transaction.');
        }
        const voucherCode = c.voucher_code;
        if (!voucherCode) {
          return send.bad(res, 'This case has no reserved voucher code yet - there is nothing to send.');
        }

        // Recipient: the address the admin typed, else the M-PAiSA mapping.
        // Normalise BOTH sides (same rule as the purchase receipt) so a stored
        // number carrying a trunk 0 or a 679 is still reachable from the bare
        // 7-digit number the portal records.
        let email = override;
        if (!email) {
          const digits = String(c.customer_phone || '').replace(/\D/g, '');
          if (digits) {
            let core = digits.replace(/^0+/, '');
            if (core.length > 7 && core.startsWith('679')) core = core.slice(3);
            const last7 = core.length > 7 ? core.slice(-7) : core;
            const [mr] = await pool.query(
              `SELECT email FROM mpaisa_mappings
                WHERE number = ? OR number = ? OR RIGHT(number, 7) = ?
                ORDER BY (number = ?) DESC LIMIT 1`,
              [digits, core, last7, core]
            );
            email = mr[0]?.email || '';
          }
        }
        if (!email) {
          return send.bad(res, 'No email on file for this number. Enter an address to send to, or add one under M-PAiSA Mapping.');
        }

        // Plan wording and the village status URL, both best-effort: a missing
        // one drops that block from the email rather than failing the send.
        const [[pc]] = await pool.query(
          `SELECT name, data_allowance FROM portal_plan_configs
            WHERE plan_key COLLATE utf8mb4_unicode_ci = ? LIMIT 1`,
          [c.plan_key || '']
        );
        const [[vr]] = await pool.query(
          'SELECT group_id FROM vouchers WHERE voucher_code = ? LIMIT 1', [voucherCode]
        );
        let statusUrl = null;
        if (vr?.group_id) {
          const [[np]] = await pool.query(
            'SELECT hostname FROM network_projects WHERE ruijie_group_id = ? LIMIT 1', [vr.group_id]
          );
          // Deep-linked to this voucher — see the note in portalApiController.
          if (np?.hostname) statusUrl = `https://${np.hostname}/status/${encodeURIComponent(voucherCode)}`;
        }

        const smtp = await loadSmtpTransport(pool);
        if (!smtp) return send.bad(res, 'Save SMTP settings first - no mail host is configured.');

        const mail = buildManualAssist({
          voucherCode, statusUrl,
          planName: pc?.name || c.plan_key || null,
          dataAllowance: pc?.data_allowance || null,
          amount: c.amount,
        });
        // The template carries the team bcc. Drop it only when it would send the
        // recipient a duplicate of their own email.
        const bcc = mail.bcc && mail.bcc.toLowerCase() !== email.toLowerCase() ? mail.bcc : undefined;
        const base = {
          transactionId, voucherCode, phone: c.customer_phone || null,
          amount: c.amount, groupId: vr?.group_id || null,
          template: 'manual_assist', sentBy,
        };

        try {
          await smtp.transport.sendMail({
            from: smtp.from, to: email, bcc,
            subject: mail.subject, text: mail.text, html: mail.html,
            attachments: mail.attachments,
          });
        } catch (sendErr) {
          console.error('[manual-assist] SMTP send failed:', sendErr.message);
          logEmailEvent(pool, {
            eventType: 'manual_assist_email_failed', status: 'failed', reason: 'send_error',
            to: email, subject: mail.subject,
            message: `Voucher email failed to ${email}`, error: sendErr.message, ...base,
          });
          return res.status(502).json({ error: sendErr.message || 'SMTP send failed' });
        }

        logEmailEvent(pool, {
          eventType: 'manual_assist_email_sent', status: 'sent',
          to: email, subject: mail.subject,
          message: `Voucher ${voucherCode} emailed to ${email}${bcc ? ` (bcc ${bcc})` : ''}`,
          ...base,
        });
        return send.ok(res, { success: true, to: email, bcc: bcc || null });
      } catch (e) { console.error(e); return send.serverErr(res); }
    },

    // GET /api/portal-config/email-preview/:logId
    // Shows exactly what a customer was sent, for one `*_email_sent` audit row.
    //
    // The HTML is RE-RENDERED from that row rather than stored: emails are a few
    // KB of markup each and archiving them would bloat the audit table for no
    // gain. The row carries the identity that matters — the voucher code that
    // was in that email — so the preview is pinned to it and can never show a
    // different, later voucher for the same customer.
    getEmailPreview: async (req, res) => {
      const logId = Number(req.params.logId);
      if (!Number.isFinite(logId)) return send.bad(res, 'A numeric log id is required');
      try {
        const [[row]] = await pool.query(
          `SELECT id, event_type, transaction_id, voucher_code, amount, user_group_id,
                  customer_phone, event_data, event_timestamp
             FROM portal_audit_logs WHERE id = ? LIMIT 1`,
          [logId]
        );
        if (!row) return send.notFound(res, 'No such log entry');
        if (!/_email_sent$/.test(row.event_type)) {
          return send.bad(res, 'That log entry is not a sent email');
        }
        let meta = row.event_data;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
        meta = meta || {};

        const template = meta.template === 'manual_assist' ? 'manual_assist' : 'receipt';
        // Pinned to the voucher recorded ON THIS ROW.
        const voucherCode = row.voucher_code || null;

        // Plan wording comes from the transaction's own plan_key; the amount and
        // village from the row. All best-effort — a missing piece just drops that
        // block, exactly as it would have on the original send.
        let planName = null, dataAllowance = null;
        if (row.transaction_id) {
          const [[pk]] = await pool.query(
            `SELECT MAX(plan_key) AS plan_key FROM portal_audit_logs WHERE transaction_id = ?`,
            [row.transaction_id]
          );
          if (pk?.plan_key) {
            const [[plan]] = await pool.query(
              `SELECT name, data_allowance FROM portal_plan_configs
                WHERE plan_key COLLATE utf8mb4_unicode_ci = ? LIMIT 1`,
              [pk.plan_key]
            );
            planName = plan?.name || pk.plan_key;
            dataAllowance = plan?.data_allowance || null;
          }
        }

        let statusUrl = null;
        if (voucherCode) {
          const [[vr]] = await pool.query(
            'SELECT group_id FROM vouchers WHERE voucher_code = ? LIMIT 1', [voucherCode]
          );
          const gid = vr?.group_id || row.user_group_id || null;
          if (gid) {
            const [[np]] = await pool.query(
              'SELECT hostname FROM network_projects WHERE ruijie_group_id = ? LIMIT 1', [gid]
            );
            if (np?.hostname) statusUrl = `https://${np.hostname}/status/${encodeURIComponent(voucherCode)}`;
          }
        }

        const args = { voucherCode, statusUrl, planName, dataAllowance, amount: row.amount };
        const mail = template === 'manual_assist' ? buildManualAssist(args) : buildReceipt(args);

        return send.ok(res, {
          template,
          subject: mail.subject,
          html: inlineLogo(mail.html),
          text: mail.text,
          to: meta.to || null,
          bcc: template === 'manual_assist' ? (mail.bcc || null) : null,
          sentAt: row.event_timestamp,
          voucherCode,
          planName,
          amount: row.amount,
        });
      } catch (e) { console.error('[email-preview]', e); return send.serverErr(res); }
    },
  };
}
