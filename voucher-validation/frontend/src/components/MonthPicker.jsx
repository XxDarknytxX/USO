// src/components/MonthPicker.jsx
// The single window control for a dashboard. Sits in the page header because it
// governs the whole page, not one panel.
//
// Offers the moving ranges (all time / this month / this week) alongside the
// concrete months. Only months that actually have sales are listed, so picking
// one can never land on a window that renders empty and looks broken.
//
// Two controls, one window:
//   • Pointer (this file's default export): arrows to step between months and a
//     select for the whole list, in the page header beside the page's actions.
//   • Phone (MonthPickerChips): a scrolling row of chips on a row of its own
//     under the header. A select on a phone is two taps and a system sheet that
//     hides the page; a chip is one tap, and the row doubles as the answer to
//     "which window am I on" without reading a label. It sits in the page body
//     rather than in the header because the header's action row is sized by its
//     contents — a strip that scrolls needs a parent with a width of its own.

import { useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button, Select } from "./ui";
import { monthLabel, RANGE_PRESETS } from "../hooks/useMonthlyBreakdown";

const num = (n) => Number(n || 0).toLocaleString();

/** "Sep 2026" — a chip has room for the month, not for "September 2026". */
function chipLabel(m) {
  const [y, mo] = String(m).split("-").map(Number);
  if (!y || !mo) return String(m);
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}

function Chip({ active, children, onClick, title, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-active={active || undefined}
      aria-pressed={active}
      aria-busy={active && loading ? true : undefined}
      className={
        "h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors " +
        // The tap that reloads has to look like it did something; the panels
        // below only change once the payload lands.
        (active && loading ? "animate-pulse " : "") +
        (active
          ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
          : "border border-[var(--border-default)] text-[var(--fg-secondary)] active:bg-[var(--bg-surface)]")
      }
    >
      {children}
    </button>
  );
}

/**
 * The phone's window control: one row of chips, on the page rather than in the
 * header. Renders nothing above 640px, where the select in the header is the
 * control.
 */
export function MonthPickerChips({ state, className = "" }) {
  const { month, months, loading, select, reload } = state;
  const stripRef = useRef(null);

  // The chosen window can sit past the right edge — the presets take the first
  // 200px, and a dashboard opens on the newest month with sales. Bring it into
  // view so the row always shows where you are.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector("[data-active]");
    if (!chip) return;
    const s = strip.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    if (c.left < s.left) strip.scrollLeft += c.left - s.left - 12;
    else if (c.right > s.right) strip.scrollLeft += c.right - s.right + 12;
  }, [month, months.length]);

  // Tapping the chip you are already on refetches that window. A refresh button
  // beside the strip would sit over the chips that scroll under it, and this is
  // the gesture a phone user reaches for anyway.
  const pick = (value) => (value === month ? reload() : select(value));

  return (
    <div ref={stripRef} className={`sm:hidden w-full min-w-0 overflow-x-auto scrollbar-none ${className}`}>
      <div className="flex w-max items-center gap-1.5 py-0.5 pr-1">
        {RANGE_PRESETS.map((r) => (
          <Chip
            key={r.value}
            active={month === r.value}
            loading={loading}
            onClick={() => pick(r.value)}
            title={month === r.value ? "Tap again to refresh" : r.label}
          >
            {r.label}
          </Chip>
        ))}
        {months.length > 0 && (
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-default)]" />
        )}
        {months.map((m) => (
          <Chip
            key={m.month}
            active={month === m.month}
            loading={loading}
            onClick={() => pick(m.month)}
            title={`${monthLabel(m.month)} · ${num(m.txns)} sales${month === m.month ? " · tap again to refresh" : ""}`}
          >
            {chipLabel(m.month)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export default function MonthPicker({ state, compact = false }) {
  const { month, months, loading, select, step, canGoBack, canGoForward, reload } = state;

  return (
    <div className="max-sm:hidden! flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => step(1)} disabled={!canGoBack} aria-label="Earlier month">
        <ChevronLeft size={15} />
      </Button>
      <Select
        value={month}
        onChange={(e) => select(e.target.value)}
        className={compact ? "min-w-[168px]" : "min-w-[205px]"}
        aria-label="Reporting window"
      >
        <optgroup label="Quick ranges">
          {RANGE_PRESETS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </optgroup>
        {months.length > 0 && (
          <optgroup label="Months">
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {monthLabel(m.month)}{compact ? "" : ` · ${num(m.txns)} sales`}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <Button variant="ghost" size="sm" onClick={() => step(-1)} disabled={!canGoForward} aria-label="Later month">
        <ChevronRight size={15} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={reload}
        disabled={loading}
        aria-label="Refresh"
        iconLeft={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
      />
    </div>
  );
}
