// src/components/campaigns/campaignUi.jsx
//
// The small vocabulary every email-campaign screen shares: what each status is
// called and what colour it wears, how an audience is described in one line,
// how a delivery count is drawn. The list, the editor and the report all read
// from here, so a paused campaign cannot be amber on one screen and grey on the
// next, and "Everyone · purchasers only" is phrased the same wherever it shows.

import { useEffect, useState } from "react";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { StatusPill } from "../ui";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

/* ───────────────────────── Viewport ───────────────────────── */

const PHONE_QUERY = "(max-width: 639px)";

function phoneNow() {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(PHONE_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * True below Tailwind's `sm` breakpoint. For the few choices CSS cannot make
 * on its own — which preview device to open on, whether a filter has room for
 * its counts. Layout itself stays in responsive classes.
 */
export function useIsPhone() {
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return phone;
}

/* ───────────────────────── Phone cards ─────────────────────────
 * Used with PHONE_CARD from components/ui/phone, which turns a stacked table
 * row into a six-track grid. (It moved out of components/MonthlyBreakdown:
 * importing it from there dragged recharts into pages with no charts.) */

/**
 * A full-width, label-less line inside a phone card — for a value that explains
 * itself and needs the width: a delivery bar, an error message, the moment
 * something was sent. The stacked-table rules in main.css are unlayered, so
 * every property they set has to be taken back with the important form.
 */
export const PHONE_WIDE =
  "max-sm:col-span-6 max-sm:text-left! max-sm:before:hidden! max-sm:[&>*]:ml-0! max-sm:[&>*]:w-full!";

/* ───────────────────────── Phone header ─────────────────────────
 * PageHeader's row of buttons is only as wide as the buttons, so on a phone a
 * header with two of them left half its card empty. Given to PageHeader as its
 * className, PHONE_HEADER_FILL stretches that row across the card, so a button
 * marked max-sm:flex-1 fills what is left. PHONE_HEADER_BARE is for a header
 * that shows no sentence on a phone: it also drops the gap the heading (read
 * from the app bar there) leaves above the buttons. Phones only — PageHeader's
 * own markup is untouched, and desktop never sees either. */
export const PHONE_HEADER_FILL = "max-sm:[&>div>div:last-child>div:last-child]:flex-1";
export const PHONE_HEADER_BARE = `${PHONE_HEADER_FILL} max-sm:[&>div]:gap-0`;

/* ───────────────────────── Status ───────────────────────── */

export const CAMPAIGN_STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  sending: { label: "Sending", tone: "info", live: true },
  paused: { label: "Paused", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/**
 * A campaign's state. "Sending" gets a pulsing dot rather than the static one:
 * it is the only state that changes while you watch, and the pulse is what
 * tells someone the numbers beside it are still moving.
 */
export function CampaignStatusPill({ status, className }) {
  const meta = CAMPAIGN_STATUS[status] || { label: status || "Unknown", tone: "neutral" };
  if (!meta.live) return <StatusPill tone={meta.tone} className={className}>{meta.label}</StatusPill>;
  return (
    <StatusPill tone={meta.tone} dot={false} className={className}>
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--info-fg)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--info-fg)]" />
      </span>
      {meta.label}
    </StatusPill>
  );
}

export const RECIPIENT_STATUS = {
  queued: { label: "Queued", tone: "neutral" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
};

/* ───────────────────────── Words ───────────────────────── */

export const plural = (n, one, many = `${one}s`) =>
  `${Number(n || 0).toLocaleString()} ${Number(n) === 1 ? one : many}`;

export function relTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  if (!Number.isFinite(d)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "about 12 minutes", "under a minute", "about 2 h 10 min". */
export function durationWords(minutes) {
  const m = Math.ceil(Number(minutes) || 0);
  if (m <= 1) return "under a minute";
  if (m < 60) return `about ${m} minutes`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `about ${h} h${rest ? ` ${rest} min` : ""}`;
}

/**
 * One line that says who a campaign goes to. Takes either the summary shape
 * from the list (selectedCount) or the full shape from the editor (selected).
 * `sites` turns a single village's group id into its name; with more than one
 * the count reads better than a list of names.
 */
export function audienceSummary(audience, sites = []) {
  if (!audience) return "—";
  if (audience.mode === "selected") {
    const n = audience.selectedCount ?? audience.selected?.length ?? 0;
    return `${plural(n, "chosen customer")}`;
  }
  const parts = ["Everyone"];
  if (audience.purchasersOnly) parts.push("purchasers only");
  const ids = audience.groupIds || [];
  if (ids.length === 1) {
    const site = sites.find((s) => String(s.ruijieGroupId) === String(ids[0]));
    parts.push(site ? site.name : "1 village");
  } else if (ids.length > 1) {
    parts.push(`${ids.length} villages`);
  }
  return parts.join(" · ");
}

export const MERGE_TAGS = [
  { tag: "{{email}}", hint: "Their email address" },
  { tag: "{{phone}}", hint: "Their M-PAiSA number" },
  { tag: "{{village}}", hint: "Village they last bought in (blank if none)" },
];

/* ───────────────────────── Progress ───────────────────────── */

/**
 * Delivery bar. Sent, failed and skipped are drawn as consecutive segments of
 * one track, so the unfilled remainder is exactly what is still queued — the
 * bar answers "how much is left" without a legend.
 */
export function DeliveryBar({ totals, size = "sm", className }) {
  const total = Number(totals?.recipients || 0);
  const pct = (n) => (total > 0 ? (Number(n || 0) / total) * 100 : 0);
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-full bg-[var(--bg-surface-hover)]",
        size === "lg" ? "h-2.5" : "h-1",
        className
      )}
      role="img"
      aria-label={
        total > 0
          ? `${Number(totals.sent || 0).toLocaleString()} of ${total.toLocaleString()} sent`
          : "Nothing sent yet"
      }
    >
      <span className="h-full bg-[var(--success-fg)] transition-[width] duration-500" style={{ width: `${pct(totals?.sent)}%` }} />
      <span className="h-full bg-[var(--danger-fg)] transition-[width] duration-500" style={{ width: `${pct(totals?.failed)}%` }} />
      <span className="h-full bg-[var(--fg-subtle)] opacity-50 transition-[width] duration-500" style={{ width: `${pct(totals?.skipped)}%` }} />
    </div>
  );
}

/* ───────────────────────── Callout ───────────────────────── */

const CALLOUT = {
  info: { box: "border-[var(--info-border)] bg-[var(--info-soft)]", fg: "text-[var(--info-fg)]", Icon: Info },
  warning: { box: "border-[var(--warning-border)] bg-[var(--warning-soft)]", fg: "text-[var(--warning-fg)]", Icon: AlertTriangle },
  danger: { box: "border-[var(--danger-border)] bg-[var(--danger-soft)]", fg: "text-[var(--danger-fg)]", Icon: AlertTriangle },
  success: { box: "border-[var(--success-border)] bg-[var(--success-soft)]", fg: "text-[var(--success-fg)]", Icon: CheckCircle2 },
};

/** The console's inline notice: a tinted, bordered strip with an icon. */
export function Callout({ tone = "info", title, children, action, icon, className }) {
  const c = CALLOUT[tone] || CALLOUT.info;
  const Icon = c.Icon;
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : undefined}
      className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center", c.box, className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", c.fg)}>{icon || <Icon size={16} />}</span>
        <div className={cn("min-w-0 text-[12.5px] leading-relaxed", c.fg)}>
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 pl-7 sm:pl-0">{action}</div>}
    </div>
  );
}

/** Whether campaigns can go out at all, from /campaigns/stats. */
export function smtpProblem(smtp) {
  if (!smtp) return null;
  if (!smtp.configured) {
    return {
      title: "Email sending is not set up",
      detail: "No SMTP server is configured, so campaigns and test emails cannot be sent.",
      short: "Email sending is not set up in Settings",
      blocksTest: true,
    };
  }
  if (!smtp.enabled) {
    return {
      title: "Email campaigns are turned off",
      detail: "“Allow email campaigns” is off under Settings → Email, so campaigns cannot be sent. Test emails still work, and receipts are not affected.",
      short: "Campaigns are turned off in Settings → Email",
      blocksTest: false,
    };
  }
  return null;
}
