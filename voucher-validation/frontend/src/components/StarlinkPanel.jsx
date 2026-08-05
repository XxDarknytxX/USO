// src/components/StarlinkPanel.jsx
// One village's Starlink kit + its data-usage graph.
//
// Self-fetching on purpose: it stays out of SiteDashboard's own load() and out
// of the page-level loading gate, so a slow or failing Starlink API can never
// delay or break the rest of the dashboard.
//
// Renders NOTHING when the village has no Starlink configured — no placeholder,
// no error, no empty card. Most villages will be in that state.

import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Satellite, RefreshCw } from "lucide-react";

import { networkApi } from "../services/api";
import { Panel, Badge, EmptyState, CHART_COLORS, ChartTooltip, useChartTheme } from "./ui";

const CYCLES = [
  { key: "A", label: "Current" },
  { key: "B", label: "Previous" },
  { key: "C", label: "2 cycles ago" },
];

const gb = (v) => `${Number(v || 0).toFixed(2)} GB`;

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] font-semibold">{label}</p>
      <p className="text-sm font-semibold text-[var(--fg-primary)] mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-[var(--fg-muted)]">{sub}</p>}
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
      // A Starlink failure is never allowed to surface as a page error; the
      // backend already returns 200 for its own failures, so this only catches
      // transport-level problems.
      setData({ configured: true, error: "Starlink data is temporarily unavailable", days: [] });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) load(cycle);
  }, [projectId, cycle, load]);

  // Not configured for this village → the card does not exist.
  if (!loading && !data?.configured) return null;
  if (loading && !data) return null;

  const kit = data?.kit || {};
  const days = data?.days || [];
  const totals = data?.totals;

  return (
    <Panel
      title="Starlink"
      subtitle={kit.nickname || kit.serviceLineNumber || "Data usage"}
      icon={<Satellite size={15} />}
      actions={
        <div className="flex items-center gap-1">
          {CYCLES.slice(0, Math.max(1, data?.cycleCount || 1)).map((c) => (
            <button
              key={c.key}
              onClick={() => setCycle(c.key)}
              className={
                "px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors " +
                (cycle === c.key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)]")
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      }
    >
      {/* Kit info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 mb-4 border-b border-[var(--border-default)]">
        <Stat
          label="Service line"
          value={<span className="font-mono text-[12.5px]">{kit.serviceLineNumber || "—"}</span>}
        />
        <Stat
          label="Device ID"
          value={<span className="font-mono text-[12.5px] break-all">{kit.deviceId || "—"}</span>}
        />
        <Stat
          label="Status"
          value={
            kit.active == null
              ? "—"
              : <Badge tone={kit.active ? "success" : "neutral"}>{kit.active ? "Active" : "Inactive"}</Badge>
          }
          sub={kit.productReferenceId || undefined}
        />
        <Stat
          label="Used this cycle"
          value={totals ? gb(totals.totalUsed) : "—"}
          sub={totals?.baseCap ? `of ${gb(totals.baseCap)} included` : undefined}
        />
      </div>

      {days.length === 0 ? (
        <EmptyState
          icon={Satellite}
          title={data?.error ? "Starlink data unavailable" : "No usage recorded this cycle"}
          description={data?.error || "Usage appears once the kit reports data for this billing cycle."}
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={days} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
              <XAxis
                dataKey="d"
                tickLine={false}
                axisLine={false}
                tick={{ fill: ct.axis, fontSize: ct.tickFontSize }}
                minTickGap={18}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fill: ct.axis, fontSize: ct.tickFontSize }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                content={<ChartTooltip valueFormatter={gb} />}
                cursor={{ fill: ct.cursor }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: ct.axis }}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="base" name="Included" stackId="a" fill={CHART_COLORS.accent} isAnimationActive={false} />
              <Bar dataKey="topup" name="Top-up" stackId="a" fill={CHART_COLORS.amber} isAnimationActive={false} />
              <Bar dataKey="standard" name="Standard" stackId="a" fill={CHART_COLORS.slate} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>

          <div className="flex items-center justify-between mt-3 text-[11px] text-[var(--fg-muted)]">
            <span>
              {data?.cycle?.startDate
                ? `${data.cycle.startDate.slice(0, 10)} to ${data.cycle.endDate?.slice(0, 10) || "now"}`
                : ""}
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
