// src/controllers/portalConfigController.js
// Admin CRUD for portal plan configurations + audit log viewing

const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

export function makePortalConfigController(pool) {
  return {
    // GET /api/portal-config/plans
    getPlans: async (req, res) => {
      try {
        const { category, active } = req.query;
        const where = [];
        const params = [];

        if (category) { where.push('p.category = ?'); params.push(category); }
        if (active !== undefined) { where.push('p.is_active = ?'); params.push(active === 'true' ? 1 : 0); }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [plans] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM vouchers v
             WHERE v.user_group_id COLLATE utf8mb4_0900_ai_ci = p.user_group_id COLLATE utf8mb4_0900_ai_ci
               AND v.status = '1'
               AND v.disable_status = 0
               AND v.id NOT IN (SELECT vc.voucher_id FROM voucher_claims vc WHERE vc.status IN ('claimed','used'))
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
             WHERE v.user_group_id COLLATE utf8mb4_0900_ai_ci = p.user_group_id COLLATE utf8mb4_0900_ai_ci
               AND v.status = '1'
               AND v.disable_status = 0
               AND v.id NOT IN (SELECT vc.voucher_id FROM voucher_claims vc WHERE vc.status IN ('claimed','used'))
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
          userGroupId, userGroup, userGroupName, planKey, name, category, price, currency,
          dataAllowance, icon, popular, description, features, sortOrder, isActive
        } = req.body;

        // Accept both userGroupId and userGroup (frontend sends userGroup)
        const resolvedUserGroupId = userGroupId || userGroup;

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
           (user_group_id, user_group_name, plan_key, name, category, price, currency,
            data_allowance, icon, popular, description, features, sort_order, is_active, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            resolvedUserGroupId, userGroupName || null, planKey, name, category,
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
          'user_group_id', 'user_group_name', 'plan_key', 'name', 'category', 'price', 'currency',
          'data_allowance', 'icon', 'popular', 'description', 'features', 'sort_order', 'is_active',
        ];
        const bodyMap = {
          user_group_id: 'userGroupId', user_group_name: 'userGroupName', plan_key: 'planKey',
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
        const { page, limit, transactionId, sessionId, status, startDate, endDate } = req.query;
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
          if (eventTypes.includes('auth_success')) overallStatus = 'success';
          else if (eventTypes.includes('manual_assistance_created')) overallStatus = 'manual_assistance';
          else if (eventTypes.includes('auth_failed') || eventTypes.includes('case_creation_failed')) overallStatus = 'auth_failed';
          else if (eventTypes.includes('payment_failed')) overallStatus = 'payment_failed';
          else if (eventTypes.includes('system_error')) overallStatus = 'system_error';
          else if (eventTypes.includes('handshake_failed') || eventTypes.includes('handshake_error')) overallStatus = 'handshake_failed';
          else if (eventTypes.includes('voucher_claim_failed') || eventTypes.includes('voucher_service_error')) overallStatus = 'voucher_failed';
          else if (eventTypes.includes('no_session_id')) overallStatus = 'no_session';

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
            events,
          };
        });

        // Optional: filter by computed status
        let filtered = transactions;
        if (status) {
          filtered = transactions.filter(t => t.overallStatus === status);
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
  };
}
