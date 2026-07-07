/**
 * StatCard / Panel — Service Desk card family (gradient surface, spotlight,
 * hover lift). Kept separate from the legacy Surface `Card` so existing pages
 * are untouched; dashboards use these.
 */

import { useRef, useState, useCallback } from "react";
import { useTheme } from "../../contexts/theme";

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

const cardTints = {
  default: "from-white/[0.03] to-transparent",
  red: "from-red-500/[0.04] to-red-900/[0.02]",
  rose: "from-rose-500/[0.04] to-rose-900/[0.02]",
  amber: "from-amber-500/[0.04] to-amber-900/[0.02]",
  emerald: "from-emerald-500/[0.04] to-emerald-900/[0.02]",
  blue: "from-blue-500/[0.04] to-blue-900/[0.02]",
  cyan: "from-cyan-500/[0.04] to-cyan-900/[0.02]",
  violet: "from-violet-500/[0.04] to-violet-900/[0.02]",
  indigo: "from-indigo-500/[0.04] to-indigo-900/[0.02]",
  slate: "from-slate-500/[0.04] to-slate-900/[0.02]",
};
const spotlightColors = {
  default: "rgba(255,255,255,0.04)",
  red: "rgba(239,68,68,0.06)",
  rose: "rgba(244,63,94,0.06)",
  amber: "rgba(245,158,11,0.06)",
  emerald: "rgba(16,185,129,0.06)",
  blue: "rgba(59,130,246,0.06)",
  cyan: "rgba(6,182,212,0.06)",
  violet: "rgba(139,92,246,0.06)",
  indigo: "rgba(99,102,241,0.06)",
  slate: "rgba(100,116,139,0.06)",
};

export function GlassCard({
  children,
  className,
  padding = true,
  hover = true,
  spotlight = false,
  onClick,
  accent = false,
  size = "md",
  tint = "default",
}) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const cardRef = useRef(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const handleMouseMove = useCallback(
    (e) => {
      if (!spotlight || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      setPos({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      });
    },
    [spotlight]
  );

  const paddingSizes = { sm: "p-4", md: "p-6", lg: "p-8" };
  const gradientTint = cardTints[tint] || cardTints.default;
  const spotlightColor = spotlightColors[tint] || spotlightColors.default;

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      className={cn(
        "relative overflow-hidden group rounded-xl border border-[var(--border-default)] transition-all duration-200",
        isLight ? "bg-[var(--bg-elevated)]" : ["bg-gradient-to-br", gradientTint],
        "shadow-[var(--shadow-card)]",
        hover && ["hover:border-[var(--border-hover)]", "hover:shadow-[var(--shadow-card-hover)]", "hover:-translate-y-0.5"],
        onClick && "cursor-pointer",
        padding && paddingSizes[size],
        accent && "surface-accent-top",
        className
      )}
    >
      {!isLight && (
        <div className="absolute top-0 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      )}
      {spotlight && (
        <div
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `radial-gradient(600px circle at ${pos.x}% ${pos.y}%, ${spotlightColor}, transparent 40%)` }}
        />
      )}
      <div className="relative z-10 h-full flex-1 flex flex-col">{children}</div>
    </div>
  );
}

const statColors = {
  accent:  { icon: "bg-[var(--accent)]/10 text-[var(--accent)]", value: "text-[var(--fg-primary)]", dot: "bg-[var(--accent)]",  tint: "red" },
  red:     { icon: "bg-[var(--accent)]/10 text-[var(--accent)]", value: "text-[var(--fg-primary)]", dot: "bg-[var(--accent)]",  tint: "red" },
  emerald: { icon: "bg-emerald-500/10 text-emerald-400",         value: "text-[var(--fg-primary)]", dot: "bg-emerald-500",     tint: "emerald" },
  blue:    { icon: "bg-blue-500/10 text-blue-400",               value: "text-[var(--fg-primary)]", dot: "bg-blue-500",        tint: "blue" },
  amber:   { icon: "bg-amber-500/10 text-amber-400",             value: "text-[var(--fg-primary)]", dot: "bg-amber-500",       tint: "amber" },
  violet:  { icon: "bg-violet-500/10 text-violet-400",           value: "text-[var(--fg-primary)]", dot: "bg-violet-500",      tint: "violet" },
  rose:    { icon: "bg-rose-500/10 text-rose-400",               value: "text-[var(--fg-primary)]", dot: "bg-rose-500",        tint: "rose" },
  slate:   { icon: "bg-slate-500/10 text-slate-400",             value: "text-[var(--fg-primary)]", dot: "bg-slate-400",       tint: "slate" },
};

/**
 * StatCard — KPI tile. onClick makes it interactive (dashboard drill-down).
 */
export function StatCard({ label, value, sub, icon, color = "accent", trend, trendValue, onClick, className }) {
  const c = statColors[color] || statColors.accent;
  return (
    <GlassCard className={className} hover spotlight tint={c.tint} onClick={onClick}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={cn("status-dot", c.dot)} />
            <span className="text-label truncate">{label}</span>
          </div>
          {icon && (
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center border border-[var(--border-default)] shrink-0", c.icon)}>
              {icon}
            </div>
          )}
        </div>
        <p className={cn("text-[32px] leading-none font-semibold tracking-tight tabular-nums", c.value)}>{value}</p>
        {(sub || trend) && (
          <div className="mt-3 flex items-center gap-2">
            {trend && (
              <span
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  trend === "up" && "bg-emerald-500/10 text-emerald-400",
                  trend === "down" && "bg-rose-500/10 text-rose-400",
                  trend === "neutral" && "bg-slate-500/10 text-slate-400"
                )}
              >
                {trend === "up" ? "↑ " : trend === "down" ? "↓ " : ""}{trendValue}
              </span>
            )}
            {sub && <span className="text-xs text-[var(--fg-secondary)] truncate">{sub}</span>}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/**
 * Panel — titled card container for charts, tables and grouped content.
 */
export function Panel({ title, subtitle, icon, actions, children, className, bodyClassName, padding = true, hover = false, tint = "default" }) {
  return (
    <GlassCard className={cn("flex flex-col", className)} hover={hover} padding={false} tint={tint}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-[var(--fg-muted)] shrink-0">{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="text-[15px] font-semibold text-[var(--fg-primary)] tracking-tight truncate">{title}</h3>}
              {subtitle && <p className="text-xs text-[var(--fg-secondary)] mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("flex-1 min-h-0", padding && "p-5", bodyClassName)}>{children}</div>
    </GlassCard>
  );
}
