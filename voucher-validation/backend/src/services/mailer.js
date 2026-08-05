// src/services/mailer.js
// Outgoing email built from the admin-configured smtp_settings row. One place
// for the encryption->transport mapping so the "send test" and the purchase
// receipt behave identically, and one place for the email templates so the
// Settings page can send a real template to any address for design review.
//
// TEMPLATE CONVENTIONS (ported from the Starlink Portal production build, which
// is verified against Outlook desktop and Gmail). HTML email is not the web:
//   * Nested <table role="presentation"> for ALL layout. Outlook for Windows
//     renders with the Word engine, which ignores div-based layout, flex, and
//     max-width, and drops margins on block elements.
//   * Inline styles only. Gmail strips <style> blocks, so nothing may depend on
//     a stylesheet; font-family is repeated on every text cell because Outlook
//     will not inherit it from <body>.
//   * Fixed width="600" plus max-width:600px. The attribute is what Outlook
//     obeys; the CSS is what lets other clients shrink on mobile.
//   * NO paired [if mso] / [if !mso] blocks that both contain the same visible
//     text. Clients exist that strip the comment markers but keep the contents
//     (new Outlook, Outlook.com), and they then render BOTH copies. Buttons are
//     therefore a single padded <td> with a bgcolor, which Outlook renders as a
//     real filled button because it honours cell padding and cell backgrounds.
//   * border-radius / box-shadow / gradients degrade to square, flat colour in
//     Outlook. That is accepted (same as Starlink) rather than worked around.
//   * Every message ships a plain-text alternative.

import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Brand + layout constants, kept in one place so all templates stay identical.
const RED = "#e60000";
const FONT = "Arial, Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

// A diagonal shift within the Vodafone red hue: a lighter tint into a deeper
// shade, hue held at 0 so it stays unmistakably brand red rather than drifting
// orange or pink. Both stops are just lightness moves off #e60000.
//
// Outlook's Word engine ignores background-image entirely, so EVERY gradient
// surface below must also carry the solid bgcolor attribute + background-color
// underneath. Outlook then renders flat Vodafone red, which is the same result
// as before this change; every other client gets the gradient painted on top.
const RED_LIGHT = "#ff1a1a";
const RED_DARK = "#b00000";
const RED_GRADIENT = `linear-gradient(135deg, ${RED_LIGHT} 0%, ${RED} 55%, ${RED_DARK} 100%)`;

// Corner rounding. IMPORTANT: a radius only clips the background of the SAME
// element. Painting a background on a table AND on its td while rounding only
// the table leaves the td's square fill covering the rounded corners, so every
// coloured block below puts its background and its radius on one element.
// Outlook's Word engine ignores border-radius entirely and renders square
// corners; that is accepted degradation, not a bug.
const CARD_RADIUS = "14px";
const BLOCK_RADIUS = "12px";

// The Vodafone speechmark, embedded inline (cid:) so it renders without the
// recipient's client having to fetch a remote image, and so it survives Gmail's
// image proxy and Outlook's remote-content blocking. Read once at startup.
//
// The asset MUST keep its alpha channel. Flattening it onto white paints a white
// card around the mark, which is glaringly wrong in Outlook's dark theme (Outlook
// desktop repaints the surrounding cell dark and ignores our light-only hint, but
// it cannot repaint pixels baked into the image). Transparent, the red mark reads
// correctly on both the light and the dark surface.
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
    // Declared explicitly (nodemailer would infer it) so the Gmail app does not
    // also surface the logo as a downloadable attachment chip on a receipt.
    contentDisposition: "inline",
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

/* ------------------------------------------------------------------ blocks */

/**
 * A call-to-action button, built from ONE cell that works in every client.
 *
 * The obvious approach is a VML <v:roundrect> behind [if mso] paired with an
 * HTML button behind [if !mso]. Do not reintroduce it: the label then exists
 * TWICE in the source, and any client that strips conditional-comment markers
 * while keeping their contents renders both, so the recipient sees the VML's
 * text and the real button stacked. New Outlook and Outlook.com do exactly
 * this, and it was reported from a live send.
 *
 * A padded <td> with a bgcolor is a genuine filled button in Outlook too:
 * the Word engine honours cell padding and cell backgrounds. Only the rounded
 * corners and the gradient are lost there, which is the same degradation the
 * rest of this file already accepts. One label in the source, one button on
 * screen, no conditional comments involved.
 */
function button({ href, label }) {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:28px 0;">
                <tr>
                  <td align="center" style="font-family:${FONT};">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;">
                      <tr>
                        <td align="center" bgcolor="${RED}" style="background-color:${RED};background-image:${RED_GRADIENT};border-radius:${BLOCK_RADIUS};padding:15px 30px;font-family:${FONT};">
                          <a href="${h}" style="display:inline-block;color:#ffffff;font-family:${FONT};font-size:16px;font-weight:bold;line-height:20px;mso-line-height-rule:exactly;text-decoration:none;border:none;"><span style="color:#ffffff;text-decoration:none;">${l}</span></a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>`;
}

/** A tinted panel with a red rule down its left edge (the Starlink notice box). */
function callout({ heading, html, bg = "#f8f9fa" }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:28px 0;">
                <tr>
                  <td align="left" valign="top" bgcolor="${bg}" style="background-color:${bg};border-radius:${BLOCK_RADIUS};padding:22px 24px;border-left:4px solid ${RED};font-family:${FONT};">
                    ${heading ? `<h3 style="color:#333333;margin:0 0 10px 0;font-family:${FONT};font-size:16px;font-weight:bold;line-height:21px;mso-line-height-rule:exactly;">${esc(heading)}</h3>` : ""}
                    ${html}
                  </td>
                </tr>
              </table>`;
}

/** The "if the button does not work" raw-URL box. */
function linkFallback(url) {
  const u = esc(url);
  return `<p style="color:#666666;font-family:${FONT};font-size:14px;line-height:21px;mso-line-height-rule:exactly;margin:24px 0 12px 0;">
                If the button does not work, copy and paste this link into your browser:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 8px 0;">
                <tr>
                  <td align="left" bgcolor="#f8f9fa" style="background-color:#f8f9fa;border:1px solid #e9ecef;border-radius:${BLOCK_RADIUS};padding:14px 16px;font-family:${MONO};font-size:12px;line-height:18px;mso-line-height-rule:exactly;word-break:break-all;">
                    <a href="${u}" style="color:${RED};text-decoration:none;font-family:${MONO};font-size:12px;"><span style="color:${RED};">${u}</span></a>
                  </td>
                </tr>
              </table>`;
}

/**
 * The shared document chrome: Outlook-safe head, a white masthead carrying the
 * Vodafone speechmark, the red title band, the caller's content, and a footer.
 *
 * The logo sits on WHITE, not on the red band: the asset is the red speechmark,
 * so it would be invisible against red. Keeping the red band underneath means
 * the mail still reads as Vodafone even when a client blocks images entirely.
 *
 * Keep HTML comments inside the template SHORT and structural. Everything in
 * here is shipped to the recipient and is visible in "view source", so rationale
 * belongs in JS comments like this one, which do not.
 *
 * Two things are deliberately ABSENT, both removed after a live send rendered
 * the CTA twice (see button() for the full story):
 *   * No [if mso] CSS block. It only ever caught elements declaring no font of
 *     their own, and every text element here sets font-family, mso-table-lspace
 *     and an explicit px line-height inline, so it bought nothing, while a
 *     marker-stripping client could spill the CSS into the body as text.
 *   * No [if mso] ghost table around the card. The card's width="600" attribute
 *     is already what Outlook obeys, so the ghost was redundant; revealed, it
 *     becomes a hard 600px table that forces sideways scrolling on a phone.
 *
 * The card's width is pinned three ways: the width attribute (what Outlook
 * obeys), max-width (lets other clients shrink), and align=center.
 */
function shell({ preheader, title, subtitle, body }) {
  // alt="" on purpose: the cell immediately to the right carries live
  // "Vodafone Fiji" text, so the mark is decorative. Screen readers skip the
  // duplicate, and a blocked image leaves a clean 44px gap instead of a red
  // letter fragment clipped to the image box.
  const masthead = _logoBuf
    ? `<img src="cid:${LOGO_CID}" width="44" height="44" border="0" alt="" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`
    : "";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <!-- Outlook DPI lock -->
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;font-family:${FONT};background-color:#f8f9fa;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader (inbox snippet) -->
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;opacity:0;color:#f8f9fa;font-size:1px;line-height:1px;">${esc(preheader || "")}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9fa" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0;padding:0;background-color:#f8f9fa;">
    <tr>
      <td align="center" valign="top" style="padding:32px 16px;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

        <!-- Card -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" align="center" bgcolor="#ffffff" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;width:100%;max-width:600px;background-color:#ffffff;border-radius:${CARD_RADIUS};overflow:hidden;">

          <!-- Masthead -->
          <tr>
            <td align="left" valign="middle" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:${CARD_RADIUS} ${CARD_RADIUS} 0 0;padding:26px 30px 20px 30px;font-family:${FONT};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
                <tr>
                  ${masthead ? `<td valign="middle" style="padding-right:12px;">${masthead}</td>` : ""}
                  <td valign="middle" style="font-family:${FONT};font-size:15px;font-weight:bold;color:#333333;line-height:20px;mso-line-height-rule:exactly;">
                    Vodafone Fiji<br>
                    <span style="font-family:${FONT};font-size:12px;font-weight:normal;color:#777777;">Universal Service Obligation</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title band -->
          <tr>
            <td align="center" valign="top" bgcolor="#ffffff" style="background-color:#ffffff;padding:0 30px;font-family:${FONT};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
                <tr>
                  <td align="center" valign="top" bgcolor="${RED}" style="background-color:${RED};background-image:${RED_GRADIENT};border-radius:${BLOCK_RADIUS};padding:26px 24px;text-align:center;font-family:${FONT};">
                    <h1 style="color:#ffffff;margin:0;font-family:${FONT};font-size:24px;font-weight:bold;line-height:30px;mso-line-height-rule:exactly;">
                      <!--[if mso]><span style="font-family:${FONT};font-size:22px;"><![endif]-->${esc(title)}<!--[if mso]></span><![endif]-->
                    </h1>
                    ${
                      subtitle
                        ? `<p style="color:#ffffff;margin:10px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;mso-line-height-rule:exactly;">
                      <!--[if mso]><span style="font-family:${FONT};font-size:13px;"><![endif]-->${esc(subtitle)}<!--[if mso]></span><![endif]-->
                    </p>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td align="left" valign="top" bgcolor="#ffffff" style="background-color:#ffffff;padding:30px 30px 30px 30px;font-family:${FONT};">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" valign="top" bgcolor="#f8f9fa" style="background-color:#f8f9fa;border-radius:0 0 ${CARD_RADIUS} ${CARD_RADIUS};padding:24px 30px;text-align:center;border-top:1px solid #eeeeee;font-family:${FONT};">
              <p style="color:#666666;font-family:${FONT};font-size:12px;line-height:19px;mso-line-height-rule:exactly;margin:0;">
                Vodafone Fiji | Universal Service Obligation (USO)<br>
                This is an automated message, please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* --------------------------------------------------------------- templates */

/**
 * The purchase-receipt email: successful transaction plus the voucher code, how
 * to authenticate manually if it did not auto-connect, the status-page link, and
 * the note that the code is shared across any number of devices (one data pool).
 * Returns { subject, text, html, attachments } so the caller just spreads it.
 */
export function buildReceipt({ voucherCode, statusUrl, planName, dataAllowance, amount } = {}) {
  // Guard the raw interpolations below: an absent code must not print the
  // string "undefined" into the text part or the inbox preview line.
  const code = voucherCode == null ? "" : String(voucherCode);
  const amt =
    amount != null && !Number.isNaN(Number(amount)) ? `FJD ${Number(amount).toFixed(2)}` : null;
  // A hyphen reads better than a comma between the plan and its allowance
  // ("Daily Wi-Fi - 2 GB"). Plain ASCII hyphen, never an em or en dash.
  const planLine = planName ? `${planName}${dataAllowance ? ` - ${dataAllowance}` : ""}` : null;

  const subject = "Your Vodafone Fiji Wi-Fi voucher (payment successful)";

  const text = [
    "PAYMENT SUCCESSFUL",
    "",
    "Thank you. Your payment has been received and your Wi-Fi plan is ready to use.",
    "",
    `Voucher code: ${code}`,
    planLine ? `Plan: ${planLine}` : null,
    amt ? `Amount paid: ${amt}` : null,
    "",
    "HOW TO GET ONLINE",
    "If your device did not connect automatically, open the Wi-Fi portal and enter",
    "the voucher code above to get online.",
    statusUrl ? "" : null,
    statusUrl ? `Check your connection or reconnect here:\n${statusUrl}` : null,
    "",
    "PLEASE NOTE",
    "This voucher code can be shared across any number of devices. Every device",
    "that uses it draws from the same shared data pool.",
    "",
    "Need help? Please contact our support team.",
    "",
    "Vodafone Fiji | Universal Service Obligation (USO)",
    "This is an automated message, please do not reply to this email.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = `<p style="color:#333333;font-family:${FONT};font-size:16px;line-height:24px;mso-line-height-rule:exactly;margin:0 0 20px 0;">
                Thank you. Your payment has been received and your <strong>Wi-Fi plan is ready to use</strong>.
              </p>

              <!-- Voucher code -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 26px 0;">
                <tr>
                  <td align="center" bgcolor="${RED}" style="background-color:${RED};background-image:${RED_GRADIENT};border-radius:${BLOCK_RADIUS};padding:22px 20px;font-family:${FONT};">
                    <p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;color:#ffffff;text-transform:uppercase;letter-spacing:1px;font-weight:bold;line-height:16px;mso-line-height-rule:exactly;">Your voucher code</p>
                    <p style="margin:0;font-family:${MONO};font-size:26px;font-weight:bold;letter-spacing:2px;color:#ffffff;line-height:34px;mso-line-height-rule:exactly;word-break:break-all;">${esc(code)}</p>
                  </td>
                </tr>
              </table>

              ${
                planLine || amt
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 28px 0;">
                ${
                  planLine
                    ? `<tr>
                  <td style="padding:9px 0;font-family:${FONT};font-size:14px;color:#888888;border-bottom:1px solid #f0f2f5;">Plan</td>
                  <td align="right" style="padding:9px 0;font-family:${FONT};font-size:14px;color:#333333;font-weight:bold;border-bottom:1px solid #f0f2f5;">${esc(planLine)}</td>
                </tr>`
                    : ""
                }
                ${
                  amt
                    ? `<tr>
                  <td style="padding:9px 0;font-family:${FONT};font-size:14px;color:#888888;">Amount paid</td>
                  <td align="right" style="padding:9px 0;font-family:${FONT};font-size:14px;color:#333333;font-weight:bold;">${esc(amt)}</td>
                </tr>`
                    : ""
                }
              </table>`
                  : ""
              }

              <h2 style="color:#333333;margin:0 0 10px 0;font-family:${FONT};font-size:18px;font-weight:bold;line-height:24px;mso-line-height-rule:exactly;">How to get online</h2>
              <p style="color:#666666;font-family:${FONT};font-size:15px;line-height:24px;mso-line-height-rule:exactly;margin:0 0 8px 0;">
                If your device did not connect automatically, open the Wi-Fi portal and enter the voucher code above to get online.
              </p>

              ${
                statusUrl
                  ? button({ href: statusUrl, label: "Check my connection" }) + linkFallback(statusUrl)
                  : ""
              }

              ${callout({
                heading: "Please note",
                html: `<p style="color:#666666;font-family:${FONT};font-size:14px;line-height:22px;mso-line-height-rule:exactly;margin:0;">
                      This voucher code can be shared across <strong>any number of devices</strong>. Every device that uses it draws from the same shared data pool.
                    </p>`,
              })}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:32px 0 0 0;">
                <tr>
                  <td align="left" style="padding-top:22px;border-top:1px solid #eeeeee;font-family:Arial, Helvetica, sans-serif;">
                    <p style="color:#999999;font-family:${FONT};font-size:12px;line-height:19px;mso-line-height-rule:exactly;margin:0;">
                      <strong>Need help?</strong><br>
                      If you have any questions or need assistance, please contact our support team.<br>
                      Keep this email; your voucher code is your proof of purchase.
                    </p>
                  </td>
                </tr>
              </table>`;

  return {
    subject,
    text,
    html: shell({
      preheader: code ? `Voucher ${code} - payment successful` : "Payment successful",
      title: "Payment successful",
      subtitle: "Your Wi-Fi voucher is ready to use",
      body,
    }),
    attachments: [logoAttachment()].filter(Boolean),
  };
}

/**
 * A plain "your SMTP settings work" message. Returned in the same shape as the
 * templates so the test-send path is uniform.
 */
export function buildConnectionTest() {
  const subject = "Vodafone Fiji Voucher Manager - SMTP test";
  const text = [
    "SMTP SETTINGS ARE WORKING",
    "",
    "This is a test email from the Voucher Validation admin portal.",
    "If you received it, outgoing mail is configured correctly.",
    "",
    "Vodafone Fiji | Universal Service Obligation (USO)",
    "This is an automated message, please do not reply to this email.",
  ].join("\n");

  const body = `<p style="color:#333333;font-family:${FONT};font-size:16px;line-height:24px;mso-line-height-rule:exactly;margin:0 0 20px 0;">
                This is a test email from the <strong>Voucher Validation</strong> admin portal.
              </p>
              <p style="color:#666666;font-family:${FONT};font-size:15px;line-height:24px;mso-line-height-rule:exactly;margin:0;">
                If you received it, outgoing mail is configured correctly and the portal can send receipts and notifications.
              </p>
              ${callout({
                heading: "What was tested",
                html: `<p style="color:#666666;font-family:${FONT};font-size:14px;line-height:22px;mso-line-height-rule:exactly;margin:0;">
                      The saved SMTP host, port, encryption and credentials were used to deliver this message. No customer email was affected.
                    </p>`,
              })}`;

  return {
    subject,
    text,
    html: shell({
      preheader: "SMTP test from the Voucher Validation admin portal",
      title: "SMTP settings are working",
      subtitle: "Test message from the Voucher Validation portal",
      body,
    }),
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
