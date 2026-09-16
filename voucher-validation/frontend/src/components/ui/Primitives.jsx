/**
 * Layout + data primitives.
 *
 * These exist so that twelve pages, redesigned separately, still read as one
 * product. A page should reach for these rather than hand-rolling a table, a
 * filter row or a tab strip — every hand-rolled copy is a place the design
 * drifts. Modelled on Salesforce Lightning's page/list/table structure.
 */

import { useState } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { ObjectTile } from "./StatCard";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

/* ───────────────────────── Page ───────────────────────── */

/**
 * PageShell — every page's outer wrapper. One gutter, one max width, one gap
 * between sections, so pages cannot each invent their own padding.
 */
export function PageShell({ children, className, width = "wide" }) {
  const max = width === "narrow" ? "max-w-[1100px]" : width === "full" ? "max-w-none" : "max-w-[1560px]";
  return (
    <div className={cn("p-5 sm:p-6 lg:p-7", className)}>
      <div className={cn(max, "mx-auto flex flex-col gap-5")}>{children}</div>
    </div>
  );
}

/** A row of KPI tiles. Defaults to 4-up, collapsing sensibly. */
export function KpiGrid({ children, cols = 4, className }) {
  const map = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
    6: "sm:grid-cols-3 lg:grid-cols-6",
  };
  return <div className={cn("grid grid-cols-1 gap-4", map[cols] || map[4], className)}>{children}</div>;
}

/**
 * Toolbar — the filter/search strip above a list. A card, so it reads as part
 * of the list rather than as loose controls floating on the canvas.
 */
export function Toolbar({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--border-default)]",
        "bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Search box sized for the Toolbar. */
export function SearchInput({ value, onChange, placeholder = "Search…", className, width = "w-64" }) {
  return (
    <div className={cn("relative", width, className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={
          "h-9 w-full pl-9 pr-8 text-[13px] rounded-full bg-[var(--bg-surface)] " +
          "border border-[var(--border-default)] text-[var(--fg-primary)] " +
          "placeholder:text-[var(--fg-muted)] focus-input"
        }
      />
      {value && (
        <button
          onClick={() => onChange({ target: { value: "" } })}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
          aria-label="Clear search"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Segmented — the pill switcher. Five pages had hand-rolled copies of this,
 * each slightly different; they should all use this one.
 * options: [{ value, label, count? }]
 */
export function Segmented({ options = [], value, onChange, size = "md", className }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 p-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)]",
        className
      )}
      role="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-semibold transition-all duration-150 font-display",
              size === "sm" ? "h-7 px-3 text-[12px]" : "h-8 px-3.5 text-[12.5px]",
              active
                ? "bg-[var(--surface)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
            )}
          >
            {o.label}
            {o.count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10.5px] font-bold tabular-nums",
                  active ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]" : "bg-[var(--bg-surface-hover)] text-[var(--fg-muted)]"
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Status ───────────────────────── */

const PILL_TONES = {
  success: "bg-[var(--success-soft)] text-[var(--success-fg)] border-[var(--success-border)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning-fg)] border-[var(--warning-border)]",
  danger:  "bg-[var(--danger-soft)] text-[var(--danger-fg)] border-[var(--danger-border)]",
  info:    "bg-[var(--info-soft)] text-[var(--info-fg)] border-[var(--info-border)]",
  neutral: "bg-[var(--bg-surface)] text-[var(--fg-secondary)] border-[var(--border-default)]",
  brand:   "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border-transparent",
};

const PILL_DOTS = {
  success: "var(--success-fg)",
  warning: "var(--warning-fg)",
  danger:  "var(--danger-fg)",
  info:    "var(--info-fg)",
  neutral: "var(--fg-subtle)",
  brand:   "var(--brand)",
};

/** StatusPill — a state, said the same way everywhere. */
export function StatusPill({ tone = "neutral", children, dot = true, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap font-display",
        PILL_TONES[tone] || PILL_TONES.neutral,
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: PILL_DOTS[tone] }} />}
      {children}
    </span>
  );
}

/* ───────────────────────── Table ───────────────────────── */

/**
 * DataTable — Salesforce's calm, roomy list. Use with Th/Td; the card chrome,
 * header styling, row hover and dividers come from .sf-table so no page has to
 * restate them.
 */
/**
 * DataTable — the console's one table shell.
 *
 * `maxHeight` turns on contained scrolling: the list scrolls inside its own box
 * with the header pinned, instead of making the whole page long. Pass a number
 * of px or any CSS length. It is a MAX height on purpose — a search that
 * narrows thirty rows to three must shrink the box, not leave three rows
 * stranded in an empty well.
 *
 * Setting overflow-y also makes this div the nearest scrollport, which is what
 * the sticky header in `.sf-table--sticky` resolves against.
 */
export function DataTable({ children, className, maxHeight }) {
  return (
    <div
      className={cn("overflow-x-auto", maxHeight && "overflow-y-auto", className)}
      style={
        maxHeight
          ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }
          : undefined
      }
    >
      <table className={cn("sf-table", maxHeight && "sf-table--sticky")}>{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className }) {
  return <th className={cn(align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</th>;
}

export function Td({ children, align = "left", mono = false, strong = false, muted = false, nowrap = false, className }) {
  return (
    <td
      className={cn(
        "text-[13px]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        mono && "font-mono text-[12px]",
        strong ? "font-semibold text-[var(--fg-primary)]" : muted ? "text-[var(--fg-muted)]" : "text-[var(--fg-secondary)]",
        nowrap && "whitespace-nowrap",
        className
      )}
    >
      {children}
    </td>
  );
}

/** A full-width row for loading / empty states inside a DataTable. */
export function TableMessage({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-[13px] text-[var(--fg-muted)]">
        {children}
      </td>
    </tr>
  );
}

/**
 * A record cell: object tile + primary line + secondary line. The standard way
 * to render "the thing this row is about".
 */
export function RecordCell({ tone = "navy", icon, title, subtitle, mono = false, onClick }) {
  const inner = (
    <span className="flex items-center gap-3 min-w-0 text-left">
      {icon && <ObjectTile tone={tone} size="sm">{icon}</ObjectTile>}
      <span className="flex flex-col min-w-0">
        <span className="text-[13px] font-semibold text-[var(--fg-primary)] truncate">{title}</span>
        {subtitle && (
          <span className={cn("text-[11.5px] text-[var(--fg-muted)] truncate", mono && "font-mono")}>{subtitle}</span>
        )}
      </span>
    </span>
  );
  return onClick ? (
    <button onClick={onClick} className="min-w-0 max-w-full hover:[&_span]:text-[var(--brand)] transition-colors">
      {inner}
    </button>
  ) : (
    inner
  );
}

/* ───────────────────────── Disclosure ───────────────────────── */

/** A collapsible section, for detail that should not be on screen by default. */
export function Disclosure({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-surface)] transition-colors"
      >
        <span className="text-[13px] font-semibold text-[var(--fg-primary)] font-display">{summary}</span>
        <ChevronDown size={15} className={cn("text-[var(--fg-muted)] transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]">{children}</div>}
    </div>
  );
}
