/**
 * Chart kit — shared Recharts theming.
 *
 * The previous palette led with Vodafone red for every first series, so a page
 * of charts read as a page of alarms and two adjacent series were often red and
 * near-red. This follows Salesforce's analytics instead: a calm multi-hue
 * categorical palette, hues far enough apart to be told apart at a glance, with
 * brand red available deliberately (CHART_COLORS.brand) for the one series that
 * should be on-brand — usually revenue.
 *
 * Also here: the shared furniture (axes, grid, bar geometry, legend rows, donut)
 * so every chart in the app reads as one system rather than each inventing its
 * own.
 */

import { useTheme } from "../../contexts/theme";

/* Categorical palette. Ordered so the first four are maximally distinct — most
   charts here never show more than four series. */
export const CHART_COLORS = {
  blue:    "#1B96FF",
  teal:    "#06A59A",
  violet:  "#9050E9",
  orange:  "#FE9339",
  green:   "#3BA755",
  pink:    "#EA7092",
  indigo:  "#5867E8",
  navy:    "#0B5CAB",
  amber:   "#E4A201",
  cyan:    "#2FC5D6",
  slate:   "#8B95A7",
  // Brand: reach for this only when the series IS the brand (revenue, sales).
  brand:   "#E60000",
  accent:  "#E60000",
  red:     "#E60000",
  // Semantic, for status series only.
  success: "#2E844A",
  warning: "#FE9339",
  danger:  "#BA0517",
  emerald: "#3BA755",
  rose:    "#EA7092",
};

export const CHART_SERIES = [
  CHART_COLORS.blue,
  CHART_COLORS.teal,
  CHART_COLORS.violet,
  CHART_COLORS.orange,
  CHART_COLORS.green,
  CHART_COLORS.pink,
  CHART_COLORS.indigo,
  CHART_COLORS.navy,
  CHART_COLORS.amber,
  CHART_COLORS.cyan,
];

/** Status → colour, so "faulty" is the same hue in every chart and badge. */
export const STATUS_COLORS = {
  ok: CHART_COLORS.success,
  success: CHART_COLORS.success,
  active: CHART_COLORS.success,
  online: CHART_COLORS.success,
  attention: CHART_COLORS.warning,
  warning: CHART_COLORS.warning,
  pending: CHART_COLORS.warning,
  faulty: CHART_COLORS.danger,
  failed: CHART_COLORS.danger,
  offline: CHART_COLORS.danger,
  unused: CHART_COLORS.blue,
  expired: CHART_COLORS.slate,
  unknown: CHART_COLORS.slate,
};

export function useChartTheme() {
  const { theme } = useTheme();
  const isLight = theme !== "dark";
  return {
    isLight,
    grid: isLight ? "#E8ECF3" : "rgba(255,255,255,0.08)",
    axis: isLight ? "#6E7788" : "#8B95A7",
    axisLine: isLight ? "#E1E6EF" : "rgba(255,255,255,0.10)",
    cursor: isLight ? "rgba(16,28,56,0.04)" : "rgba(255,255,255,0.05)",
    tickFontSize: 11,
    /** Ring colour behind donut charts. */
    track: isLight ? "#EEF1F7" : "rgba(255,255,255,0.06)",
  };
}

/** Tooltip — a small white card, matching menus and popovers. */
export function ChartTooltip({ active, payload, label, valueFormatter, labelFormatter, hideLabel = false }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 shadow-[var(--shadow-elevated)] min-w-[136px]">
      {!hideLabel && label != null && (
        <p className="text-[11px] font-semibold text-[var(--fg-muted)] mb-1.5">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2.5 w-2.5 rounded-[3px] shrink-0"
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

/** <defs> gradient for area/bar fills. */
export function ChartGradient({ id, color, from = 0.28, to = 0.02 }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared furniture: no axis lines, horizontal grid only, small muted ticks,
 * rounded bars, the number stated large above the plot, legends as readable
 * rows rather than chart chrome.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Rounded bar tops. Square feet keeps bars sitting on the axis, not floating. */
export const BAR_RADIUS = [6, 6, 0, 0];
export const BAR_MAX_SIZE = 26;
export const BAR_CATEGORY_GAP = "28%";

export function axisX(ct, extra = {}) {
  return {
    tickLine: false,
    axisLine: false,
    tick: { fill: ct.axis, fontSize: ct.tickFontSize },
    tickMargin: 8,
    minTickGap: 14,
    ...extra,
  };
}

export function axisY(ct, { unit, width = 46, ...extra } = {}) {
  return {
    tickLine: false,
    axisLine: false,
    width,
    tick: { fill: ct.axis, fontSize: ct.tickFontSize },
    tickMargin: 6,
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

export function gridProps(ct) {
  return { strokeDasharray: "4 6", vertical: false, stroke: ct.grid, strokeWidth: 1 };
}

/** The headline figure above a chart. */
export function ChartStat({ value, unit, caption, right }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="text-[30px] sm:text-[34px] leading-none font-semibold tracking-tight text-[var(--fg-primary)] tabular-nums">
            {value}
          </span>
          {unit && <span className="text-[13px] font-semibold text-[var(--fg-muted)]">{unit}</span>}
        </p>
        {caption && <p className="text-[12px] text-[var(--fg-muted)] mt-1.5">{caption}</p>}
      </div>
      {right}
    </div>
  );
}

/** Legend row: colour chip, label, share meter, value. */
export function LegendRow({ color, label, value, total, amount }) {
  // `value` is usually already formatted for display ("$3,325.00"), and
  // Number() of that is NaN — which produced `width: NaN%`, which browsers drop,
  // which silently rendered EVERY share meter full-width. Take an explicit
  // numeric `amount` when given, else recover the number from the string, and
  // render no meter at all rather than a meaningless full one.
  const numeric =
    typeof amount === "number"
      ? amount
      : typeof value === "number"
        ? value
        : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  const pct =
    total > 0 && Number.isFinite(numeric) ? Math.min(100, Math.max(0, (numeric / total) * 100)) : null;
  return (
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
      <span className="text-[12.5px] text-[var(--fg-secondary)] flex-1 min-w-0 truncate">{label}</span>
      {pct != null && (
        <span className="hidden sm:block w-24 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden shrink-0">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </span>
      )}
      <span className="text-[12.5px] font-semibold text-[var(--fg-primary)] tabular-nums shrink-0">{value}</span>
    </div>
  );
}

export function LegendRows({ children }) {
  return <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] space-y-2.5">{children}</div>;
}

/**
 * DonutCenter — absolutely-positioned label for the hole of a donut chart.
 * Salesforce always states the total in the middle; a ring with no total is a
 * shape, not a measurement.
 *
 * The size is derived from the string, because the hole is small and the value
 * is not. Recharts resolves BOTH radii in DONUT against min(w,h)/2 of the plot
 * rect — the inner one is not a fraction of the outer — so at the 196px box the
 * call sites use, the hole measures 115px across. "$6,322.00" at the 26px this
 * used to be fixed at renders 126px, which is why the total was being painted
 * onto the ring. Text also crosses the hole as a chord rather than a diameter,
 * so the usable width is a little under the full 115px.
 *
 * Deliberately pure arithmetic: no ref, no measure pass, no second paint that
 * could disagree with the first before the webfont settles.
 */
export function DonutCenter({ value, label, size = 196 }) {
  const text = String(value ?? "");
  const len = Math.max(text.length, 1);
  // 0.62 = DONUT.innerRadius, less the 5px chart margin on each side; 0.94
  // takes the chord rather than the diameter.
  const budget = 0.62 * (size - 10) * 0.94;
  // Measured, not guessed: Vodafone's tabular digits advance 0.488em at this
  // weight and tracking (Inter, the fallback, is 0.622em — a fifth wider). 0.50
  // covers the all-digits worst case with a little margin; strings carrying a
  // "," or "." come out narrower still, so charging every character a full
  // digit width keeps this an over-estimate rather than a near miss.
  const fontSize = Math.max(14, Math.min(26, Math.round(budget / (0.5 * len))));
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <span
        className="font-semibold leading-none tracking-tight text-[var(--fg-primary)] tabular-nums whitespace-nowrap"
        // Inline, not a Tailwind arbitrary value: the JIT cannot see a value
        // computed at runtime, so text-[${n}px] would emit no CSS at all.
        style={{ fontSize: `${fontSize}px` }}
      >
        {value}
      </span>
      {label && <span className="mt-1 text-[11px] font-medium text-[var(--fg-muted)]">{label}</span>}
    </div>
  );
}

/** Geometry for a donut: thick ring, soft gap between slices. */
export const DONUT = {
  innerRadius: "62%",
  outerRadius: "88%",
  paddingAngle: 2,
  cornerRadius: 4,
  stroke: "none",
};
