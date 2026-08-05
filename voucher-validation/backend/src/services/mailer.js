// src/services/mailer.js
// Outgoing email built from the admin-configured smtp_settings row. One place
// for the encryption→transport mapping so the "send test" and the purchase
// receipt behave identically.

import nodemailer from "nodemailer";

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

/**
 * The purchase-receipt email: successful transaction + the voucher code, how to
 * authenticate manually if it didn't auto-connect, the status-page link, and the
 * note that the code is shared across any number of devices (one data pool).
 */
export function buildReceipt({ voucherCode, statusUrl, planName, dataAllowance, amount }) {
  const amt =
    amount != null && !Number.isNaN(Number(amount)) ? `FJD ${Number(amount).toFixed(2)}` : null;
  const planLine = planName ? `${planName}${dataAllowance ? ` — ${dataAllowance}` : ""}` : null;

  const subject = "Your Vodafone Fiji Wi-Fi voucher — payment successful";

  const text = [
    "Thank you — your payment was successful.",
    "",
    `Voucher code: ${voucherCode}`,
    planLine ? `Plan: ${planLine}` : null,
    amt ? `Amount: ${amt}` : null,
    "",
    "If you were not connected automatically, open the Wi-Fi portal and enter the",
    "voucher code above to get online.",
    statusUrl ? `Check your connection or reconnect here: ${statusUrl}` : null,
    "",
    "Note: this voucher code can be shared with any number of devices — they all",
    "draw from the same data pool.",
    "",
    "Vodafone Fiji · USO",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = `
  <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f5f6f8;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #eceef1">
      <div style="height:4px;background:#E60000"></div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E60000;font-weight:700">Vodafone Fiji · USO</p>
        <h1 style="margin:0 0 6px;font-size:20px;color:#111">Payment successful ✅</h1>
        <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.5">Thank you — your Wi-Fi plan is ready. Here is your voucher.</p>

        <div style="background:#faf3f3;border:1px solid #f0d9d9;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px">
          <p style="margin:0 0 6px;font-size:12px;color:#777;text-transform:uppercase;letter-spacing:.06em">Voucher code</p>
          <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:.05em;color:#E60000;font-family:monospace">${esc(voucherCode)}</p>
        </div>

        ${
          planLine || amt
            ? `<table style="width:100%;font-size:13px;color:#444;margin-bottom:20px;border-collapse:collapse">
                ${planLine ? `<tr><td style="padding:4px 0;color:#888">Plan</td><td style="padding:4px 0;text-align:right;font-weight:600">${esc(planLine)}</td></tr>` : ""}
                ${amt ? `<tr><td style="padding:4px 0;color:#888">Amount</td><td style="padding:4px 0;text-align:right;font-weight:600">${esc(amt)}</td></tr>` : ""}
               </table>`
            : ""
        }

        <p style="margin:0 0 14px;color:#444;font-size:14px;line-height:1.55">
          If you were <strong>not connected automatically</strong>, open the Wi-Fi portal and enter the voucher code above to get online.
        </p>

        ${
          statusUrl
            ? `<div style="text-align:center;margin:0 0 18px">
                 <a href="${esc(statusUrl)}" style="display:inline-block;background:#E60000;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:10px">Check connection / reconnect</a>
               </div>
               <p style="margin:0 0 18px;text-align:center;font-size:12px;color:#999;word-break:break-all">${esc(statusUrl)}</p>`
            : ""
        }

        <div style="background:#f6f8fa;border-radius:10px;padding:12px 14px;color:#555;font-size:13px;line-height:1.5">
          💡 This voucher code can be shared with <strong>any number of devices</strong> — they all draw from the same data pool.
        </div>
      </div>
      <div style="padding:14px 28px;border-top:1px solid #eceef1;color:#aaa;font-size:11px">Vodafone Fiji · Universal Service Obligation</div>
    </div>
  </div>`;

  return { subject, text, html };
}
