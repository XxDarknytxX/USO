// src/components/MonthPicker.jsx
// The single window control for a dashboard. Sits in the page header because it
// governs the whole page, not one panel.
//
// Offers the moving ranges (all time / this month / this week) alongside the
// concrete months. Only months that actually have sales are listed, so picking
// one can never land on a window that renders empty and looks broken.
//
// The arrows step between concrete months; on a moving range there is nothing
// to step to, so they disable.

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button, Select } from "./ui";
import { monthLabel, RANGE_PRESETS } from "../hooks/useMonthlyBreakdown";

const num = (n) => Number(n || 0).toLocaleString();

export default function MonthPicker({ state, compact = false }) {
  const { month, months, loading, select, step, canGoBack, canGoForward, reload } = state;

  return (
    // A full row of its own on a phone, the window select taking the slack, so
    // it lines up with the header's other controls instead of floating.
    <div className="flex items-center gap-1.5 max-sm:w-full">
      <Button variant="ghost" size="sm" onClick={() => step(1)} disabled={!canGoBack} aria-label="Earlier month">
        <ChevronLeft size={15} />
      </Button>
      <div className="max-sm:flex-1 max-sm:min-w-0">
      <Select
        value={month}
        onChange={(e) => select(e.target.value)}
        className={compact ? "min-w-[168px] max-sm:min-w-0" : "min-w-[205px] max-sm:min-w-0"}
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
      </div>
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
