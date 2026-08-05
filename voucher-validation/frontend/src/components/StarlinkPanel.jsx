// src/components/StarlinkPanel.jsx
// One village's Starlink kit + its data-usage graph.
//
// Laid out after the Starlink portal's premium dashboard (pages/DashboardPremium.js
// + components/UsageChart.js): a big headline total, a pill-group cycle switcher,
// a stacked daily bar chart, and a usage breakdown beneath it. Rebuilt on recharts
// (this app's charting library) rather than pulling in chart.js, and re-skinned to
// the admin theme so it works in both light and dark.
//
// The palette is the source's: blue for included priority data, amber for top-up,
// grey for standard. Deliberately NOT Vodafone red — a whole chart of brand red
// reads as one solid block and drowns the rest of the dashboard.
//
// Self-fetching on purpose: it stays out of SiteDashboard's own load() and out of
// the page-level loading gate, so a slow or failing Starlink API can never delay
// or break the rest of the dashboard. Renders NOTHING when the village has no
// Starlink configured — most villages will be in that state.

import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Satellite, RefreshCw, Info } from "lucide-react";

import { networkApi } from "../services/api";
import { Panel, Badge, EmptyState, CHART_COLORS, ChartTooltip, useChartTheme } from "./ui";

const CYCLES = [
  { key: "A", label: "Current" },
  { key: "B", label: "Previous" },
  { key: "C", label: "2 cycles ago" },
];

const SERIES = [
  { key: "base", name: "Priority (included)", color: CHART_COLORS.blue },
  { key: "topup", name: "Priority (top-up)", color: CHART_COLORS.amber },
  { key: "standard", name: "Standard", color: CHART_COLORS.slate },
];

const gb = (v) => `${Number(v || 0).toFixed(2)} GB`;
const gb1 = (v) => `${Number(v || 0).toFixed(1)}`;

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const dateRange = (c) => {
  if (!c?.startDate) return "";
  const f = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${f(c.startDate)} to ${c.endDate ? f(c.endDate) : "now"}`;
};

/** One row of the breakdown under the chart. */
function UsageRow({ color, label, used, cap }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : null;
  return (
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[12.5px] text-[var(--fg-secondary)] flex-1 min-w-0 truncate">{label}</span>
      {pct != null && (
        <span className="hidden sm:block w-24 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden shrink-0">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </span>
      )}
      <span className="text-[12.5px] font-semibold text-[var(--fg-primary)] tabular-nums shrink-0">
        {gb(used)}
        {cap > 0 && <span className="font-normal text-[var(--fg-muted)]"> / {gb(cap)}</span>}
      </span>
    </div>
  );
}

function KitFact({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] font-semibold">{label}</p>
      <div className="text-[12.5px] text-[var(--fg-primary)] mt-0.5 truncate">{children}</div>
    </div>
  );
}

export default function StarlinkPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [cycle, setCycle] = useState("A");
  const [loading, setLoading] = useState(true);
  const ct = useChartTheme();

  const load = useCallback(async (c) => {
    setLoading(true);
    try {
      setData(await networkApi.starlink(projectId, { cycle: c }));
    } catch {
      // The backend already returns 200 for its own failures, so this only
      // catches transport-level problems. Never surfaced as a page error.
      setData({ configured: true, error: "Starlink data is temporarily unavailable", days: [] });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) load(cycle);
  }, [projectId, cycle, load]);

  if (!loading && !data?.configured) return null;
  if (loading && !data) return null;

  const kit = data?.kit || {};
  const days = data?.days || [];
  const t = data?.totals;
  const cycleCount = Math.max(1, data?.cycleCount || 1);

  // Round only the top of each stack. Recharts applies a Bar's radius to every
  // cell, so the cap goes on whichever series is topmost for that day.
  const topKeyFor = (d) => (d.standard > 0 ? "standard" : d.topup > 0 ? "topup" : "base");

  return (
    <Panel
      title="Starlink"
      subtitle={kit.nickname || kit.serviceLineNumber || "Data usage"}
      icon={<Satellite size={15} />}
      actions={
        <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)]">
          {CYCLES.slice(0, cycleCount).map((c) => (
            <button
              key={c.key}
              onClick={() => setCycle(c.key)}
              className={
                "px-3 py-1 rounded-full text-[11.5px] font-medium transition-colors whitespace-nowrap " +
                (cycle === c.key
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]")
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      }
    >
      {/* Headline: total consumed this cycle */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-semibold text-[var(--fg-primary)] tabular-nums">
              {t ? gb1(t.totalUsed) : "—"}
            </span>
            <span className="text-sm font-medium text-[var(--accent)]">GB used</span>
          </p>
          <p className="text-[11.5px] text-[var(--fg-muted)] mt-1">{dateRange(data?.cycle) || "This billing cycle"}</p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-end gap-4 sm:gap-6">
          <KitFact label="Service line">
            <span className="font-mono text-[11.5px]">{kit.serviceLineNumber || "—"}</span>
          </KitFact>
          <KitFact label="Device">
            <span className="font-mono text-[11.5px]">{kit.deviceId || "—"}</span>
          </KitFact>
          <KitFact label="Status">
            {kit.active == null
              ? "—"
              : <Badge tone={kit.active ? "success" : "neutral"}>{kit.active ? "Active" : "Inactive"}</Badge>}
          </KitFact>
        </div>
      </div>

      {days.length === 0 ? (
        <EmptyState
          icon={Satellite}
          title={data?.error ? "Starlink data unavailable" : "No usage recorded this cycle"}
          description={data?.error || "Usage appears once the kit reports data for this billing cycle."}
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={days} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
              <XAxis
                dataKey="d"
                tickLine={false}
                axisLine={false}
                tick={{ fill: ct.axis, fontSize: ct.tickFontSize }}
                minTickGap={14}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={46}
                tick={{ fill: ct.axis, fontSize: ct.tickFontSize }}
                label={{
                  value: "GB",
                  angle: -90,
                  position: "insideLeft",
                  offset: 16,
                  style: { fill: ct.axis, fontSize: 11 },
                }}
              />
              <Tooltip
                content={<ChartTooltip valueFormatter={gb} />}
                cursor={{ fill: ct.cursor }}
              />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} isAnimationActive={false}>
                  {days.map((d, i) => (
                    <Cell
                      key={i}
                      radius={topKeyFor(d) === s.key ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>

          {/* Breakdown, mirroring the premium dashboard's summary block */}
          {t && (
            <div className="mt-5 pt-4 border-t border-[var(--border-default)] space-y-2.5">
              <UsageRow color={CHART_COLORS.blue} label="Priority (included)" used={t.baseUsed} cap={t.baseCap} />
              <UsageRow color={CHART_COLORS.amber} label="Priority (top-up)" used={t.topUsed} cap={t.topCap} />
              <UsageRow color={CHART_COLORS.slate} label="Standard" used={t.standardUsed} cap={0} />
              <div className="pt-2.5 mt-2.5 border-t border-[var(--border-default)] flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-[var(--fg-primary)]">Total used</span>
                <span className="text-[13px] font-semibold text-[var(--fg-primary)] tabular-nums">{gb(t.totalUsed)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-3 text-[11px] text-[var(--fg-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Info size={11} />
              Usage is tracked in UTC and is approximate.
            </span>
            {data?.fetchedAt && (
              <span className="inline-flex items-center gap-1.5">
                {data.stale && <RefreshCw size={10} />}
                {data.stale ? `cached, ${relTime(data.fetchedAt)}` : `updated ${relTime(data.fetchedAt)}`}
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
