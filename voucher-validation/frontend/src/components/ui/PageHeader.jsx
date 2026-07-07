/**
 * Page Header — consistent, premium page title block.
 *  • icon    — a node (lucide icon), shown in a Vodafone-red tile
 *  • eyebrow — small uppercase accent label above the title (section context)
 *  • actions — right-aligned controls slot
 */

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  eyebrow,
  className,
  gradient = false,
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3.5 min-w-0">
        {icon && (
          <div className="hidden sm:flex shrink-0 mt-0.5 h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15 shadow-[0_2px_12px_rgba(230,0,0,0.12)]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="text-label mb-1 !text-[var(--accent)]">{eyebrow}</p>}
          <h1
            className={cn(
              "text-2xl sm:text-[28px] font-semibold tracking-tight leading-tight",
              gradient ? "text-gradient" : "text-[var(--fg-primary)]"
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-[var(--fg-secondary)] mt-1 text-sm leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
      )}
    </div>
  );
}

/** Section Header — for subsections within a page. */
export function SectionHeader({ title, subtitle, actions, icon, className }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <span className="shrink-0 text-[var(--fg-muted)]">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)] tracking-tight">
            {title}
          </h2>
          {subtitle && <p className="text-sm text-[var(--fg-secondary)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
