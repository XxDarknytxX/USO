// src/hooks/useMonthlyBreakdown.jsx
// One window of sales data, shared by everything on a dashboard that should
// re-scope when the window changes: the KPI cards AND the charts below them.
//
// The state lives here rather than inside the chart section so a page has ONE
// picker driving everything, instead of a control that only governs the panel
// it happens to sit in.
//
// A selection is either a moving preset ("all" | "month" | "week") or a fixed
// calendar month ("YYYY-MM"). The backend takes them as `range` and `month`
// respectively and reports the window it actually used.

import { useCallback, useEffect, useRef, useState } from "react";
import { portalConfigApi } from "../services/api";

/** The moving windows, offered above the concrete months in the picker. */
export const RANGE_PRESETS = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "week", label: "This week" },
];
const PRESETS = new Set(RANGE_PRESETS.map((r) => r.value));

export function monthLabel(m) {
  if (!m) return "";
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** Human label for either kind of selection. */
export function rangeLabel(sel) {
  const preset = RANGE_PRESETS.find((r) => r.value === sel);
  return preset ? preset.label : monthLabel(sel);
}

/** True when `m` is the calendar month we are currently in. */
export function isCurrentMonth(m) {
  const now = new Date();
  return m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param groupId  a single village (the scope switcher pinned to one), or null
 * @param groupIds the "All Villages" set from Settings, or null for every
 *   village. An EMPTY ARRAY is meaningful: no village is in scope, so the page
 *   must read zeroes rather than silently falling back to everything.
 */
export function useMonthlyBreakdown(groupId = null, groupIds = null) {
  const [selection, setSelection] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Join the scope to a primitive so it can be a stable effect dependency; a
  // fresh array identity every render would otherwise refetch forever.
  const scopeKey = Array.isArray(groupIds) ? groupIds.join(",") : null;
  // The current selection, readable from the scope effect without making that
  // effect depend on it (which would refetch on every window change).
  const selRef = useRef("");

  const load = useCallback(
    async (sel) => {
      setLoading(true);
      try {
        const params = {};
        if (sel) {
          if (PRESETS.has(sel)) params.range = sel;
          else params.month = sel;
        }
        if (groupId) params.groupId = groupId;
        // Sent even when empty — see the groupIds note above.
        if (scopeKey !== null) params.groupIds = scopeKey;
        const res = await portalConfigApi.breakdown(params);
        setData(res);
        selRef.current = res.selection || res.month || "";
        setSelection(selRef.current);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [groupId, scopeKey]
  );

  // Re-fetch when the village scope changes, KEEPING the chosen window — only
  // a first load (no selection yet) lets the server pick the newest month.
  useEffect(() => {
    load(selRef.current || undefined);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [groupId, scopeKey]);

  const months = data?.months || [];
  const isPreset = PRESETS.has(selection);
  // Stepping only means something between concrete months.
  const idx = isPreset ? -1 : months.findIndex((m) => m.month === selection);

  return {
    month: selection, // legacy name kept for existing callers
    selection,
    isPreset,
    months,
    data,
    loading,
    totals: data?.totals || {},
    dailyUnit: data?.dailyUnit || "day",
    fromDate: data?.fromDate || null,
    toDate: data?.toDate || null,
    isCurrent: selection === "month" || isCurrentMonth(selection),
    label: rangeLabel(selection),
    select: (m) => { setSelection(m); selRef.current = m; load(m); },
    // step(+1) goes back in time: `months` is newest-first.
    step: (delta) => {
      const next = months[idx + delta];
      if (next) { setSelection(next.month); selRef.current = next.month; load(next.month); }
    },
    canGoBack: !isPreset && idx >= 0 && idx < months.length - 1,
    canGoForward: !isPreset && idx > 0,
    reload: () => load(selection),
  };
}
