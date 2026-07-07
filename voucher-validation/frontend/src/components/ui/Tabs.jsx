/**
 * Tabs — controlled tab strip with two variants.
 *  • "underline" (default): page-level tabs with a sliding accent indicator.
 *  • "pills": segmented control for in-card / compact switching.
 * Each tab: { value, label, icon?(node), count? }. Controlled via value/onChange.
 */

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function Tabs({
  tabs = [],
  value,
  onChange,
  variant = "underline",
  size = "md",
  className,
}) {
  if (variant === "pills") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)]",
          className
        )}
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange?.(tab.value)}
              className={cn(
                "relative inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-200",
                size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
                active
                  ? "bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.count != null && (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "bg-[var(--bg-surface-hover)] text-[var(--fg-muted)]"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // underline variant
  return (
    <div className={cn("relative border-b border-[var(--border-default)]", className)}>
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange?.(tab.value)}
              className={cn(
                "group relative inline-flex items-center gap-2 whitespace-nowrap font-medium transition-colors duration-150",
                size === "sm" ? "px-3 py-2.5 text-[13px]" : "px-4 py-3 text-sm",
                active
                  ? "text-[var(--fg-primary)]"
                  : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              )}
            >
              {tab.icon && (
                <span
                  className={
                    active
                      ? "text-[var(--accent)]"
                      : "text-[var(--fg-muted)] group-hover:text-[var(--fg-secondary)]"
                  }
                >
                  {tab.icon}
                </span>
              )}
              {tab.label}
              {tab.count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors",
                    active
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "bg-[var(--bg-surface)] text-[var(--fg-muted)]"
                  )}
                >
                  {tab.count}
                </span>
              )}
              <span
                className={cn(
                  "absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-[var(--accent)] transition-all duration-300",
                  active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-50"
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
