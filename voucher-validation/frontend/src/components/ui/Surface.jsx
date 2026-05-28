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
        "rounded-lg shadow-[var(--elev-1)] " +
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
  "inline-flex items-center gap-1 font-medium rounded text-[11px] tracking-tight " +
  "px-1.5 py-0.5 leading-tight";

const badgeTones = {
  neutral:
    "bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)]",
  brand:
    "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border border-[var(--brand-soft-hover)]",
  success:
    "bg-[var(--success-soft)] text-[var(--success-fg)] border border-transparent",
  warning:
    "bg-[var(--warning-soft)] text-[var(--warning-fg)] border border-transparent",
  danger:
    "bg-[var(--danger-soft)] text-[var(--danger-fg)] border border-transparent",
  info:
    "bg-[var(--info-soft)] text-[var(--info-fg)] border border-transparent",
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
  const sz = size === "md" ? "text-[12px] px-2 py-0.5" : "";
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
        <div
          className={
            "w-12 h-12 rounded-lg flex items-center justify-center " +
            "bg-[var(--surface-sunken)] border border-[var(--border-subtle)] " +
            "text-[var(--text-quaternary)] mb-3"
          }
        >
          <Icon size={22} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-[14px] font-medium text-[var(--text-secondary)]">
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
