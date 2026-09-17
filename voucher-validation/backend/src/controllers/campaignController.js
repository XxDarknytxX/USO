// src/controllers/campaignController.js
//
// Email campaigns: drafts, audiences, test sends, sending, delivery reports,
// and the list of excluded addresses. Administrators only (routes/campaigns.js).
//
// A campaign's content can only change while it is a DRAFT. Every write that
// depends on the state says so in its WHERE clause, so two admins acting at
// once cannot, say, edit a campaign the other just sent.

import {
  loadContacts, invalidateContacts, resolveAudience, searchContacts, normaliseAudience, normEmail, parseEmail,
} from "../services/campaignAudience.js";
import { renderCampaign, SAMPLE_CONTACT, maskEmail } from "../services/campaignMail.js";
import { loadSmtpTransport, inlineLogo } from "../services/mailer.js";
import { sendRatePerMinute } from "../services/campaignSender.js";

const send = {
  ok: (res, data = {}) => res.json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  notFound: (res, msg = "Campaign not found") => res.status(404).json({ error: msg }),
  conflict: (res, msg, extra = {}) => res.status(409).json({ error: msg, ...extra }),
  unavailable: (res, msg) => res.status(503).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

// 1 MB of HTML is already ten times what Gmail shows before clipping a message.
const LIMITS = { name: 200, subject: 255, preheader: 255, heading: 255, subheading: 255, body: 1_000_000 };
const SUMMARY_COLUMNS = "id, name, subject, status, layout, audience, created_at, updated_at, started_at, completed_at, created_by_email, started_by_email, last_error";
const iso = (d) => (d ? new Date(d).toISOString() : null);
const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
};
const pageOf = (q) => {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
};
const emptyTotals = () => ({ recipients: 0, queued: 0, sent: 0, failed: 0, skipped: 0 });

function contactOut(c) {
  return {
    emailNorm: c.emailNorm, email: c.email, phone: c.phone, phones: c.phones,
    purchases: c.purchases, lastPurchaseAt: iso(c.lastPurchaseAt),
    villages: c.villages, groupIds: c.groupIds, suppressed: c.suppressed,
  };
}

function summaryOf(row, totals) {
  const audience = normaliseAudience(parseJson(row.audience));
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    status: row.status,
    layout: row.layout,
    audience: {
      mode: audience.mode,
      purchasersOnly: audience.purchasersOnly,
      groupIds: audience.groupIds,
      selectedCount: audience.selected.length,
    },
    totals: totals || emptyTotals(),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    createdByEmail: row.created_by_email || null,
    startedByEmail: row.started_by_email || null,
    lastError: row.last_error || null,
  };
}

async function totalsFor(pool, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await pool.query(
    `SELECT campaign_id,
            COUNT(*) AS recipients,
            SUM(status IN ('queued','sending')) AS queued,
            SUM(status = 'sent') AS sent,
            SUM(status = 'failed') AS failed,
            SUM(status = 'skipped') AS skipped
       FROM email_campaign_recipients
      WHERE campaign_id IN (${ids.map(() => "?").join(",")})
      GROUP BY campaign_id`,
    ids
  );
  for (const r of rows) {
    map.set(r.campaign_id, {
      recipients: Number(r.recipients) || 0,
      queued: Number(r.queued) || 0,
      sent: Number(r.sent) || 0,
      failed: Number(r.failed) || 0,
      skipped: Number(r.skipped) || 0,
    });
  }
  return map;
}

async function smtpState(pool) {
  const [[c]] = await pool.query("SELECT host, enabled, from_name, from_email, username FROM smtp_settings WHERE id = 1").catch(() => [[null]]);
  const configured = Boolean(c?.host);
  const fromEmail = c?.from_email || c?.username || null;
  return {
    configured,
    enabled: configured && Boolean(Number(c?.enabled)),
    from: configured ? (c.from_name ? `${c.from_name} <${fromEmail}>` : fromEmail) : null,
  };
}

const contentOf = (row) => ({
  subject: row.subject,
  preheader: row.preheader,
  heading: row.heading,
  subheading: row.subheading,
  layout: row.layout,
  bodyHtml: row.body_html || "",
  bodyText: row.body_text || "",
});

export function makeCampaignController(pool, sender) {
  async function loadRow(id) {
    const [[row]] = await pool.query("SELECT * FROM email_campaigns WHERE id = ?", [id]);
    return row || null;
  }

  async function full(row, contacts = null) {
    const totals = (await totalsFor(pool, [row.id])).get(row.id);
    const summary = summaryOf(row, totals);
    const audience = normaliseAudience(parseJson(row.audience));
    let selectedContacts = [];
    // Only a draft's chosen customers are resolved for display: once sent, the
    // audience lives in email_campaign_recipients, and the report polls this.
    if (row.status === "draft" && audience.mode === "selected" && audience.selected.length) {
      const list = contacts || (await loadContacts(pool));
      const wanted = new Set(audience.selected);
      selectedContacts = list.filter((c) => wanted.has(c.emailNorm)).map(contactOut);
      // A chosen address that has since left the mapping still shows, so the
      // admin can see it and remove it rather than wonder where it went.
      const found = new Set(selectedContacts.map((c) => c.emailNorm));
      for (const e of audience.selected) {
        if (!found.has(e)) {
          selectedContacts.push({ emailNorm: e, email: e, phone: null, phones: [], purchases: 0, lastPurchaseAt: null, villages: [], groupIds: [], suppressed: false, missing: true });
        }
      }
    }
    return {
      ...summary,
      ...contentOf(row),
      audience: { ...audience, selectedContacts },
      lastTestAt: iso(row.last_test_at),
      lastTestTo: row.last_test_to || null,
      sendPerMinute: sendRatePerMinute(),
    };
  }

  const idOf = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  /** Fields from a request body, validated. Returns { values } or { error }. */
  function readContent(body) {
    const values = {};
    for (const key of ["name", "subject", "preheader", "heading", "subheading"]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "string") return { error: `${key} must be text` };
      const v = body[key].replace(/[\r\n]+/g, " ").trim();
      if (v.length > LIMITS[key]) return { error: `${key} is too long (max ${LIMITS[key]} characters)` };
      values[key] = v;
    }
    if (values.name !== undefined && !values.name) return { error: "The campaign needs a name" };
    if (body.layout !== undefined) {
      if (!["branded", "raw"].includes(body.layout)) return { error: "layout must be branded or raw" };
      values.layout = body.layout;
    }
    for (const [key, col] of [["bodyHtml", "body_html"], ["bodyText", "body_text"]]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "string") return { error: `${key} must be text` };
      if (body[key].length > LIMITS.body) return { error: "The email is too large" };
      values[col] = body[key];
    }
    if (body.audience !== undefined) values.audience = JSON.stringify(normaliseAudience(body.audience));
    return { values };
  }

  return {
    // GET /api/campaigns
    list: async (req, res) => {
      try {
        const [rows] = await pool.query(`SELECT ${SUMMARY_COLUMNS} FROM email_campaigns ORDER BY updated_at DESC, id DESC`);
        const bucket = (s) => (s === "draft" ? "draft" : s === "sending" || s === "paused" ? "active" : "done");
        const counts = { all: rows.length, draft: 0, active: 0, done: 0 };
        for (const r of rows) counts[bucket(r.status)] += 1;
        const want = ["draft", "active", "done"].includes(req.query.status) ? req.query.status : "all";
        const q = String(req.query.search || "").trim().toLowerCase();
        const shown = rows.filter(
          (r) =>
            (want === "all" || bucket(r.status) === want) &&
            (!q || r.name.toLowerCase().includes(q) || String(r.subject || "").toLowerCase().includes(q))
        );
        const totals = await totalsFor(pool, shown.map((r) => r.id));
        return send.ok(res, { campaigns: shown.map((r) => summaryOf(r, totals.get(r.id))), counts });
      } catch (e) {
        console.error("[campaigns] list:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/campaigns/stats
    stats: async (_req, res) => {
      try {
        const contacts = await loadContacts(pool);
        const [[{ suppressed }]] = await pool.query("SELECT COUNT(*) AS suppressed FROM email_suppressions");
        return send.ok(res, {
          contacts: contacts.length,
          purchasers: contacts.filter((c) => c.purchases > 0).length,
          suppressed: Number(suppressed) || 0,
          sendPerMinute: sendRatePerMinute(),
          smtp: await smtpState(pool),
        });
      } catch (e) {
        console.error("[campaigns] stats:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns
    create: async (req, res) => {
      try {
        const name = typeof req.body?.name === "string" && req.body.name.trim()
          ? req.body.name.trim().slice(0, LIMITS.name)
          : "Untitled campaign";
        const [r] = await pool.query(
          `INSERT INTO email_campaigns (name, audience, created_by, created_by_email)
           VALUES (?, ?, ?, ?)`,
          [name, JSON.stringify(normaliseAudience({ mode: "all" })), req.user?.id ?? null, req.user?.email ?? null]
        );
        return res.status(201).json({ campaign: await full(await loadRow(r.insertId)) });
      } catch (e) {
        console.error("[campaigns] create:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/campaigns/:id
    get: async (req, res) => {
      try {
        const id = idOf(req);
        const row = id && (await loadRow(id));
        if (!row) return send.notFound(res);
        return send.ok(res, { campaign: await full(row) });
      } catch (e) {
        console.error("[campaigns] get:", e.message);
        return send.serverErr(res);
      }
    },

    // PUT /api/campaigns/:id
    update: async (req, res) => {
      try {
        const id = idOf(req);
        if (!id) return send.notFound(res);
        const { values, error } = readContent(req.body || {});
        if (error) return send.bad(res, error);
        const cols = Object.keys(values);
        const row = await loadRow(id);
        if (!row) return send.notFound(res);
        if (row.status !== "draft") return send.conflict(res, "This campaign has been sent and can no longer be edited — duplicate it to make changes");
        if (cols.length) {
          const [r] = await pool.query(
            `UPDATE email_campaigns SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ? AND status = 'draft'`,
            [...cols.map((c) => values[c]), id]
          );
          if (!r.affectedRows) return send.conflict(res, "This campaign has been sent and can no longer be edited — duplicate it to make changes");
        }
        return send.ok(res, { campaign: await full(await loadRow(id)) });
      } catch (e) {
        console.error("[campaigns] update:", e.message);
        return send.serverErr(res);
      }
    },

    // DELETE /api/campaigns/:id
    remove: async (req, res) => {
      try {
        const id = idOf(req);
        if (!id) return send.notFound(res);
        const [r] = await pool.query("DELETE FROM email_campaigns WHERE id = ? AND status = 'draft'", [id]);
        if (!r.affectedRows) {
          const row = await loadRow(id);
          if (!row) return send.notFound(res);
          return send.conflict(res, "Only drafts can be deleted — a sent campaign is the record of what customers received");
        }
        return send.ok(res, { ok: true });
      } catch (e) {
        console.error("[campaigns] remove:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/:id/duplicate
    duplicate: async (req, res) => {
      try {
        const id = idOf(req);
        const row = id && (await loadRow(id));
        if (!row) return send.notFound(res);
        const name = `Copy of ${row.name}`.slice(0, LIMITS.name);
        const [r] = await pool.query(
          `INSERT INTO email_campaigns (name, subject, preheader, heading, subheading, layout, body_html, body_text, audience, created_by, created_by_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [name, row.subject, row.preheader, row.heading, row.subheading, row.layout, row.body_html, row.body_text,
            JSON.stringify(normaliseAudience(parseJson(row.audience))), req.user?.id ?? null, req.user?.email ?? null]
        );
        return res.status(201).json({ campaign: await full(await loadRow(r.insertId)) });
      } catch (e) {
        console.error("[campaigns] duplicate:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/preview
    preview: async (req, res) => {
      try {
        const b = req.body || {};
        const { values, error } = readContent({ ...b, name: undefined, audience: undefined });
        if (error) return send.bad(res, error);
        const mail = renderCampaign(
          {
            subject: values.subject ?? "",
            preheader: values.preheader ?? "",
            heading: values.heading ?? "",
            subheading: values.subheading ?? "",
            layout: values.layout ?? "branded",
            bodyHtml: values.body_html ?? "",
            bodyText: values.body_text ?? "",
          },
          SAMPLE_CONTACT
        );
        return send.ok(res, { subject: mail.subject, html: inlineLogo(mail.html), text: mail.text, warnings: mail.warnings });
      } catch (e) {
        console.error("[campaigns] preview:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/campaigns/contacts
    contacts: async (req, res) => {
      try {
        const { page, pageSize, offset } = pageOf(req.query);
        const groupIds = String(req.query.groupIds || "").split(",").map((g) => g.trim()).filter(Boolean);
        const all = await loadContacts(pool);
        const matched = searchContacts(all, {
          search: req.query.search,
          purchasersOnly: req.query.purchasersOnly === "true",
          groupIds,
        });
        return send.ok(res, {
          contacts: matched.slice(offset, offset + pageSize).map(contactOut),
          total: matched.length,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
        });
      } catch (e) {
        console.error("[campaigns] contacts:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/audience-count
    audienceCount: async (req, res) => {
      try {
        const contacts = await loadContacts(pool);
        const { recipients, suppressedExcluded } = resolveAudience(contacts, req.body?.audience);
        return send.ok(res, { count: recipients.length, suppressedExcluded, sample: recipients.slice(0, 5).map(contactOut) });
      } catch (e) {
        console.error("[campaigns] audience-count:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/:id/test
    testSend: async (req, res) => {
      try {
        const id = idOf(req);
        const row = id && (await loadRow(id));
        if (!row) return send.notFound(res);
        const raw = Array.isArray(req.body?.to) ? req.body.to : [req.body?.to];
        const to = [...new Set(raw.map((t) => String(t ?? "").trim()).filter(Boolean))];
        if (!to.length) return send.bad(res, "Add at least one address to send the test to");
        if (to.length > 5) return send.bad(res, "A test goes to at most 5 addresses");
        const invalid = to.filter((t) => !parseEmail(t));
        if (invalid.length) return send.bad(res, `Not an email address: ${invalid.join(", ")}`);
        if (!String(row.subject || "").trim() || !String(row.body_html || "").trim()) {
          return send.bad(res, "Give the campaign a subject and a body (and save) before sending a test");
        }

        const smtp = await loadSmtpTransport(pool);
        if (!smtp?.transport) return send.unavailable(res, "Email sending is not configured — set up SMTP under Settings");

        const sent = [];
        const failed = [];
        for (const typed of to) {
          const address = parseEmail(typed);
          const mail = renderCampaign(contentOf(row), { ...SAMPLE_CONTACT, email: address });
          try {
            await smtp.transport.sendMail({
              from: smtp.from,
              to: { name: "", address },
              subject: `[TEST] ${mail.subject}`,
              html: mail.html,
              text: mail.text,
              attachments: mail.attachments,
            });
            sent.push(address);
          } catch (err) {
            failed.push({ to: address, error: String(err?.response || err?.message || "Send failed").slice(0, 300) });
          }
        }
        if (sent.length) {
          await pool.query("UPDATE email_campaigns SET last_test_at = NOW(), last_test_to = ? WHERE id = ?", [sent.join(", ").slice(0, 512), id]);
        }
        if (!sent.length) return res.status(502).json({ error: failed[0]?.error || "The test could not be sent", sent, failed });
        return send.ok(res, { sent, failed });
      } catch (e) {
        console.error("[campaigns] test:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/:id/send
    send: async (req, res) => {
      const id = idOf(req);
      if (!id) return send.notFound(res);
      let conn;
      try {
        const row = await loadRow(id);
        if (!row) return send.notFound(res);
        if (row.status !== "draft") return send.conflict(res, "This campaign has already been sent");
        if (!String(row.subject || "").trim()) return send.bad(res, "The campaign needs a subject");
        if (!String(row.body_html || "").trim()) return send.bad(res, "The campaign needs a body");

        const smtp = await smtpState(pool);
        if (!smtp.configured) return send.unavailable(res, "Email sending is not configured — set up SMTP under Settings");
        if (!smtp.enabled) return send.unavailable(res, "Email sending is turned off under Settings — turn it on to send campaigns");

        // Fresh, not cached: this is the list the campaign is frozen to.
        const contacts = await loadContacts(pool, { fresh: true });
        const { recipients } = resolveAudience(contacts, parseJson(row.audience));
        if (!recipients.length) return send.bad(res, "Nobody would receive this campaign — check the audience");
        const expected = Number(req.body?.expectedCount);
        if (!Number.isInteger(expected) || expected !== recipients.length) {
          return send.conflict(
            res,
            `The audience has changed: this would now go to ${recipients.length} customer${recipients.length === 1 ? "" : "s"}. Check and confirm again.`,
            { count: recipients.length }
          );
        }

        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [claim] = await conn.query(
          `UPDATE email_campaigns
              SET status = 'sending', started_at = NOW(), started_by = ?, started_by_email = ?, last_error = NULL, completed_at = NULL
            WHERE id = ? AND status = 'draft'`,
          [req.user?.id ?? null, req.user?.email ?? null, id]
        );
        if (!claim.affectedRows) {
          await conn.rollback();
          return send.conflict(res, "This campaign has already been sent");
        }
        // A plain INSERT: every confirmed recipient must get a row, and a
        // collision would mean the count the admin confirmed is not the count
        // being sent — so it aborts the whole send instead of dropping someone.
        for (let i = 0; i < recipients.length; i += 500) {
          const chunk = recipients.slice(i, i + 500);
          await conn.query(
            `INSERT INTO email_campaign_recipients (campaign_id, email, email_norm, phone, village)
             VALUES ${chunk.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
            chunk.flatMap((c) => [id, c.email, c.emailNorm, c.phone || null, c.villages[0] || null])
          );
        }
        await conn.commit();
        console.log(new Date().toISOString(), "[Campaigns]", `campaign #${id} started by ${req.user?.email || req.user?.id} to ${recipients.length} recipients`);
        sender?.kick();
        return send.ok(res, { campaign: await full(await loadRow(id), contacts) });
      } catch (e) {
        if (conn) await conn.rollback().catch(() => {});
        console.error("[campaigns] send:", e.message);
        return send.serverErr(res, "Could not start the campaign");
      } finally {
        conn?.release();
      }
    },

    // POST /api/campaigns/:id/pause
    pause: async (req, res) => {
      try {
        const id = idOf(req);
        if (!id) return send.notFound(res);
        const [r] = await pool.query("UPDATE email_campaigns SET status = 'paused' WHERE id = ? AND status = 'sending'", [id]);
        const row = await loadRow(id);
        if (!row) return send.notFound(res);
        if (!r.affectedRows) return send.conflict(res, "Only a campaign that is sending can be paused");
        return send.ok(res, { campaign: await full(row) });
      } catch (e) {
        console.error("[campaigns] pause:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/:id/resume
    resume: async (req, res) => {
      try {
        const id = idOf(req);
        if (!id) return send.notFound(res);
        const smtp = await smtpState(pool);
        if (!smtp.configured) return send.unavailable(res, "Email sending is not configured — set up SMTP under Settings");
        if (!smtp.enabled) return send.unavailable(res, "Email sending is turned off under Settings — turn it on to resume");
        const [r] = await pool.query("UPDATE email_campaigns SET status = 'sending', last_error = NULL WHERE id = ? AND status = 'paused'", [id]);
        const row = await loadRow(id);
        if (!row) return send.notFound(res);
        if (!r.affectedRows) return send.conflict(res, "Only a paused campaign can be resumed");
        sender?.kick();
        return send.ok(res, { campaign: await full(row) });
      } catch (e) {
        console.error("[campaigns] resume:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/:id/cancel
    cancel: async (req, res) => {
      const id = idOf(req);
      if (!id) return send.notFound(res);
      let conn;
      try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [r] = await conn.query(
          "UPDATE email_campaigns SET status = 'cancelled', completed_at = NOW() WHERE id = ? AND status IN ('sending','paused')",
          [id]
        );
        if (!r.affectedRows) {
          await conn.rollback();
          const row = await loadRow(id);
          if (!row) return send.notFound(res);
          return send.conflict(res, "Only a campaign that is sending or paused can be cancelled");
        }
        await conn.query(
          "UPDATE email_campaign_recipients SET status = 'skipped', error = 'Campaign cancelled before this email was sent' WHERE campaign_id = ? AND status = 'queued'",
          [id]
        );
        await conn.commit();
        return send.ok(res, { campaign: await full(await loadRow(id)) });
      } catch (e) {
        if (conn) await conn.rollback().catch(() => {});
        console.error("[campaigns] cancel:", e.message);
        return send.serverErr(res);
      } finally {
        conn?.release();
      }
    },

    // POST /api/campaigns/:id/retry-failed
    retryFailed: async (req, res) => {
      const id = idOf(req);
      if (!id) return send.notFound(res);
      let conn;
      try {
        const smtp = await smtpState(pool);
        if (!smtp.configured || !smtp.enabled) {
          return send.unavailable(res, "Email sending is not configured, or campaigns are turned off under Settings");
        }
        // Locked, so a cancel or an automatic pause landing at the same moment
        // is either seen here or waits for this to finish — never undone.
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [[row]] = await conn.query("SELECT id, status FROM email_campaigns WHERE id = ? FOR UPDATE", [id]);
        if (!row) {
          await conn.rollback();
          return send.notFound(res);
        }
        if (!["sending", "paused", "sent"].includes(row.status)) {
          await conn.rollback();
          return send.conflict(res, "Failed emails can only be retried on a campaign that was sent");
        }
        const [r] = await conn.query(
          `UPDATE email_campaign_recipients r
              SET r.status = 'queued', r.attempts = 0, r.next_attempt_at = NULL, r.error = NULL
            WHERE r.campaign_id = ? AND r.status = 'failed'
              AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email_norm = r.email_norm)`,
          [id]
        );
        if (r.affectedRows && row.status === "sent") {
          await conn.query(
            "UPDATE email_campaigns SET status = 'sending', completed_at = NULL, last_error = NULL WHERE id = ? AND status = 'sent'",
            [id]
          );
        }
        await conn.commit();
        if (r.affectedRows) sender?.kick();
        return send.ok(res, { campaign: await full(await loadRow(id)), requeued: r.affectedRows });
      } catch (e) {
        if (conn) await conn.rollback().catch(() => {});
        console.error("[campaigns] retry-failed:", e.message);
        return send.serverErr(res);
      } finally {
        conn?.release();
      }
    },

    // GET /api/campaigns/:id/recipients
    recipients: async (req, res) => {
      try {
        const id = idOf(req);
        const row = id && (await loadRow(id));
        if (!row) return send.notFound(res);
        const { page, pageSize, offset } = pageOf(req.query);
        const statuses = ["queued", "sent", "failed", "skipped"];
        const status = statuses.includes(req.query.status) ? req.query.status : "all";
        const search = String(req.query.search || "").trim().toLowerCase();

        const where = ["campaign_id = ?"];
        const params = [id];
        if (status === "queued") where.push("status IN ('queued','sending')");
        else if (status !== "all") { where.push("status = ?"); params.push(status); }
        if (search) {
          where.push("(email_norm LIKE ? OR phone LIKE ?)");
          params.push(`%${search}%`, `%${search.replace(/\D/g, "") || search}%`);
        }
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM email_campaign_recipients WHERE ${where.join(" AND ")}`, params);
        const [rows] = await pool.query(
          `SELECT id, email, phone, status, attempts, error, sent_at
             FROM email_campaign_recipients
            WHERE ${where.join(" AND ")}
            ORDER BY FIELD(status, 'failed', 'sending', 'queued', 'skipped', 'sent'), id
            LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
        const totals = (await totalsFor(pool, [id])).get(id) || emptyTotals();
        return send.ok(res, {
          recipients: rows.map((r) => ({
            id: Number(r.id), email: r.email, phone: r.phone, status: r.status,
            attempts: Number(r.attempts) || 0, error: r.error, sentAt: iso(r.sent_at),
          })),
          total: Number(total) || 0,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil((Number(total) || 0) / pageSize)),
          counts: { all: totals.recipients, queued: totals.queued, sent: totals.sent, failed: totals.failed, skipped: totals.skipped },
        });
      } catch (e) {
        console.error("[campaigns] recipients:", e.message);
        return send.serverErr(res);
      }
    },

    // GET /api/campaigns/suppressions
    listSuppressions: async (req, res) => {
      try {
        const { page, pageSize, offset } = pageOf(req.query);
        const search = String(req.query.search || "").trim().toLowerCase();
        const where = search ? "WHERE email_norm LIKE ?" : "";
        const params = search ? [`%${search}%`] : [];
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM email_suppressions ${where}`, params);
        const [rows] = await pool.query(
          `SELECT email, note, created_at, created_by_email FROM email_suppressions ${where}
            ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
        return send.ok(res, {
          suppressions: rows.map((r) => ({
            email: r.email, note: r.note || null, createdAt: iso(r.created_at), createdByEmail: r.created_by_email,
          })),
          total: Number(total) || 0,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil((Number(total) || 0) / pageSize)),
        });
      } catch (e) {
        console.error("[campaigns] suppressions:", e.message);
        return send.serverErr(res);
      }
    },

    // POST /api/campaigns/suppressions
    addSuppression: async (req, res) => {
      try {
        const email = parseEmail(req.body?.email);
        if (!email) return send.bad(res, "Enter a valid email address");
        const note = typeof req.body?.note === "string" ? req.body.note.replace(/[\r\n]+/g, " ").trim().slice(0, 255) : "";
        const emailNorm = normEmail(email);
        await pool.query(
          `INSERT INTO email_suppressions (email_norm, email, note, created_by, created_by_email)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE note = COALESCE(NULLIF(VALUES(note), ''), note)`,
          [emailNorm, email, note || null, req.user?.id ?? null, req.user?.email ?? null]
        );
        // Anything still waiting to go to this inbox, in any campaign, stops now.
        await pool.query(
          "UPDATE email_campaign_recipients SET status = 'skipped', error = 'Excluded by an administrator' WHERE email_norm = ? AND status = 'queued'",
          [emailNorm]
        );
        invalidateContacts();
        const [[r]] = await pool.query("SELECT email, note, created_at, created_by_email FROM email_suppressions WHERE email_norm = ?", [emailNorm]);
        return send.ok(res, {
          suppression: { email: r.email, note: r.note || null, createdAt: iso(r.created_at), createdByEmail: r.created_by_email },
        });
      } catch (e) {
        console.error("[campaigns] add suppression:", e.message);
        return send.serverErr(res);
      }
    },

    // DELETE /api/campaigns/suppressions/:email
    removeSuppression: async (req, res) => {
      try {
        const emailNorm = normEmail(req.params.email);
        if (!emailNorm) return send.notFound(res, "That address is not on the list");
        const [r] = await pool.query("DELETE FROM email_suppressions WHERE email_norm = ?", [emailNorm]);
        if (!r.affectedRows) return send.notFound(res, "That address is not on the list");
        invalidateContacts();
        console.log(new Date().toISOString(), "[Campaigns]", `exclusion removed for ${maskEmail(emailNorm)} by ${req.user?.email || req.user?.id}`);
        return send.ok(res, { ok: true });
      } catch (e) {
        console.error("[campaigns] remove suppression:", e.message);
        return send.serverErr(res);
      }
    },
  };
}
