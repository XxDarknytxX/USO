/**
 * Card family — GlassCard / Panel / StatCard / ObjectTile.
 *
 * Modelled on Salesforce Lightning cards: a white surface on a soft diffuse
 * shadow, a generous radius, and colour carried by a small object tile rather
 * than by the card itself. The old build tinted whole cards and swept a
 * spotlight gradient under the cursor; both are dropped, because a dashboard of
 * twelve tinted panels has no visual hierarchy left to spend.
 *
 * The props are unchanged (tint, spotlight, accent, size…) so no page has to be
 * touched — tint now selects the tile colour instead of washing the surface.
 */

import { useTheme } from "../../contexts/theme";

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------------------
 * Object tiles. Salesforce's most recognisable device: every "thing" gets a
 * rounded square in its own colour, which is what makes a dense admin scannable
 * without resorting to a different layout per page.
 * ------------------------------------------------------------------------- */
export const TILE_TONES = {
  brand:  { fg: "var(--tile-red)",    bg: "var(--tile-red-soft)" },
  red:    { fg: "var(--tile-red)",    bg: "var(--tile-red-soft)" },
  accent: { fg: "var(--tile-red)",    bg: "var(--tile-red-soft)" },
  blue:   { fg: "var(--tile-blue)",   bg: "var(--tile-blue-soft)" },
  navy:   { fg: "var(--tile-navy)",   bg: "var(--tile-navy-soft)" },
  teal:   { fg: "var(--tile-teal)",   bg: "var(--tile-teal-soft)" },
  cyan:   { fg: "var(--tile-teal)",   bg: "var(--tile-teal-soft)" },
  violet: { fg: "var(--tile-violet)", bg: "var(--tile-violet-soft)" },
  indigo: { fg: "var(--tile-indigo)", bg: "var(--tile-indigo-soft)" },
  orange: { fg: "var(--tile-orange)", bg: "var(--tile-orange-soft)" },
  amber:  { fg: "var(--tile-orange)", bg: "var(--tile-orange-soft)" },
  green:  { fg: "var(--tile-green)",  bg: "var(--tile-green-soft)" },
  emerald:{ fg: "var(--tile-green)",  bg: "var(--tile-green-soft)" },
  pink:   { fg: "var(--tile-pink)",   bg: "var(--tile-pink-soft)" },
  rose:   { fg: "var(--tile-pink)",   bg: "var(--tile-pink-soft)" },
  slate:  { fg: "var(--fg-muted)",    bg: "var(--bg-surface)" },
  default:{ fg: "var(--fg-muted)",    bg: "var(--bg-surface)" },
};

const TILE_SIZES = {
  xs: "h-7 w-7 rounded-[8px]",
  sm: "h-8 w-8 rounded-[9px]",
  md: "h-10 w-10 rounded-[12px]",
  lg: "h-12 w-12 rounded-[14px]",
};

/** A coloured glyph tile. `children` is the icon. */
export function ObjectTile({ tone = "blue", size = "md", children, className }) {
  const t = TILE_TONES[tone] || TILE_TONES.default;
  return (
    <span
      className={cn("inline-flex items-center justify-center shrink-0", TILE_SIZES[size] || TILE_SIZES.md, className)}
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * GlassCard — the base surface everything else is built from.
 * ------------------------------------------------------------------------- */
export function GlassCard({
  children,
  className,
  padding = true,
  hover = true,
  spotlight = false, // kept for API compatibility; no longer renders anything
  onClick,
  accent = false,
  size = "md",
  tint = "default", // eslint-disable-line no-unused-vars
}) {
  useTheme(); // re-render on theme change so token-derived styles stay in step
  const paddingSizes = { sm: "p-4", md: "p-5", lg: "p-7" };

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]",
        "shadow-[var(--shadow-card)] transition-[box-shadow,border-color,transform] duration-200",
        hover && "hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-card-hover)]",
        onClick && "cursor-pointer hover:-translate-y-[2px]",
        padding && (paddingSizes[size] || paddingSizes.md),
        accent && "surface-accent-top overflow-hidden",
        className
      )}
    >
      <div className="relative h-full flex-1 flex flex-col">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * StatCard — a KPI tile.
 * ------------------------------------------------------------------------- */
const STAT_TONE = {
  accent: "red", red: "red", brand: "red",
  emerald: "green", green: "green",
  blue: "blue", navy: "navy", cyan: "teal", teal: "teal",
  amber: "orange", orange: "orange",
  violet: "violet", indigo: "indigo",
  rose: "pink", pink: "pink",
  slate: "slate",
};

export function StatCard({ label, value, sub, icon, color = "accent", trend, trendValue, onClick, className }) {
  const tone = STAT_TONE[color] || "blue";
  return (
    <GlassCard className={className} onClick={onClick} size="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label truncate">{label}</p>
          <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-[var(--fg-primary)]">
            {value}
          </p>
        </div>
        {icon && <ObjectTile tone={tone}>{icon}</ObjectTile>}
      </div>
      {(sub || trend) && (
        <div className="mt-3 flex items-center gap-2 min-w-0">
          {trend && (
            <span
              className={cn(
                "text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                trend === "up" && "bg-[var(--success-soft)] text-[var(--success-fg)]",
                trend === "down" && "bg-[var(--danger-soft)] text-[var(--danger-fg)]",
                trend === "neutral" && "bg-[var(--bg-surface)] text-[var(--fg-muted)]"
              )}
            >
              {trend === "up" ? "↑ " : trend === "down" ? "↓ " : ""}
              {trendValue}
            </span>
          )}
          {sub && <span className="text-[12px] text-[var(--fg-muted)] truncate">{sub}</span>}
        </div>
      )}
    </GlassCard>
  );
}

/* ---------------------------------------------------------------------------
 * MeterCard — a KPI that is a ratio rather than a number.
 *
 * Sits in the same KpiGrid as StatCard and matches it deliberately: same
 * GlassCard, same label and figure sizes, so a row mixing the two does not
 * look like two different components.
 *
 * The meter is the point. "24,318 GB" answers nothing on its own; "24,318 of
 * 41,000 GB, 59%" tells an operator whether the estate is on track for the
 * month. Where no total exists the bar is omitted rather than drawn empty or
 * full — both would be claims we cannot make — and the figure stands alone.
 * ------------------------------------------------------------------------- */
export function MeterCard({
  label,
  used,              // number, already in the display unit
  total,             // number or null/0 when none is published
  unit = "",
  format = (n) => Number(n || 0).toLocaleString(),
  icon,
  color = "accent",
  sub,               // shown when there IS a total; the no-total note replaces it
  noTotalNote = "no limit published",
  // For ratios whose denominator is a constant everyone already knows — a
  // percentage against 100, say. The meter still needs the total to size
  // itself; printing it just reads as noise ("25 / 100 %").
  showTotal = true,
  onClick,
  className,
}) {
  const tone = STAT_TONE[color] || "blue";
  const hasTotal = total != null && Number(total) > 0;
  const pct = hasTotal ? (Number(used || 0) / Number(total)) * 100 : null;
  const over = hasTotal && Number(used || 0) > Number(total);
  // Past the limit the bar goes red regardless of the colour asked for: a card
  // reporting an exceeded allowance in a calm violet is not doing its job.
  const barColor = over
    ? "var(--danger-fg)"
    : pct >= 90
      ? "var(--danger-fg)"
      : pct >= 70
        ? "var(--warning-fg)"
        : "var(--success-fg)";

  return (
    <GlassCard className={className} onClick={onClick} size="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label truncate">{label}</p>
          <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-[var(--fg-primary)]">
            {format(used)}
            {hasTotal && showTotal && (
              <span className="text-[15px] font-medium text-[var(--fg-muted)]">
                {" / "}
                {format(total)}
              </span>
            )}
            {unit && <span className="text-[15px] font-medium text-[var(--fg-muted)]"> {unit}</span>}
          </p>
        </div>
        {icon && <ObjectTile tone={tone}>{icon}</ObjectTile>}
      </div>

      {hasTotal ? (
        <>
          <div
            className="mt-3.5 h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden"
            title={
              over
                ? `${Math.round(pct)}% — ${format(Number(used) - Number(total))} ${unit} past the limit`
                : `${Math.round(pct)}% of ${format(total)} ${unit}`
            }
          >
            {/* Clamped: usage can legitimately exceed the allowance, and an
                unclamped bar would render past its own track. */}
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 tabular-nums",
                over
                  ? "bg-[var(--danger-soft)] text-[var(--danger-fg)]"
                  : "bg-[var(--bg-surface)] text-[var(--fg-muted)]"
              )}
            >
              {Math.round(pct)}%
            </span>
            <span className="text-[12px] text-[var(--fg-muted)] truncate">
              {over ? `${format(Number(used) - Number(total))} ${unit} over` : sub}
            </span>
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 min-w-0">
          <span className="text-[12px] text-[var(--fg-muted)] truncate">{noTotalNote}</span>
        </div>
      )}
    </GlassCard>
  );
}

/* ---------------------------------------------------------------------------
 * Panel — titled container for charts, tables and grouped content.
 * ------------------------------------------------------------------------- */
export function Panel({
  title,
  subtitle,
  icon,
  tone,                 // tile colour for the header icon
  actions,
  children,
  className,
  bodyClassName,
  padding = true,
  hover = false,
  tint = "default",
}) {
  const tileTone = tone || (tint && tint !== "default" ? STAT_TONE[tint] || tint : "blue");
  return (
    <GlassCard className={cn("flex flex-col", className)} hover={hover} padding={false}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <ObjectTile tone={tileTone} size="sm">{icon}</ObjectTile>}
            <div className="min-w-0">
              {title && (
                <h3 className="text-[14.5px] font-semibold text-[var(--fg-primary)] tracking-tight truncate">
                  {title}
                </h3>
              )}
              {subtitle && <p className="text-[12px] text-[var(--fg-muted)] mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("flex-1 min-h-0", padding && "p-5", bodyClassName)}>{children}</div>
    </GlassCard>
  );
}
