// src/components/ui/Surface.jsx
// Surfaces (Card / Panel), Badge, Section divider, Empty state, Kbd.
// Small, presentational, no state.

/* ------------ Card / Panel ------------------------------------------------ */
export function Card({ className = "", children, ...props }) {
  return (
    <div
      {...props}
      className={
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "rounded-xl shadow-[var(--shadow-card)] " +
        className
      }
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children }) {
  return (
    <div
      className={
        "px-5 py-4 border-b border-[var(--border-subtle)] " +
        "flex items-center justify-between gap-4 " +
        className
      }
    >
      {children}
    </div>
  );
}

export function CardBody({ className = "", children }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

/* ------------ Badge ------------------------------------------------------- */
const badgeBase =
  "inline-flex items-center gap-1.5 font-semibold rounded-full text-[11px] " +
  "px-2 py-[3px] leading-tight whitespace-nowrap";

const badgeTones = {
  neutral:
    "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]",
  brand:
    "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border border-[var(--brand-soft-hover)]",
  success:
    "bg-[var(--success-soft)] text-[var(--success-fg)] border border-[var(--success-border)]",
  warning:
    "bg-[var(--warning-soft)] text-[var(--warning-fg)] border border-[var(--warning-border)]",
  danger:
    "bg-[var(--danger-soft)] text-[var(--danger-fg)] border border-[var(--danger-border)]",
  info:
    "bg-[var(--info-soft)] text-[var(--info-fg)] border border-[var(--info-border)]",
  outline:
    "bg-transparent text-[var(--text-secondary)] border border-[var(--border-default)]",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  className = "",
  icon = null,
  children,
}) {
  const sz = size === "md" ? "text-[12px] px-2.5 py-[4px]" : "";
  return (
    <span className={`${badgeBase} ${badgeTones[tone]} ${sz} ${className}`}>
      {icon && <span className="opacity-80">{icon}</span>}
      {children}
    </span>
  );
}

/* ------------ Section divider with optional label ------------------------ */
export function Section({ label, children, className = "" }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {label && (
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
            {label}
          </span>
          <span className="flex-1 h-px bg-[var(--border-subtle)]" />
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------ Empty state ------------------------------------------------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}) {
  return (
    <div
      className={
        `flex flex-col items-center justify-center text-center px-6 py-16 ${className}`
      }
    >
      {Icon && (
        <div className="relative mb-4">
          <span
            className="absolute inset-0 -m-3 rounded-full opacity-70"
            style={{ background: "radial-gradient(circle, var(--tile-blue-soft) 0%, transparent 70%)" }}
            aria-hidden="true"
          />
          <div
            className={
              "relative w-14 h-14 rounded-2xl flex items-center justify-center " +
              "bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--tile-blue)]"
            }
          >
            <Icon size={24} strokeWidth={1.5} />
          </div>
        </div>
      )}
      <p className="text-[14.5px] font-semibold text-[var(--text-primary)]">
        {title}
      </p>
      {description && (
        <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-xs">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------ Keyboard chip ----------------------------------------------- */
export function Kbd({ children }) {
  return (
    <kbd
      className={
        "inline-flex items-center justify-center min-w-[18px] h-[18px] " +
        "px-1 font-mono text-[10.5px] font-medium " +
        "text-[var(--text-tertiary)] " +
        "bg-[var(--surface-raised)] " +
        "border border-[var(--border-default)] " +
        "rounded shadow-[0_1px_0_var(--border-subtle)]"
      }
    >
      {children}
    </kbd>
  );
}
