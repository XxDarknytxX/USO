// src/services/campaignMail.js
//
// Turns a campaign into the email one customer receives.
//
// ── Layouts ──────────────────────────────────────────────────────────────
//   branded  the author's HTML goes inside the same Outlook-safe Vodafone shell
//            the receipts use (logo, red title band, footer)
//   raw      the author supplies the whole document
//
// ── Merge tags ───────────────────────────────────────────────────────────
//   {{email}} {{phone}} {{village}}
// Values are HTML-escaped wherever they land in HTML, and stripped of line
// breaks in the subject, so a customer's data can never inject markup or
// headers. There is no {{name}}: no customer name exists in this database.
//
// ── No unsubscribe link ─────────────────────────────────────────────────
// Campaigns are one-way announcements sent by the team, with no customer-facing
// unsubscribe page. To stop emailing someone, an admin adds the address to the
// excluded list in the console.
//
// ── Sanitising ───────────────────────────────────────────────────────────
// Campaign HTML is written by an administrator, and mail clients do not run
// script. It is still scrubbed on the way out — script, iframes, objects,
// forms, inline event handlers and javascript: URLs removed — because an email
// is the wrong place for any of them and a pasted template can carry them
// unnoticed. The console's preview additionally renders in a sandboxed iframe,
// which is the real protection for the admin's own session.

import { shell, esc, logoAttachment } from "./mailer.js";

const FONT = "Arial, Helvetica, sans-serif";

export const MERGE_TAGS = ["email", "phone", "village"];

export const SAMPLE_CONTACT = {
  email: "customer@example.com",
  phone: "7771234",
  village: "Nakavu",
};

/** "j***@gmail.com" — enough to recognise in a log, not enough to harvest. */
export function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "***";
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}***@${domain}`;
}

/* ----------------------------------------------------------- content */

/*
 * Everything below walks the HTML ONCE with indexOf, never with regular
 * expressions of the "<a ...>[\s\S]*?</a>" kind. Those backtrack: a body of a
 * few thousand unclosed "<a href=x>" took seconds, and tens of kilobytes took
 * minutes — on the one Node process that also serves the captive portal. Work
 * here is linear in the size of the email, whatever it contains.
 */

/** Splits HTML into text, comment and tag tokens, in one pass. */
function tokenize(html) {
  const out = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push({ type: "text", raw: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ type: "text", raw: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      const stop = end === -1 ? n : end + 3;
      out.push({ type: "comment", raw: html.slice(lt, stop) });
      i = stop;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      out.push({ type: "text", raw: html.slice(lt) });
      break;
    }
    const raw = html.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]{0,40})/.exec(raw);
    if (m) out.push({ type: "tag", raw, closing: m[1] === "/", name: m[2].toLowerCase() });
    else out.push({ type: "text", raw });
    i = gt + 1;
  }
  return out;
}

// Removed along with everything inside them.
const DROP_WITH_CONTENT = new Set(["script", "iframe", "object", "embed", "frameset", "applet", "form", "noscript"]);
// Removed on their own (void or harmless-to-orphan).
const DROP_TAG = new Set(["frame", "input", "button", "textarea", "select", "option", "base"]);

/** An attribute value, one tag at a time (a tag is bounded, so these are cheap). */
function cleanTag(raw) {
  let t = raw.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  t = t.replace(/\b(href|src|action|formaction|background|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (whole, attr, val) => {
    const v = val.replace(/^["']|["']$/g, "").replace(/[\u0000-\u0020]+/g, "").toLowerCase();
    return /^(javascript|vbscript|data:text\/html)/.test(v) ? `${attr}="#"` : whole;
  });
  return t;
}

/** Best-effort removal of things that have no place in an email. */
export function scrubHtml(html) {
  const out = [];
  let skipping = null; // tag name whose content is being dropped
  let depth = 0;
  for (const tok of tokenize(String(html || ""))) {
    if (skipping) {
      if (tok.type === "tag" && tok.name === skipping) {
        if (tok.closing) {
          depth -= 1;
          if (depth === 0) skipping = null;
        } else if (!/\/\s*>$/.test(tok.raw)) {
          depth += 1;
        }
      }
      continue;
    }
    if (tok.type !== "tag") {
      out.push(tok.raw);
      continue;
    }
    if (DROP_WITH_CONTENT.has(tok.name)) {
      if (!tok.closing && !/\/\s*>$/.test(tok.raw)) {
        skipping = tok.name;
        depth = 1;
      }
      continue;
    }
    if (DROP_TAG.has(tok.name)) continue;
    if (tok.name === "meta" && /http-equiv\s*=\s*["']?\s*refresh/i.test(tok.raw)) continue;
    out.push(tok.closing ? tok.raw : cleanTag(tok.raw));
  }
  return out.join("");
}

const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

function fillTags(template, values, { html }) {
  return String(template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (!MERGE_TAGS.includes(key)) return whole;
    const v = values[key] ?? "";
    return html ? esc(v).replace(/'/g, "&#39;") : String(v);
  });
}

const NAMED = { nbsp: " ", zwnj: "", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", middot: "·", hellip: "…", copy: "©", reg: "®", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•" };

/**
 * Decodes entities in ONE pass, so "&amp;#9999999;" becomes the text
 * "&#9999999;" and is never decoded a second time. Numeric references outside
 * Unicode are left exactly as written instead of throwing.
 */
function decodeEntities(s) {
  return s.replace(/&(#[0-9]{1,8}|#x[0-9a-f]{1,7}|[a-z]{2,8});/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    const v = NAMED[ref.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

const HIDDEN = new Set(["head", "style", "script", "title", "noscript"]);
const BLOCK_END = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "li", "table", "blockquote", "ul", "ol"]);

/** A readable plain-text version of an HTML email. */
export function htmlToText(html) {
  const parts = [];
  let hidden = null;
  let hiddenDepth = 0;
  const links = []; // stack of { href, start }
  for (const tok of tokenize(String(html || ""))) {
    if (hidden) {
      if (tok.type === "tag" && tok.name === hidden) {
        hiddenDepth += tok.closing ? -1 : 1;
        if (hiddenDepth <= 0) hidden = null;
      }
      continue;
    }
    if (tok.type === "comment") continue;
    if (tok.type === "text") {
      parts.push(decodeEntities(tok.raw));
      continue;
    }
    const { name, closing } = tok;
    if (!closing && HIDDEN.has(name)) {
      hidden = name;
      hiddenDepth = 1;
      continue;
    }
    if (name === "br") parts.push("\n");
    else if (name === "li" && !closing) parts.push("• ");
    else if (closing && BLOCK_END.has(name)) parts.push("\n");
    else if (name === "a" && !closing) {
      const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tok.raw);
      links.push({ href: m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : "", start: parts.length });
    } else if (name === "a" && closing && links.length) {
      const { href, start } = links.pop();
      const label = parts.slice(start).join("").replace(/\s+/g, " ").trim();
      const skip = !href || href.startsWith("#") || (href.startsWith("mailto:") && label.includes("@"));
      if (!skip && label !== href) parts.push(label ? ` (${href})` : href);
    }
  }
  return parts
    .join("")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The message for one recipient.
 *
 * @param campaign  { subject, preheader, heading, subheading, layout, bodyHtml, bodyText }
 * @param contact   { email, phone, village }
 * @returns { subject, html, text, attachments, warnings }
 */
export function renderCampaign(campaign, contact) {
  const warnings = [];
  const values = {
    email: contact?.email || "",
    phone: contact?.phone || "",
    village: contact?.village || "",
  };
  const layout = campaign.layout === "raw" ? "raw" : "branded";
  const subject = oneLine(fillTags(campaign.subject, values, { html: false }));
  const preheader = oneLine(fillTags(campaign.preheader, values, { html: false }));
  const bodySource = String(campaign.bodyHtml || "");
  const body = fillTags(scrubHtml(bodySource), values, { html: true });

  if (!subject) warnings.push("The subject is empty.");
  if (!bodySource.trim()) warnings.push("The email body is empty.");
  if (scrubHtml(bodySource) !== bodySource) {
    warnings.push("Scripts, forms, embedded frames or event handlers were removed — email clients do not run them.");
  }
  const unknown = [...bodySource.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((t) => !MERGE_TAGS.includes(t));
  if (unknown.length) warnings.push(`Unknown merge tag${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].map((t) => `{{${t}}}`).join(", ")} — sent as written.`);
  if (tokenize(bodySource).some((t) => t.type === "tag" && t.name === "img" && /\bsrc\s*=\s*["']?\s*data:/i.test(t.raw))) {
    warnings.push("Embedded (data:) images are blocked by Gmail and Outlook — host images and link to them instead.");
  }

  let html;
  const attachments = [];
  if (layout === "branded") {
    const title = oneLine(fillTags(campaign.heading, values, { html: false })) || subject;
    html = shell({
      preheader,
      title,
      subtitle: oneLine(fillTags(campaign.subheading, values, { html: false })) || undefined,
      body,
      footerHtml: `Vodafone Fiji | Universal Service Obligation (USO)<br>
                You are receiving this because an email address is registered to your M-PAiSA number.`,
    });
    const logo = logoAttachment();
    if (logo) attachments.push(logo);
  } else {
    html = body;
    if (!/<html\b/i.test(html)) {
      html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;">${html}</body></html>`;
    }
    if (preheader) {
      const pre = `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;opacity:0;font-size:1px;line-height:1px;">${esc(preheader)}</div>`;
      html = /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b[^>]*>/i, (m) => m + pre) : pre + html;
    }
    if (/cid:vodafonelogo/i.test(html)) {
      const logo = logoAttachment();
      if (logo) attachments.push(logo);
    }
  }

  if (Buffer.byteLength(html, "utf8") > 100_000) {
    warnings.push(`This email is ${Math.round(Buffer.byteLength(html, "utf8") / 1024)} KB — Gmail cuts off anything over about 100 KB behind a "View entire message" link.`);
  }

  const ownText = String(campaign.bodyText || "").trim();
  let text = ownText ? fillTags(ownText, values, { html: false }) : htmlToText(layout === "branded" ? body : html);
  if (layout === "branded") text += "\n\n—\nVodafone Fiji | Universal Service Obligation (USO)";

  return { subject, html, text, attachments, warnings };
}
