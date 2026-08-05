// src/services/mailer.js
// Outgoing email built from the admin-configured smtp_settings row. One place
// for the encryption->transport mapping so the "send test" and the purchase
// receipt behave identically, and one place for the email templates so the
// Settings page can send a real template to any address for design review.

import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The Vodafone speechmark, embedded inline (cid:) so it renders without the
// recipient's client having to fetch a remote image. Read once at startup.
let _logoBuf = null;
try {
  _logoBuf = readFileSync(join(__dirname, "..", "assets", "vodafone-logo.png"));
} catch (e) {
  console.warn("[mailer] Vodafone logo asset not found, emails will omit it:", e.message);
}
const LOGO_CID = "vodafonelogo";

/** The inline-logo attachment for an email, or null when the asset is missing. */
export function logoAttachment() {
  if (!_logoBuf) return null;
  return {
    filename: "vodafone-logo.png",
    content: _logoBuf,
    cid: LOGO_CID,
    contentType: "image/png",
  };
}

/**
 * Build a nodemailer transport from the stored SMTP config, or null when no
 * host is configured. `from` is the display sender.
 */
export async function loadSmtpTransport(pool) {
  const [rows] = await pool.query("SELECT * FROM smtp_settings WHERE id = 1");
  const c = rows[0];
  if (!c || !c.host) return null;

  const enc = c.encryption || "starttls";
  const port = c.port || (enc === "ssl" ? 465 : 587);
  const transport = nodemailer.createTransport({
    host: c.host,
    port,
    secure: enc === "ssl", // implicit TLS (465)
    requireTLS: enc === "starttls", // force the STARTTLS upgrade (587)
    auth: c.username ? { user: c.username, pass: c.password || "" } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });

  const fromEmail = c.from_email || c.username || null;
  const from = c.from_name ? `"${c.from_name}" <${fromEmail}>` : fromEmail;
  return { transport, from, config: c };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
}

// Shared chrome so every template looks like one branded family. The logo sits
// on a white header above a thin Vodafone-red rule; a muted footer closes it.
function shell({ preheader, body }) {
  const logo = _logoBuf
    ? `<img src="cid:${LOGO_CID}" width="132" alt="Vodafone" style="display:block;border:0;height:auto;max-width:132px" />`
    : `<div style="font-size:20px;font-weight:800;color:#E60000;letter-spacing:.01em">Vodafone Fiji</div>`;
  return `<!DOCTYPE html>
<div style="margin:0;padding:0;background:#f4f5f7">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f5f7;font-size:1px;line-height:1px">${esc(preheader)}</div>` : ""}
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:28px 16px">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e9ee">
      <div style="padding:24px 32px 16px">${logo}</div>
      <div style="height:3px;background:#E60000"></div>
      <div style="padding:28px 32px 8px">${body}</div>
      <div style="padding:20px 32px 26px;border-top:1px solid #eef0f3;margin-top:24px;color:#98a0ab;font-size:12px;line-height:1.6">
        Vodafone Fiji, Universal Service Obligation (USO).<br />
        This is an automated message, please do not reply to this email.
      </div>
    </div>
  </div>
</div>`;
}

/**
 * The purchase-receipt email: successful transaction plus the voucher code, how
 * to authenticate manually if it did not auto-connect, the status-page link, and
 * the note that the code is shared across any number of devices (one data pool).
 * Returns { subject, text, html, attachments } so the caller just spreads it.
 */
export function buildReceipt({ voucherCode, statusUrl, planName, dataAllowance, amount } = {}) {
  const amt =
    amount != null && !Number.isNaN(Number(amount)) ? `FJD ${Number(amount).toFixed(2)}` : null;
  const planLine = planName ? `${planName}${dataAllowance ? `, ${dataAllowance}` : ""}` : null;

  const subject = "Your Vodafone Fiji Wi-Fi voucher (payment successful)";

  const text = [
    "Payment successful.",
    "",
    "Thank you. Your payment has been received and your Wi-Fi plan is ready to use.",
    "",
    `Voucher code: ${voucherCode}`,
    planLine ? `Plan: ${planLine}` : null,
    amt ? `Amount paid: ${amt}` : null,
    "",
    "How to get online",
    "If your device did not connect automatically, open the Wi-Fi portal and enter the",
    "voucher code above to get online.",
    statusUrl ? `Check your connection or reconnect here: ${statusUrl}` : null,
    "",
    "Please note: this voucher code can be shared across any number of devices.",
    "Every device that uses it draws from the same shared data pool.",
    "",
    "Vodafone Fiji, Universal Service Obligation (USO).",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = `
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#E60000;font-weight:700">Payment confirmation</p>
    <h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:#1a1d21;font-weight:700">Payment successful</h1>
    <p style="margin:0 0 22px;color:#5a6472;font-size:14px;line-height:1.6">Thank you. Your payment has been received and your Wi-Fi plan is ready to use.</p>

    <div style="background:#fbf4f4;border:1px solid #f1dada;border-radius:12px;padding:18px;text-align:center;margin-bottom:22px">
      <p style="margin:0 0 8px;font-size:11px;color:#8a929d;text-transform:uppercase;letter-spacing:.09em;font-weight:600">Your voucher code</p>
      <p style="margin:0;font-size:27px;font-weight:800;letter-spacing:.06em;color:#E60000;font-family:'Courier New',monospace">${esc(voucherCode)}</p>
    </div>

    ${
      planLine || amt
        ? `<table role="presentation" style="width:100%;font-size:14px;color:#3a424e;margin:0 0 24px;border-collapse:collapse">
            ${planLine ? `<tr><td style="padding:7px 0;color:#8a929d;border-bottom:1px solid #f0f2f5">Plan</td><td style="padding:7px 0;text-align:right;font-weight:600;border-bottom:1px solid #f0f2f5">${esc(planLine)}</td></tr>` : ""}
            ${amt ? `<tr><td style="padding:7px 0;color:#8a929d">Amount paid</td><td style="padding:7px 0;text-align:right;font-weight:600">${esc(amt)}</td></tr>` : ""}
           </table>`
        : ""
    }

    <h2 style="margin:0 0 8px;font-size:15px;color:#1a1d21;font-weight:700">How to get online</h2>
    <p style="margin:0 0 16px;color:#3a424e;font-size:14px;line-height:1.6">
      If your device did not connect automatically, open the Wi-Fi portal and enter the voucher code above to get online.
    </p>

    ${
      statusUrl
        ? `<div style="margin:0 0 12px">
             <a href="${esc(statusUrl)}" style="display:inline-block;background:#E60000;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px">Check connection or reconnect</a>
           </div>
           <p style="margin:0 0 22px;font-size:12px;color:#98a0ab;word-break:break-all">${esc(statusUrl)}</p>`
        : ""
    }

    <div style="background:#f6f8fa;border:1px solid #eef0f3;border-radius:12px;padding:14px 16px;color:#4a5462;font-size:13px;line-height:1.6">
      <strong style="color:#1a1d21">Please note:</strong> this voucher code can be shared across any number of devices. Every device that uses it draws from the same shared data pool.
    </div>`;

  return {
    subject,
    text,
    html: shell({ preheader: `Voucher ${voucherCode}, payment successful`, body }),
    attachments: [logoAttachment()].filter(Boolean),
  };
}

/**
 * A plain "your SMTP settings work" message. Returned in the same shape as the
 * templates so the test-send path is uniform.
 */
export function buildConnectionTest() {
  const subject = "Vodafone Fiji Voucher Manager, SMTP test";
  const text =
    "This is a test email from the Voucher Validation admin portal. " +
    "If you received it, your SMTP settings are working correctly.";
  const body = `
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#E60000;font-weight:700">Settings test</p>
    <h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:#1a1d21;font-weight:700">SMTP settings are working</h1>
    <p style="margin:0 0 8px;color:#5a6472;font-size:14px;line-height:1.6">
      This is a test email from the Voucher Validation admin portal. If you received it, outgoing mail is configured correctly.
    </p>`;
  return {
    subject,
    text,
    html: shell({ preheader: "SMTP test from the Voucher Validation admin portal", body }),
    attachments: [logoAttachment()].filter(Boolean),
  };
}

// Registry the Settings page reads to populate the "template" dropdown. Each
// entry can render a fully-populated sample for design review.
export const EMAIL_TEMPLATES = [
  { id: "connection", name: "Connection test" },
  { id: "receipt", name: "Purchase receipt" },
];

// Realistic sample data so a test receipt looks like the real thing.
const SAMPLE_RECEIPT = {
  voucherCode: "USO-TEST-8842",
  statusUrl: "https://uso2.vodafonefiji.cloud/status",
  planName: "Daily Wi-Fi",
  dataAllowance: "2 GB",
  amount: 2.0,
};

/**
 * Render a named template with sample data for a test send. Unknown ids fall
 * back to the plain connection test, so this never returns null.
 * @returns {{subject,text,html,attachments}}
 */
export function renderTemplate(id) {
  switch (id) {
    case "receipt":
      return buildReceipt(SAMPLE_RECEIPT);
    case "connection":
    default:
      return buildConnectionTest();
  }
}
