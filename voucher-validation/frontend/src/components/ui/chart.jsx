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
