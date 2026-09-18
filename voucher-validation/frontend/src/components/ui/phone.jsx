// src/components/ui/phone.jsx
//
// What a row, a list and a bar chart become on a phone.
//
// These live on their own — not beside the dashboard panels that first needed
// them — because half the console uses them and nothing else in that file
// applies: importing them from MonthlyBreakdown dragged recharts (115 kB
// gzipped) into pages that draw no charts at all.

import { useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";

import Button from "./Button";

const num = (n) => Number(n || 0).toLocaleString();

/* ───────────────────────── Phone helpers ─────────────────────────
 * Shared by both dashboards and the plan table, which all compose these panels.
 *
 * Below 640px DataTable stacks every row into a card of "LABEL  value" lines.
 * For the dashboards' wide tables that is eight or nine lines a row — a village
 * list thirty-one rows long becomes seventeen thousand pixels. PHONE_CARD turns
 * the card into a six-track grid instead: the row's subject and its headline
 * figure on the first line, the other figures as small label-over-value tiles
 * two or three across. Desktop is untouched — every class is max-sm.
 *
 * The `!` is needed because the stacked-table rules are deliberately unlayered
 * and would otherwise win over these utilities. */

const PHONE_STAT =
  "max-sm:flex-col! max-sm:justify-start! max-sm:gap-1! max-sm:text-left! " +
  "max-sm:[&>*]:ml-0! max-sm:before:max-w-none! max-sm:before:pt-0!";

export const PHONE_CARD = {
  /** On the <tr>. */
  row: "max-sm:grid! max-sm:grid-cols-6 max-sm:gap-x-3! max-sm:gap-y-3!",
  /** The first cell: the row's subject, beside the aside. */
  title: "max-sm:col-span-4 max-sm:self-center",
  /** A first cell with no aside beside it (a totals row). */
  titleFull: "max-sm:col-span-6",
  /** The headline figure or state, top-right, unlabelled. */
  aside:
    "max-sm:col-start-5 max-sm:col-span-2 max-sm:row-start-1 max-sm:self-center " +
    "max-sm:justify-end! max-sm:before:hidden!",
  /** A label-over-value tile, three to a line. */
  stat: "max-sm:col-span-2 " + PHONE_STAT,
  /** A label-over-value tile, two to a line (for wider values such as IPs). */
  statWide: "max-sm:col-span-3 " + PHONE_STAT,
  /** The tile styling alone, for a row that sets its own grid tracks. */
  cell: PHONE_STAT,
  /** A cell whose figure already appears elsewhere in the phone card. */
  hide: "max-sm:hidden!",
};

/** How many rows a long list shows on a phone before "Show all". */
export const PHONE_ROWS = 6;

/**
 * The row class for row `i` of a list capped at PHONE_ROWS on a phone. Only
 * phones are capped: desktop keeps its contained scroll box.
 */
export function phoneRowClass(i, expanded) {
  return !expanded && i >= PHONE_ROWS ? "max-sm:hidden!" : PHONE_CARD.row;
}

/**
 * The "Show all" control under a capped list. Phones only. The desktop tables
 * scroll inside a fixed box; on a phone that box is removed (a scroll area
 * inside a scrolling page traps the thumb), so without a cap a long list would
 * push everything below it several screens down.
 */
export function PhoneMore({ total, expanded, onToggle, noun = "rows" }) {
  if (total <= PHONE_ROWS) return null;
  return (
    <div className="sm:hidden px-4 py-3 border-t border-[var(--border-subtle)]">
      <Button variant="secondary" size="sm" className="w-full" onClick={onToggle}>
        {expanded ? `Show fewer ${noun}` : `Show all ${num(total)} ${noun}`}
      </Button>
    </div>
  );
}

/** A tappable card's cue on a phone, where there is no hover to reveal it. */
export function PhoneChevron({ className = "" }) {
  return (
    <ChevronRight
      size={15}
      aria-hidden="true"
      className={`sm:hidden shrink-0 text-[var(--fg-subtle)] ${className}`}
    />
  );
}

/* ── Phone list primitives ──────────────────────────────────────────────────
 * A stacked table card answers "what is in this row"; these answer "what am I
 * looking at" in one glance, which is the question someone holding a phone is
 * actually asking. A panel that uses them renders the list below 640px and
 * hides its table (max-sm:hidden!), so the desktop table is untouched.       */

/** The container for a phone list inside an unpadded Panel. */
export function PhoneList({ children, className = "" }) {
  return (
    <div className={`sm:hidden divide-y divide-[var(--border-subtle)] ${className}`}>{children}</div>
  );
}

/**
 * The small print under a phone row: "8 live · 2 active · 1.5 / 5.0 GB".
 * `items` is [{ v, l }] — the figure carries the weight, the noun explains it.
 * Anything falsy is dropped, so a village with no Starlink kit simply has one
 * fact fewer rather than a line reading "—".
 */
export function PhoneFacts({ items = [], className = "" }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] leading-[1.45] text-[var(--fg-muted)] ${className}`}
    >
      {shown.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
          {i > 0 && <span aria-hidden="true" className="text-[var(--fg-subtle)]">·</span>}
          <span className="font-semibold tabular-nums text-[var(--fg-secondary)]">{f.v}</span>
          {f.l && <span>{f.l}</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * A ranked row with a proportional bar — what a bar chart becomes on a phone.
 * A recharts category axis at 375px either clips the names or shrinks the bars
 * to hairlines; this keeps the name, prints the figure that the chart made you
 * estimate, and still shows the shape of the ranking.
 */
export function PhoneBarRow({
  label, value, amount, total, color = "var(--brand)", sub, onClick, title,
  // `inset` pays for its own side padding, for a list that runs edge to edge in
  // an unpadded Panel. Inside a padded one the panel already has the gutter.
  inset = true,
}) {
  const pct = total > 0 && Number.isFinite(amount) ? Math.min(100, Math.max(0, (amount / total) * 100)) : null;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={
        "w-full text-left block " +
        (inset ? "px-4 py-3 " : "py-2.5 ") +
        (onClick ? "active:bg-[var(--bg-surface)] transition-colors" : "")
      }
    >
      <span className="flex items-baseline gap-3">
        {/* Two lines rather than an ellipsis: a phone has no hover to reveal
            the rest of "Monthly Wi-Fi unlimited-night streaming bundle". */}
        <span className="flex-1 min-w-0 text-[13.5px] font-medium leading-snug text-[var(--fg-primary)] line-clamp-2">
          {label}
        </span>
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-[var(--fg-primary)]">
          {value}
        </span>
        {onClick && <PhoneChevron className="self-center" />}
      </span>
      {pct != null && (
        <span className="mt-2 block h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </span>
      )}
      {sub && <span className="mt-1.5 block">{sub}</span>}
    </Tag>
  );
}

const PHONE_QUERY = "(max-width: 639px)";
function subscribePhone(onChange) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/**
 * True below 640px. Only for what CSS cannot reach — a chart's axis layout is a
 * prop, not a style.
 */
export function usePhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/** A category name short enough for a phone chart's axis; the tooltip has it whole. */
export const shortLabel = (s, max = 14) => {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
