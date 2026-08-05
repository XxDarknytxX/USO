/**
 * Chart kit — shared Recharts theming for a consistent Vodafone analytics feel.
 *
 * Exports:
 *  • CHART_COLORS / CHART_SERIES — categorical palette (reads well on both themes)
 *  • useChartTheme() — grid / axis / cursor colors that follow the active theme
 *  • ChartTooltip — styled tooltip matching the surface system
 *  • ChartGradient — <defs> linear gradient for area/bar fills
 */

import { useTheme } from "../../contexts/theme";

export const CHART_COLORS = {
  accent: "#E60000",
  red: "#E60000",
  blue: "#3B82F6",
  emerald: "#10B981",
  amber: "#F59E0B",
  violet: "#8B5CF6",
  rose: "#F43F5E",
  cyan: "#06B6D4",
  indigo: "#6366F1",
  orange: "#F97316",
  slate: "#94A3B8",
  pink: "#EC4899",
  teal: "#14B8A6",
};

// Ordered series palette — accent-first so single-series charts are on-brand.
export const CHART_SERIES = [
  CHART_COLORS.accent,
  CHART_COLORS.blue,
  CHART_COLORS.violet,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.cyan,
  CHART_COLORS.rose,
  CHART_COLORS.indigo,
  CHART_COLORS.orange,
  CHART_COLORS.teal,
];

export function useChartTheme() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  return {
    isLight,
    grid: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)",
    axis: isLight ? "#5F6368" : "#8A8F98",
    axisLine: isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.08)",
    cursor: isLight ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.04)",
    tickFontSize: 11,
  };
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
  hideLabel = false,
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 shadow-[var(--shadow-elevated)] min-w-[120px]">
      {!hideLabel && label != null && (
        <p className="text-[11px] font-medium text-[var(--fg-muted)] mb-1.5">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: entry.color || entry.fill || entry.stroke }}
            />
            <span className="text-[var(--fg-secondary)] capitalize">{entry.name}</span>
            <span className="ml-auto font-semibold text-[var(--fg-primary)] tabular-nums">
              {valueFormatter ? valueFormatter(entry.value, entry) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Convenience: linear-gradient <defs> for area/bar fills keyed by color. */
export function ChartGradient({ id, color, from = 0.35, to = 0 }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared chart furniture.
 *
 * Extracted from the Starlink usage panel, which reads as the most modern chart
 * in the app, so every other chart can inherit the same language instead of
 * each one inventing its own axes, radii and legends:
 *   • no axis lines, horizontal grid only, small muted ticks
 *   • bars rounded on all corners and capped in width, with generous gaps
 *   • the number stated large above the chart, not buried in the plot
 *   • the legend written as readable rows under the chart, not chart chrome
 * ──────────────────────────────────────────────────────────────────────────── */

/** Bars: rounded every corner (reads as a pill), never wider than this. */
export const BAR_RADIUS = [4, 4, 4, 4];
export const BAR_MAX_SIZE = 22;
export const BAR_CATEGORY_GAP = "22%";

/** Spread onto <XAxis>. Chartjunk off; the labels do the work. */
export function axisX(ct, extra = {}) {
  return {
    tickLine: false,
    axisLine: false,
    tick: { fill: ct.axis, fontSize: ct.tickFontSize },
    minTickGap: 14,
    ...extra,
  };
}

/** Spread onto <YAxis>. `unit` renders as a small rotated axis label. */
export function axisY(ct, { unit, width = 44, ...extra } = {}) {
  return {
    tickLine: false,
    axisLine: false,
    width,
    tick: { fill: ct.axis, fontSize: ct.tickFontSize },
    ...(unit
      ? {
          label: {
            value: unit,
            angle: -90,
            position: "insideLeft",
            offset: 16,
            style: { fill: ct.axis, fontSize: 11 },
          },
        }
      : {}),
    ...extra,
  };
}

/** Spread onto <CartesianGrid>: horizontal rules only. */
export function gridProps(ct) {
  return { strokeDasharray: "3 3", vertical: false, stroke: ct.grid };
}

/**
 * The headline figure for a chart panel: the number said plainly and large,
 * with its unit and an optional caption underneath.
 */
export function ChartStat({ value, unit, caption, right }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl sm:text-4xl font-semibold text-[var(--fg-primary)] tabular-nums">
            {value}
          </span>
          {unit && <span className="text-sm font-medium text-[var(--accent)]">{unit}</span>}
        </p>
        {caption && <p className="text-[11.5px] text-[var(--fg-muted)] mt-1">{caption}</p>}
      </div>
      {right}
    </div>
  );
}

/**
 * A legend row: colour dot, label, an optional share meter, and the value.
 * Replaces recharts' built-in legend, which is small, unlabelled and cramped.
 */
export function LegendRow({ color, label, value, total }) {
  const pct = total > 0 ? Math.min(100, (Number(value) / total) * 100) : null;
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
        {value}
      </span>
    </div>
  );
}

/** Wraps LegendRow set with the divider the panels use above them. */
export function LegendRows({ children }) {
  return (
    <div className="mt-5 pt-4 border-t border-[var(--border-default)] space-y-2.5">{children}</div>
  );
}
