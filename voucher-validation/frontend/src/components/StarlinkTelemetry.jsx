// src/components/StarlinkTelemetry.jsx
// How a village's Starlink link has actually been behaving.
//
// Six measures, the same six the Starlink Portal's premium dashboard shows,
// because they are the ones that explain a complaint: throughput answers "is it
// slow", latency and packet loss answer "is it unusable even though it is up",
// and signal quality and obstruction answer "why" — usually a tree that has
// grown into the dish's view.
//
// It sits beside the data-usage panel deliberately. Usage says how much the
// village consumed; this says what the connection was like while they consumed
// it, and an operator holding a complaint needs both at once.
//
// Reads stored rows only. The poller owns every Starlink call, so leaving this
// open costs nothing upstream.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownToLine, ArrowUpFromLine, Timer, TriangleAlert, SignalHigh, EyeOff } from "lucide-react";
import { api } from "../services/api";
import {
  Panel, Segmented, EmptyState, SkeletonCard,
  ChartTooltip, ChartGradient, useChartTheme, axisX, axisY, gridProps,
} from "./ui";
import { usePhone } from "./ui/phone";

const RANGES = [
  { value: "A", label: "15m" },
  { value: "B", label: "3h" },
  { value: "C", label: "24h" },
];

// One definition per measure: what to call it, how to colour it, how to read a
// number of that kind, and — the part that matters — which direction is bad.
// Latency and loss are the two where higher is worse, and a chart that does not
// know that cannot tell you anything useful about them.
const SERIES = [
  { key: "downlink",    label: "Download",      unit: "Mbps", Icon: ArrowDownToLine, color: "var(--tile-blue)",   decimals: 1 },
  { key: "uplink",      label: "Upload",        unit: "Mbps", Icon: ArrowUpFromLine, color: "var(--tile-green)",  decimals: 1 },
  { key: "latency",     label: "Latency",       unit: "ms",   Icon: Timer,           color: "var(--tile-orange)", decimals: 0, worseHigh: true, warn: 90, bad: 150 },
  { key: "drop",        label: "Packet loss",   unit: "%",    Icon: TriangleAlert,   color: "var(--tile-red)",    decimals: 1, worseHigh: true, warn: 3, bad: 10 },
  { key: "signal",      label: "Signal quality",unit: "%",    Icon: SignalHigh,      color: "var(--tile-violet)", decimals: 0 },
  { key: "obstruction", label: "Obstruction",   unit: "%",    Icon: EyeOff,          color: "var(--tile-pink)",   decimals: 1, worseHigh: true, warn: 1, bad: 3 },
];

const fmt = (v, d) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(d));

const clockLabel = (iso, range) => {
  const d = new Date(iso);
  // A 24-hour window needs the hour; fifteen minutes needs the seconds, or
  // every tick reads the same.
  return range === "C"
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: range === "A" ? "2-digit" : undefined });
};

export default function StarlinkTelemetry({ projectId, className, compact = false }) {
  const [range, setRange] = useState("B");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const phone = usePhone();

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setData(await api(`/network/projects/${projectId}/telemetry?range=${range}`, { auth: true }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, range]);

  useEffect(() => {
    load();
    // The poller writes every ~15s; refreshing on the same order keeps the
    // short window genuinely live without making the page a load of its own.
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const points = useMemo(
    () => (data?.points || []).map((p) => ({ ...p, label: clockLabel(p.t, range) })),
    [data, range]
  );

  // Beside the title on a phone the three windows are squeezed against the
  // right edge; under the header they take a row and split it evenly. It sits
  // above the empty state too — "try a longer window" is the advice there, so
  // the control that does it has to be in reach.
  const control = (
    <Segmented
      options={RANGES}
      value={range}
      onChange={setRange}
      size="sm"
      className={phone ? "w-full [&>button]:flex-1 [&>button]:justify-center" : undefined}
    />
  );

  if (loading && !data) return <SkeletonCard height="h-[420px]" className={className} />;

  if (data && !data.configured) {
    return (
      <Panel title="Link quality" subtitle="Starlink telemetry" tone="violet" className={className}>
        <EmptyState
          className="max-sm:py-8"
          icon={SignalHigh}
          title="No Starlink kit linked"
          description={data.reason || "Add this village's kit id under Network to see its link quality."}
        />
      </Panel>
    );
  }

  const empty = points.length === 0;

  return (
    <Panel
      title="Link quality"
      subtitle={
        empty
          ? "Starlink telemetry"
          : `Starlink telemetry · last ${data?.range} · averaged every ${
              data?.bucketSeconds >= 60 ? `${Math.round(data.bucketSeconds / 60)} min` : `${data?.bucketSeconds}s`
            }`
      }
      icon={<SignalHigh size={15} />}
      tone="violet"
      actions={phone ? null : control}
      className={className}
    >
      {phone && <div className="mb-3.5">{control}</div>}
      {empty ? (
        <EmptyState
          className="max-sm:py-8"
          icon={SignalHigh}
          title="Nothing reported in this window"
          description={
            data?.telemetryEnabled === false
              ? "Telemetry collection is switched off — the superadmin can enable it in Settings."
              : "The dish has not reported in this period. Try a longer window, or check whether it is online."
          }
        />
      ) : (
        // Two across either way, as the Starlink console has it — six single
        // -file cards would make this column twice the height of the usage
        // panel beside it. In the half-width slot the gutters and plots tighten
        // instead of the layout changing shape.
        //
        // A phone keeps two across as well, as reading tiles: the figure, its
        // range and a sparkline. Six full charts stacked one under another ran
        // over a thousand pixels, and the axes they would need do not fit in
        // half a phone's width — the window is in the subtitle, the range in
        // min/avg/max, and a tap on the line still gives the exact reading.
        <div className={`grid grid-cols-1 ${compact ? "sm:grid-cols-2 gap-3" : "lg:grid-cols-2 gap-5"} max-sm:grid-cols-2 max-sm:gap-2.5`}>
          {SERIES.map((s) => (
            <MetricChart key={s.key} spec={s} points={points} stats={data?.stats?.[s.key]} compact={compact} spark={phone} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * The sparkline's own tooltip.
 *
 * The shared ChartTooltip is 136px at its narrowest, and a phone tile two to a
 * row leaves the plot 128 — so it hung over the edge of the card it belongs to.
 * This says the same two things, when and how much, in the width there is; the
 * series is named by the tile's own heading, so it does not repeat it.
 */
function SparkTooltip({ active, payload, label, spec }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="max-w-[124px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 shadow-[var(--shadow-elevated)]">
      <p className="text-[10.5px] leading-tight text-[var(--fg-muted)]">{label}</p>
      <p className="text-[12px] font-semibold leading-tight tabular-nums text-[var(--fg-primary)]">
        {fmt(payload[0].value, spec.decimals)} <span className="font-medium text-[var(--fg-muted)]">{spec.unit}</span>
      </p>
    </div>
  );
}

/** One measure: its headline reading, its range, and its shape over time. */
function MetricChart({ spec, points, stats, compact = false, spark = false }) {
  const ct = useChartTheme();
  const gradId = `tel-${spec.key}`;

  // The current value is coloured by how bad it is, but ONLY for the measures
  // where "bad" is meaningful. Colouring download speed red at 8 Mbps would be
  // a judgement this component has no basis for — a village on a small plan is
  // not faulty.
  const tone =
    spec.worseHigh && stats?.last != null
      ? stats.last >= spec.bad
        ? "var(--danger-fg)"
        : stats.last >= spec.warn
          ? "var(--warning-fg)"
          : "var(--fg-primary)"
      : "var(--fg-primary)";

  return (
    <div className={`min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] ${compact ? "p-3" : "p-4"} max-sm:p-3 max-sm:flex max-sm:flex-col`}>
      <div className="flex items-start justify-between gap-3 max-sm:flex-col max-sm:gap-1.5">
        <span className="flex items-center gap-2 min-w-0">
          <spec.Icon size={14} style={{ color: spec.color }} className="shrink-0" />
          <span className="text-[12.5px] font-semibold font-display text-[var(--fg-primary)] truncate">
            {spec.label}
          </span>
        </span>
        <span className="text-[17px] leading-none font-semibold tabular-nums shrink-0 max-sm:text-[19px]" style={{ color: tone }}>
          {fmt(stats?.last, spec.decimals)}
          <span className="ml-1 text-[11px] font-medium text-[var(--fg-muted)]">{spec.unit}</span>
        </span>
      </div>

      {/* min / avg / max, because a single current reading cannot tell you
          whether 40ms is normal for this site or the best it has managed all
          day. */}
      <div className="mt-1.5 flex items-center gap-3 max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-0 text-[11px] text-[var(--fg-muted)] tabular-nums">
        <span>min {fmt(stats?.min, spec.decimals)}</span>
        <span>avg {fmt(stats?.avg, spec.decimals)}</span>
        <span>max {fmt(stats?.max, spec.decimals)}</span>
      </div>

      {/* mt-auto on a phone: tiles side by side share a height, and a range
          that wraps in one must not leave its sparkline sitting higher. */}
      <div className={`${compact ? "mt-2.5 h-[92px]" : "mt-3 h-[120px]"} max-sm:h-[52px] max-sm:mt-auto max-sm:pt-2.5`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={spark ? { top: 4, right: 2, bottom: 2, left: 2 } : { top: 4, right: 4, bottom: 0, left: -18 }}
          >
            <defs>
              <ChartGradient id={gradId} color={spec.color} />
            </defs>
            {!spark && <CartesianGrid {...gridProps(ct)} vertical={false} />}
            <XAxis dataKey="label" {...axisX(ct)} minTickGap={compact ? 64 : 40} hide={spark} />
            <YAxis
              {...axisY(ct)}
              hide={spark}
              width={44}
              // Percentages are pinned to 0–100 so a village at 0.2%
              // obstruction does not get a chart that makes it look alarming by
              // filling the panel.
              domain={spec.unit === "%" ? [0, 100] : ["auto", "auto"]}
              tickFormatter={(v) => fmt(v, 0)}
            />
            {/* valueFormatter, not recharts' own `formatter`: this is the
                app's tooltip and that is the prop it reads. A sparkline's plot
                is narrower than that tooltip can go, so it gets its own. */}
            <Tooltip
              content={
                spark ? (
                  <SparkTooltip spec={spec} />
                ) : (
                  <ChartTooltip valueFormatter={(v) => `${fmt(v, spec.decimals)} ${spec.unit}`} />
                )
              }
            />
            <Area
              type="monotone"
              name={spec.label}
              dataKey={spec.key}
              stroke={spec.color}
              strokeWidth={1.75}
              fill={`url(#${gradId})`}
              // Gaps are real: a dish that stopped reporting should leave a
              // hole, not a straight line pretending it kept going.
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
