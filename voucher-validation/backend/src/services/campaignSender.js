// src/services/campaignSender.js
//
// Delivers email campaigns, one message at a time, from the database.
//
// ── Why not just call sendMail for everyone ──────────────────────────────
// Every email this service sends — purchase receipts, manual-assistance
// vouchers, account invites — shares ONE SMTP connection capped at Office 365's
// 30 messages a minute (see loadSmtpTransport). Handing it a whole campaign
// would queue those receipts in memory behind hundreds of marketing emails, and
// a restart would silently drop whatever was still queued.
//
// So the sender takes ONE recipient row at a time, awaits the send, records the
// outcome, and waits before the next. At the default 20 a minute it leaves a
// third of the allowance free for receipts, which interleave naturally.
//
// ── State lives in MySQL ─────────────────────────────────────────────────
// A campaign is 'sending' or 'paused'; each recipient is queued, sending,
// sent, failed or skipped. The loop re-reads that state every time, so pause,
// resume and cancel from the console take effect at the next message, and a
// restart carries on from the next queued row.
//
// A row still marked 'sending' at start-up was interrupted mid-conversation
// with the mail server. Whether that message went out cannot be known, so it
// is marked failed with that reason rather than sent again: an admin can retry
// failures deliberately; a duplicate cannot be taken back.
//
// ── Failures ─────────────────────────────────────────────────────────────
// Decided by WHERE in the SMTP conversation the server said no, not just by
// the number, because Office 365's 5xx at MAIL FROM or end of DATA are about
// the mailbox (send-as denied, daily quota, account blocked), not the customer:
//   sign-in refused (530/534/535, EAUTH), a 5xx before or after the recipient
//   (MAIL FROM, DATA), sending turned off in Settings, or ten rejections in a row
//       -> the campaign is PAUSED with the server's reason and the row goes back
//          in the queue untouched. Every further send would fail the same way.
//   throttling (421, 4.7.x) or a connection failure
//       -> the row is retried later (2, then 10 minutes) and the whole sender
//          cools down for two minutes
//   a 4xx for this recipient (RCPT TO)
//       -> retried later, without slowing anyone else
//   a 5xx for this recipient (RCPT TO), or an address the mail library refuses
//       -> the row fails with the reason
//   the email cannot be built for this recipient
//       -> the row fails with the reason
//
// Once the mail server has ACCEPTED a message, nothing can put that row back
// in the queue: recording "sent" is retried on its own, and if the database is
// unreachable the row is left 'sending', which the sweep below reports as
// "delivery unknown" rather than sending it again.
//
// Two sweeps run before each message:
//   rows stuck in 'sending' for 10 minutes (the process could not finish
//   recording them) -> failed, "delivery unknown", never resent automatically
//   rows still queued in a CANCELLED campaign (a send finished after the
//   cancel) -> skipped
//
// "Sent" means Office 365 accepted the message. Bounces arrive later, in the
// sending mailbox, and are not read back.
//
// ONE instance runs this (the primary PM2 fork), like the other schedulers.

import { loadSmtpTransport } from "./mailer.js";
import { renderCampaign } from "./campaignMail.js";

const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [2, 10];
const IDLE_MS = 15_000;
const COOLDOWN_MS = 2 * 60_000;
const STUCK_MINUTES = 10;
const CONSECUTIVE_REJECTIONS_TO_PAUSE = 10;

export function sendRatePerMinute() {
  const n = Number(process.env.CAMPAIGN_SEND_PER_MINUTE);
  return Number.isFinite(n) && n >= 1 ? Math.min(25, Math.floor(n)) : 20;
}

const clip = (s, n = 500) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How to treat a failed send. Exported for tests.
 *   auth       pause the campaign, requeue the row untouched
 *   account    pause the campaign (mailbox-level refusal), requeue untouched
 *   throttled  retry the row later, cool the whole sender down
 *   connection retry the row later, cool the whole sender down
 *   recipient  retry the row later (4xx for this address only)
 *   permanent  fail the row
 */
export function classifySendError(err) {
  const code = Number(err?.responseCode) || 0;
  const ecode = String(err?.code || "");
  const command = String(err?.command || "").toUpperCase();
  const text = `${err?.response || ""} ${err?.message || ""}`;
  if (ecode === "EAUTH" || code === 530 || code === 534 || code === 535 || command.startsWith("AUTH")) return "auth";
  if (code === 421 || /\b4\.7\.\d+\b|throttl|too many|rate limit/i.test(text)) return "throttled";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ETLS", "EPROTOCOL", "ECONNREFUSED"].includes(ecode)) return "connection";
  if (code >= 500) return command.startsWith("RCPT") ? "permanent" : "account";
  if (code >= 400) return command.startsWith("RCPT") ? "recipient" : "connection";
  // No server reply at all: the library refused the address or the message
  // before sending (EENVELOPE, EMESSAGE, ...). Deterministic for this row.
  if (ecode === "EENVELOPE" || ecode === "EMESSAGE" || command === "API") return "permanent";
  return "connection";
}

export function makeCampaignSender({ pool, loadTransport = loadSmtpTransport, perMinute = sendRatePerMinute(), now = () => Date.now() } = {}) {
  const intervalMs = Math.ceil(60_000 / perMinute);
  let timer = null;
  let active = false;
  let busy = false;
  let cooldownUntil = 0;
  let lastSendAt = null;
  let lastError = null;
  let consecutiveRejections = 0;

  const log = (...a) => console.log(new Date().toISOString(), "[Campaigns]", ...a);

  function arm(ms) {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(0, ms));
  }

  async function tick() {
    if (busy || !active) return;
    busy = true;
    let next = IDLE_MS;
    try {
      const outcome = await sendNext();
      next = outcome === "sent" ? intervalMs : outcome === "quick" ? 250 : IDLE_MS;
    } catch (e) {
      lastError = clip(e.message);
      console.error("[Campaigns] send loop error:", e.message);
    } finally {
      busy = false;
      arm(Math.max(next, cooldownUntil - now()));
    }
  }

  async function pauseCampaign(campaignId, reason) {
    await pool.query(
      "UPDATE email_campaigns SET status = 'paused', last_error = ? WHERE id = ? AND status = 'sending'",
      [clip(reason, 500), campaignId]
    );
    log(`campaign #${campaignId} paused: ${clip(reason, 200)}`);
  }

  async function sweep() {
    await pool.query(
      `UPDATE email_campaign_recipients
          SET status = 'failed',
              error = 'Stopped part-way through sending — it may or may not have been delivered, so it was not sent again. Retry failed to resend.'
        WHERE status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [STUCK_MINUTES]
    );
    await pool.query(
      `UPDATE email_campaign_recipients r
         JOIN email_campaigns c ON c.id = r.campaign_id
          SET r.status = 'skipped', r.error = 'Campaign cancelled before this email was sent'
        WHERE c.status = 'cancelled' AND r.status = 'queued'`
    );
    await pool.query(
      `UPDATE email_campaigns c
          SET c.status = 'sent', c.completed_at = NOW()
        WHERE c.status = 'sending'
          AND NOT EXISTS (SELECT 1 FROM email_campaign_recipients r
                           WHERE r.campaign_id = c.id AND r.status IN ('queued','sending'))`
    );
  }

  /** Writes that must land; a brief database blip should not lose them. */
  async function mustRecord(sql, params) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await pool.query(sql, params);
      } catch (e) {
        if (attempt >= 4) throw e;
        await sleep(1000 * attempt);
      }
    }
  }

  /** One message. Returns "sent" | "quick" (nothing sent, look again soon) | "idle". */
  async function sendNext() {
    if (now() < cooldownUntil) return "idle";
    await sweep();

    const [[row]] = await pool.query(
      `SELECT r.id, r.campaign_id, r.email, r.email_norm, r.phone, r.village, r.attempts
         FROM email_campaign_recipients r
         JOIN email_campaigns c ON c.id = r.campaign_id
        WHERE c.status = 'sending'
          AND r.status = 'queued'
          AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= NOW())
        -- Fresh rows before retries: one address the server keeps refusing
        -- must not hold up the rest of the campaign behind it.
        ORDER BY c.started_at, c.id, r.attempts, r.id
        LIMIT 1`
    );
    if (!row) return "idle";

    const [claim] = await pool.query(
      "UPDATE email_campaign_recipients SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'queued'",
      [row.id]
    );
    if (!claim.affectedRows) return "quick";
    const attempts = Number(row.attempts) + 1;

    // From here until the mail server is asked, anything that goes wrong puts
    // the row back exactly as it was — or, if the database itself is the
    // problem, leaves it for the stuck-row sweep. It never strands silently.
    const requeueUntouched = () =>
      pool.query(
        "UPDATE email_campaign_recipients SET status = 'queued', attempts = GREATEST(attempts - 1, 0) WHERE id = ? AND status = 'sending'",
        [row.id]
      );
    const failRow = (reason) =>
      pool.query("UPDATE email_campaign_recipients SET status = 'failed', error = ? WHERE id = ? AND status = 'sending'", [clip(reason), row.id]);

    let smtp;
    let mail;
    try {
      // Excluded by an admin since the audience was frozen: never send.
      const [[supp]] = await pool.query("SELECT 1 AS s FROM email_suppressions WHERE email_norm = ?", [row.email_norm]);
      if (supp) {
        await pool.query(
          "UPDATE email_campaign_recipients SET status = 'skipped', error = 'Excluded before this email was sent' WHERE id = ?",
          [row.id]
        );
        return "quick";
      }

      const [[campaign]] = await pool.query("SELECT * FROM email_campaigns WHERE id = ?", [row.campaign_id]);
      if (!campaign || campaign.status !== "sending") {
        await requeueUntouched();
        return "quick";
      }

      // The kill switch, read from the database every time — not from the
      // transport cache, which does not notice a change made within a second.
      const [[settings]] = await pool.query("SELECT host, enabled FROM smtp_settings WHERE id = 1");
      if (!settings?.host) {
        await requeueUntouched();
        await pauseCampaign(row.campaign_id, "Email sending is not configured — set up SMTP under Settings, then resume.");
        return "quick";
      }
      if (!Number(settings.enabled)) {
        await requeueUntouched();
        await pauseCampaign(row.campaign_id, "Email campaigns are turned off under Settings → Email — turn them on, then resume.");
        return "quick";
      }

      smtp = await loadTransport(pool);
      if (!smtp?.transport) {
        await requeueUntouched();
        await pauseCampaign(row.campaign_id, "Email sending is not configured — set up SMTP under Settings, then resume.");
        return "quick";
      }

      try {
        mail = renderCampaign(
          {
            subject: campaign.subject,
            preheader: campaign.preheader,
            heading: campaign.heading,
            subheading: campaign.subheading,
            layout: campaign.layout,
            bodyHtml: campaign.body_html,
            bodyText: campaign.body_text,
          },
          { email: row.email, phone: row.phone, village: row.village }
        );
      } catch (e) {
        await failRow(`This email could not be built for this recipient: ${e.message}`);
        return "quick";
      }
    } catch (e) {
      // A database error before anything was sent.
      lastError = clip(e.message);
      console.error(`[Campaigns] before sending #${row.id}:`, e.message);
      await requeueUntouched().catch(() => {}); // if this fails too, the sweep reports it
      cooldownUntil = now() + COOLDOWN_MS;
      return "idle";
    }

    // ── The only step that talks to the mail server ──────────────────────
    let info;
    try {
      info = await smtp.transport.sendMail({
        from: smtp.from,
        // An address object, so the library sends to exactly this address and
        // does not re-parse the text.
        to: { name: "", address: row.email },
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        attachments: mail.attachments,
      });
    } catch (err) {
      const kind = classifySendError(err);
      const reason = clip(err?.response || err?.message || "Send failed");
      lastError = reason;
      try {
        if (kind === "auth" || kind === "account") {
          await requeueUntouched();
          await pauseCampaign(
            row.campaign_id,
            kind === "auth" ? `The mail server refused the sign-in: ${reason}` : `The mail server refused to send from this mailbox: ${reason}`
          );
          cooldownUntil = now() + COOLDOWN_MS;
          return "idle";
        }
        if (kind === "permanent" || attempts >= MAX_ATTEMPTS) {
          await failRow(reason);
          consecutiveRejections += 1;
          if (consecutiveRejections >= CONSECUTIVE_REJECTIONS_TO_PAUSE) {
            consecutiveRejections = 0;
            await pauseCampaign(
              row.campaign_id,
              `The last ${CONSECUTIVE_REJECTIONS_TO_PAUSE} emails were all rejected — paused so the rest are not wasted. Latest: ${reason}`
            );
          }
        } else {
          const minutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
          await pool.query(
            `UPDATE email_campaign_recipients
                SET status = 'queued', error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
              WHERE id = ? AND status = 'sending'`,
            [reason, minutes, row.id]
          );
          if (kind === "throttled" || kind === "connection") cooldownUntil = now() + COOLDOWN_MS;
        }
      } catch (e) {
        console.error(`[Campaigns] recording failure for #${row.id}:`, e.message); // the sweep will report it
      }
      return "sent"; // a message was attempted: keep the pace
    }

    // ── Accepted by the mail server. From here the row must never be resent. ──
    consecutiveRejections = 0;
    lastSendAt = new Date(now());
    lastError = null;
    const rejected = Array.isArray(info?.rejected) && info.rejected.length > 0;
    try {
      if (rejected) {
        await mustRecord(
          "UPDATE email_campaign_recipients SET status = 'failed', error = ? WHERE id = ?",
          [clip(`Rejected by the mail server: ${info.response || "recipient refused"}`), row.id]
        );
      } else {
        await mustRecord(
          "UPDATE email_campaign_recipients SET status = 'sent', sent_at = NOW(), error = NULL, message_id = ? WHERE id = ?",
          [clip(info?.messageId || "", 255) || null, row.id]
        );
      }
    } catch (e) {
      console.error(`[Campaigns] #${row.id} was ACCEPTED but could not be recorded (${e.message}); left for the sweep, not resent`);
    }
    return "sent";
  }

  return {
    async start() {
      if (active) return;
      active = true;
      try {
        const [r] = await pool.query(
          `UPDATE email_campaign_recipients
              SET status = 'failed',
                  error = 'Interrupted by a server restart while sending — delivery unknown, so it was not sent again. Retry failed to resend.'
            WHERE status = 'sending'`
        );
        if (r.affectedRows) log(`${r.affectedRows} interrupted send(s) marked failed`);
      } catch (e) {
        console.error("[Campaigns] recovery failed:", e.message);
      }
      log(`sender started at ${perMinute}/min`);
      arm(3000);
    },
    stop() {
      active = false;
      clearTimeout(timer);
    },
    /** Look for work now (after a send, resume or retry). */
    kick() {
      if (active && !busy && now() >= cooldownUntil) arm(0);
    },
    status() {
      return { active, busy, perMinute, cooldownUntil: cooldownUntil > now() ? new Date(cooldownUntil) : null, lastSendAt, lastError };
    },
    // For tests: run one step directly.
    _step: () => sendNext(),
  };
}
