// src/services/emailLog.js
// Records outgoing-email outcomes into portal_audit_logs so they surface on the
// Portal Logs page (the transaction log): who received a receipt, who did not,
// when it was sent, and whether it succeeded. Best-effort: a logging failure
// never propagates into the email/purchase path.

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} e
 * @param {string} e.eventType  receipt_email_sent | receipt_email_failed |
 *   receipt_email_skipped | test_email_sent | test_email_failed
 * @param {string} [e.status]   sent | failed | skipped
 * @param {string} [e.reason]   machine reason (no_mapping, smtp_not_configured, ...)
 * @param {string} [e.message]  human-readable line shown in the log detail
 * @param {string} [e.error]    error text when a send failed
 * @param {string} [e.to]       recipient address
 * @param {string} [e.subject]
 * @param {string} [e.template]
 * @param {string} [e.sentBy]   admin email, for manual test sends
 * @param {string} [e.voucherCode]
 * @param {string} [e.phone]
 * @param {string|number} [e.groupId]
 * @param {number} [e.amount]
 * @param {string} [e.transactionId]
 */
export async function logEmailEvent(pool, e = {}) {
  try {
    const eventData = {
      to: e.to ?? null,
      subject: e.subject ?? null,
      template: e.template ?? null,
      status: e.status ?? null,
      reason: e.reason ?? null,
      message: e.message ?? null,
      error: e.error ?? null,
      sentBy: e.sentBy ?? null,
    };
    for (const k of Object.keys(eventData)) if (eventData[k] == null) delete eventData[k];

    await pool.query(
      `INSERT INTO portal_audit_logs
         (event_type, transaction_id, user_group_id, voucher_code, amount,
          customer_phone, event_data, source_system, event_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'voucher_validation', NOW())`,
      [
        e.eventType,
        e.transactionId || null,
        e.groupId != null ? String(e.groupId) : null,
        e.voucherCode || null,
        e.amount != null && !Number.isNaN(Number(e.amount)) ? Number(e.amount) : null,
        e.phone || null,
        JSON.stringify(eventData),
      ]
    );
  } catch (err) {
    console.error("[emailLog] failed to record", e?.eventType, err.message);
  }
}
