// src/components/MonthPicker.jsx
// The single month control for a dashboard. Sits in the page header because it
// governs the whole page, not one panel.
//
// Only offers months that actually have sales, so it can never land on a month
// that renders empty and looks broken.

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button, Select } from "./ui";
import { monthLabel } from "../hooks/useMonthlyBreakdown";

const num = (n) => Number(n || 0).toLocaleString();

export default function MonthPicker({ state, compact = false }) {
  const { month, months, loading, select, step, canGoBack, canGoForward, reload } = state;

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => step(1)} disabled={!canGoBack} aria-label="Earlier month">
        <ChevronLeft size={15} />
      </Button>
      <Select
        value={month}
        onChange={(e) => select(e.target.value)}
        className={compact ? "min-w-[150px]" : "min-w-[195px]"}
        aria-label="Month"
      >
        {months.length === 0 && <option value="">No sales yet</option>}
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {monthLabel(m.month)}{compact ? "" : ` · ${num(m.txns)} sales`}
          </option>
        ))}
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
