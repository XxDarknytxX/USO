// src/utils/allocation.js
//
// A Ruijie user group's allocation, as text a customer can read.
//
// ── Units ─────────────────────────────────────────────────────────────────
// Ruijie reports a user group the way it reports a voucher: quota in MB, time
// period in minutes, rate limits in Kbps, and 0 meaning "no limit". The voucher
// generator (VoucherCreateForm) and the Excel voucher parser read the same
// fields with the same units.
//
// ── Why the wording matters ───────────────────────────────────────────────
// A plan's "Data allowance" is customer-facing. The captive portal takes the
// FIRST number in it as the data figure — megabytes unless the text says GB or
// TB, "Unlimited" for no cap (uso-portal main-page.jsx dataToGB) — and the
// receipt email prints it verbatim. So the data figure always comes first, with
// its unit, and nothing before it carries a digit.
//
// The console used to autofill "8192 / 10080s / ↓2048": minutes labelled as
// seconds, no units, and for an unlimited group the portal read the time period
// as the data figure. That legacy shape is still recognised here, so plans
// saved with it are treated as autofilled text and brought up to date.

const hasValue = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const trim1 = (n) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** 2048 → "2 GB", 500 → "500 MB", 0 → "Unlimited data". */
export function formatQuotaMb(mb) {
  const v = Number(mb);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v === 0) return "Unlimited data";
  if (v < 1024) return `${trim1(v)} MB`;
  return `${trim1(v / 1024)} GB`;
}

/** 1440 → "1 day", 10080 → "1 week", 90 → "90 minutes", 0 → null (no limit). */
export function formatPeriodMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m % 10080 === 0) return plural(m / 10080, "week");
  if (m % 1440 === 0) return plural(m / 1440, "day");
  if (m % 60 === 0) return plural(m / 60, "hour");
  return plural(Math.round(m), "minute");
}

/** 4096 → "4 Mbps", 512 → "512 Kbps", 0 → null (no limit). */
export function formatRateKbps(kbps) {
  const k = Number(kbps);
  if (!Number.isFinite(k) || k <= 0) return null;
  if (k < 1000) return `${Math.round(k)} Kbps`;
  return `${trim1(k / 1024)} Mbps`;
}

/**
 * Whether a group carries allocation data at all. Groups the console only knows
 * from its voucher mirror (Ruijie unreachable, or another village's group) come
 * back with every field null.
 */
export function hasAllocation(group) {
  return !!group && (hasValue(group.quota) || hasValue(group.timePeriod) || hasValue(group.downloadRateLimit));
}

/**
 * The customer-facing allowance for a group: "2 GB / 1 day / 4 Mbps".
 *
 * null unless Ruijie gave a quota figure. The data amount is the part the
 * portal sells, so without it there is nothing safe to write: an absent quota
 * is "not reported", not "unlimited" (only an explicit 0 means that), and a
 * label without one would have the portal read the period's number as the data
 * ("1 day" → 1 MB). Never the group name either, which the portal would mine
 * for a digit ("7DayPass" → 7 MB).
 */
export function allocationLabel(group) {
  if (!group || !hasValue(group.quota)) return null;
  const parts = [
    formatQuotaMb(group.quota),
    formatPeriodMinutes(group.timePeriod),
    formatRateKbps(group.downloadRateLimit),
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}

/** The pieces, for a read-out beside the picker. */
export function allocationParts(group) {
  if (!hasAllocation(group)) return [];
  return [
    { label: "Data", value: hasValue(group.quota) ? formatQuotaMb(group.quota) : "—" },
    { label: "Validity", value: hasValue(group.timePeriod) ? formatPeriodMinutes(group.timePeriod) || "No limit" : "—" },
    { label: "Download", value: hasValue(group.downloadRateLimit) ? formatRateKbps(group.downloadRateLimit) || "No limit" : "—" },
    { label: "Upload", value: hasValue(group.uploadRateLimit) ? formatRateKbps(group.uploadRateLimit) || "No limit" : "—" },
    { label: "Devices", value: hasValue(group.noOfDevice) ? (Number(group.noOfDevice) === 0 ? "No limit" : String(group.noOfDevice)) : "—" },
  ];
}

// "2 GB", "500 MB", "Unlimited data" / "1 day", "90 minutes" / "4 Mbps", "512 Kbps"
const NEW_PART = [
  /^(Unlimited data|\d+(\.\d)? (MB|GB))$/,
  /^\d+ (minute|hour|day|week)s?$/,
  /^\d+(\.\d)? (Kbps|Mbps)$/,
];
// Legacy autofill pieces: "8192", "10080s", "↓2048".
const LEGACY_PART = /^(\d+(\.\d+)?|\d+s|↓\d+)$/;

/**
 * True when the text is something the console wrote, not an admin: empty, the
 * current format, the legacy "8192 / 10080s / ↓2048" shape, or one of the
 * fallbacks older versions filled in when they had no figures — the group's or
 * the plan's name, or "Standard". Pass those names as `fallbacks`. Only such
 * text is replaced automatically; anything an admin typed is left alone.
 */
export function isAutoAllowance(text, fallbacks = []) {
  const s = String(text ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower === "standard") return true;
  if (fallbacks.some((f) => f && String(f).trim().toLowerCase() === lower)) return true;
  const parts = s.split("/").map((p) => p.trim());
  if (parts.some((p) => !p)) return false;
  if (parts.every((p) => LEGACY_PART.test(p))) return true;
  // The current format: the data figure, then optionally a period, then
  // optionally a speed, each at most once and in that order.
  let slot = 0;
  for (const p of parts) {
    while (slot < NEW_PART.length && !NEW_PART[slot].test(p)) slot++;
    if (slot === NEW_PART.length) return false;
    slot++;
  }
  return true;
}

/**
 * The data figure a customer is shown for this text, in GB — the same reading
 * the portal applies. Infinity for unlimited, null when there is no figure.
 */
export function dataGbShown(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/unlimited/i.test(s)) return Infinity;
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/tb/i.test(s)) return n * 1024;
  if (/gb/i.test(s)) return n;
  return n / 1024;
}

/** The group's data figure in GB. Infinity for unlimited, null if unknown. */
export function dataGbLive(group) {
  if (!group || !hasValue(group.quota)) return null;
  const q = Number(group.quota);
  return q === 0 ? Infinity : q / 1024;
}

/**
 * A GB figure as the portal card prints it (uso-portal main-page.jsx gbLabel):
 * "Unlimited data", "2 GB", "1.3 GB", "500 MB".
 */
export function portalDataLabel(gb) {
  if (gb == null) return null;
  if (gb === Infinity) return "Unlimited data";
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  return `${Math.round(gb * 1024)} MB`;
}

// The figure a customer reads, reduced to a comparable value: "2 GB" and
// "2.0 GB" are the same thing on a phone screen.
function portalFigure(gb) {
  if (gb == null) return null;
  if (gb === Infinity) return "unlimited";
  if (gb >= 1) return `${Number(gb.toFixed(1))}GB`;
  return `${Math.round(gb * 1024)}MB`;
}

/**
 * Whether the data figure customers see for this plan differs from what the
 * group now gives — compared as the portal card prints both, so a label the
 * console wrote itself (1280 MB → "1.3 GB") is never reported as drift. Unknown
 * on either side is not drift.
 */
export function dataDrifts(text, group) {
  const shown = dataGbShown(text);
  const live = dataGbLive(group);
  if (shown == null || live == null) return false;
  return portalFigure(shown) !== portalFigure(live);
}

/** A user group's id as the plan stores it. */
export const groupKey = (g) => String(g?.id ?? g?.userGroupId ?? g?._id ?? g?.name ?? "");
