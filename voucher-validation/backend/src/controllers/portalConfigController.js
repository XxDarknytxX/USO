// src/controllers/portalConfigController.js
// Admin CRUD for portal plan configurations + audit log viewing

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
        const cases = rows.map((r) => ({
          transactionId: r.transaction_id,
          customerPhone: r.customer_phone,
          amount: r.amount,
          planKey: r.plan_key,
          planName: r.plan_name || r.plan_key || null,
          voucherCode: r.voucher_code,
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
  };
}
