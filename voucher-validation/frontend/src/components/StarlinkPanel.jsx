// src/components/StarlinkPanel.jsx
// One village's Starlink kit + its data-usage graph.
//
// Laid out after the Starlink portal's premium dashboard (pages/DashboardPremium.js
// + components/UsageChart.js): a big headline total, a pill-group cycle switcher,
// a stacked daily bar chart, and a usage breakdown beneath it. Rebuilt on recharts
// (this app's charting library) rather than pulling in chart.js, and re-skinned to
// the admin theme so it works in both light and dark.
//
// This chart was the model the rest of the app's charts were standardised on, so
// it now spends the shared furniture from chart.jsx — ChartStat for the headline,
// axisX/axisY/gridProps for the plot, LegendRows for the breakdown — rather than
// its own near-identical copies. The palette is the source's: blue for included
// priority data, amber for top-up, grey for standard. Deliberately NOT Vodafone
// red — a whole chart of brand red reads as one solid block and drowns the rest
// of the dashboard.
//
// Self-fetching on purpose: it stays out of its host page's own load() and out of
// the page-level loading gate, so a slow or failing Starlink API can never delay
// or break the rest of the dashboard. Renders NOTHING when the village has no
// Starlink configured — most villages will be in that state.

import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Satellite, RefreshCw, Info } from "lucide-react";

import { networkApi } from "../services/api";
import {
  Panel,
  Badge,
  EmptyState,
  Segmented,
  CHART_COLORS,
  ChartTooltip,
  ChartStat,
  LegendRow,
  LegendRows,
  useChartTheme,
  axisX,
  axisY,
  gridProps,
  BAR_MAX_SIZE,
  BAR_CATEGORY_GAP,
} from "./ui";

const CYCLES = [
  { value: "A", label: "Current" },
  { value: "B", label: "Previous" },
  { value: "C", label: "2 cycles ago" },
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

// Starlink's cycle endDate is EXCLUSIVE — "Aug 1 to Sep 1" means August — so
// the label steps back a day to show the last date the cycle actually covers.
const dateRange = (c) => {
  if (!c?.startDate) return "";
  const f = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (!c.endDate) return `${f(c.startDate)} to now`;
  const lastDay = new Date(c.endDate);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return `${f(c.startDate)} to ${f(lastDay)}`;
};

/** A kit identifier, stated beside the headline rather than in a panel of its own. */
function KitFact({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-label">{label}</p>
      <div className="text-[12.5px] text-[var(--fg-primary)] mt-1 truncate">{children}</div>
    </div>
  );
}

/**
 * `compact` is for the half-width slot beside the link-quality charts: the kit
 * identifiers drop out of the header and the plot loses a third of its height,
 * because at ~540px the three reference facts wrap into a block taller than
 * the figure they sit beside. Nothing is lost — the service line and device id
 * are reference detail, available under Network, and not what anyone opens this
 * panel to read.
 */
export default function StarlinkPanel({ projectId, compact = false }) {
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

  // The source sets chart.js `borderRadius: 4` on EVERY dataset, which rounds
  // all four corners of each stacked segment — the pill look. Recharts needs the
  // radius on the Bar itself to do the same, and the shared BAR_RADIUS is square
  // at the foot (right for a single series, wrong for a stack).
  const STACK_RADIUS = [4, 4, 4, 4];

  return (
    <Panel
      title="Starlink"
      subtitle={kit.nickname || kit.serviceLineNumber || "Data usage"}
      icon={<Satellite size={15} />}
      tone="teal"
      actions={
        <Segmented
          size="sm"
          value={cycle}
          onChange={setCycle}
          options={CYCLES.slice(0, cycleCount)}
        />
      }
    >
      {/* Headline: total consumed this cycle, with the kit's identifiers beside
          it — they are reference detail, not figures, so they stay small. */}
      <ChartStat
        value={t ? gb1(t.totalUsed) : "—"}
        unit="GB used"
        caption={dateRange(data?.cycle) || "This billing cycle"}
        right={compact ? null : (
          <div className="grid grid-cols-2 sm:flex sm:items-end gap-4 sm:gap-7">
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
        )}
      />

      {days.length === 0 ? (
        <EmptyState
          icon={Satellite}
          title={data?.error ? "Starlink data unavailable" : "No usage to show"}
          description={
            data?.error ||
            data?.reason ||
            "Usage appears once the kit reports data for this billing cycle."
          }
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={compact ? 200 : 300}>
            <BarChart data={days} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
              <CartesianGrid {...gridProps(ct)} />
              <XAxis dataKey="d" {...axisX(ct)} />
              <YAxis {...axisY(ct, { unit: "GB" })} />
              <Tooltip content={<ChartTooltip valueFormatter={gb} />} cursor={{ fill: ct.cursor }} />
              {SERIES.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stackId="a"
                  fill={s.color}
                  radius={STACK_RADIUS}
                  maxBarSize={BAR_MAX_SIZE}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          {/* Breakdown, mirroring the premium dashboard's summary block. The
              share meters read against each allowance's cap, so `amount` is the
              raw number and `value` keeps the "used / cap" wording. */}
          {t && (
            <LegendRows>
              <LegendRow
                color={CHART_COLORS.blue}
                label="Priority (included)"
                amount={t.baseUsed}
                total={t.baseCap}
                value={<Used used={t.baseUsed} cap={t.baseCap} />}
              />
              <LegendRow
                color={CHART_COLORS.amber}
                label="Priority (top-up)"
                amount={t.topUsed}
                total={t.topCap}
                value={<Used used={t.topUsed} cap={t.topCap} />}
              />
              <LegendRow
                color={CHART_COLORS.slate}
                label="Standard"
                amount={t.standardUsed}
                total={0}
                value={<Used used={t.standardUsed} cap={0} />}
              />
              <div className="pt-3 mt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
                <span className="font-display text-[12.5px] font-semibold text-[var(--fg-primary)]">Total used</span>
                <span className="text-[13.5px] font-semibold text-[var(--fg-primary)] tabular-nums">{gb(t.totalUsed)}</span>
              </div>
            </LegendRows>
          )}

          <div className="flex items-center justify-between gap-3 mt-4 text-[11.5px] text-[var(--fg-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Info size={12} />
              Usage is tracked in UTC and is approximate.
            </span>
            {data?.fetchedAt && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {data.stale && <RefreshCw size={11} />}
                {data.stale ? `cached, ${relTime(data.fetchedAt)}` : `updated ${relTime(data.fetchedAt)}`}
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

/** "12.34 GB / 40.00 GB" — the cap stays subordinate to the figure that moved. */
function Used({ used, cap }) {
  return (
    <>
      {gb(used)}
      {cap > 0 && <span className="font-normal text-[var(--fg-muted)]"> / {gb(cap)}</span>}
    </>
  );
}
