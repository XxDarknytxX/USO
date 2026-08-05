// src/hooks/useMonthlyBreakdown.jsx
// One month of sales data, shared by everything on a dashboard that should
// re-scope when the month changes: the KPI cards AND the charts below them.
//
// The state lives here rather than inside the chart section so a page has ONE
// month picker driving everything, instead of a control that only governs the
// panel it happens to sit in.

import { useCallback, useEffect, useState } from "react";
import { portalConfigApi } from "../services/api";

export function monthLabel(m) {
  if (!m) return "";
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** True when `m` is the calendar month we are currently in. */
export function isCurrentMonth(m) {
  const now = new Date();
  return m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function useMonthlyBreakdown(groupId = null) {
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m) => {
    setLoading(true);
    try {
      const params = {};
      if (m) params.month = m;
      if (groupId) params.groupId = groupId;
      const res = await portalConfigApi.breakdown(params);
      setData(res);
      setMonth(res.month || "");
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Re-fetch when the village scope changes; the month resets to the newest
  // one that village actually has sales in.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [groupId]);

  const months = data?.months || [];
  const idx = months.findIndex((m) => m.month === month);

  return {
    month,
    months,
    data,
    loading,
    totals: data?.totals || {},
    isCurrent: isCurrentMonth(month),
    label: monthLabel(month),
    select: (m) => { setMonth(m); load(m); },
    // step(+1) goes back in time: `months` is newest-first.
    step: (delta) => {
      const next = months[idx + delta];
      if (next) { setMonth(next.month); load(next.month); }
    },
    canGoBack: idx >= 0 && idx < months.length - 1,
    canGoForward: idx > 0,
    reload: () => load(month),
  };
}
