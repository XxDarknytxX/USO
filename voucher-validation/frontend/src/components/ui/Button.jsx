// src/components/ui/Button.jsx
// The button primitive. Variants: primary | secondary | ghost | danger | brand-ghost
// Sizes: xs | sm | md | lg
// All variants honor focus-visible ring, disabled, loading states.

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

const baseStyles =
  "inline-flex items-center justify-center gap-2 font-medium tracking-tight " +
  "transition-[background-color,color,border-color,box-shadow,transform] duration-150 " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-ring rounded-md whitespace-nowrap select-none";

const sizes = {
  xs: "h-7 px-2.5 text-[12px] gap-1.5",
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-10 px-4 text-[14px]",
};

const variants = {
  // Solid brand red. Use sparingly — primary CTAs only.
  primary:
    "bg-[var(--brand)] text-[var(--text-on-brand)] " +
    "hover:bg-[var(--brand-hover)] active:bg-[var(--brand-pressed)] " +
    "shadow-[0_1px_2px_rgba(230,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.18)]",

  // Neutral surface with hairline border. The workhorse.
  secondary:
    "bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--border-default)] " +
    "hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] " +
    "active:bg-[var(--surface-pressed)]",

  // Truly invisible until hovered. For toolbar icons, table actions.
  ghost:
    "bg-transparent text-[var(--text-secondary)] " +
    "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] " +
    "active:bg-[var(--surface-pressed)]",

  // Destructive action.
  danger:
    "bg-[var(--brand)] text-[var(--text-on-brand)] " +
    "hover:bg-[var(--brand-hover)] active:bg-[var(--brand-pressed)] " +
    "shadow-[0_1px_2px_rgba(230,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.18)]",

  // Soft brand fill — for secondary brand actions
  "brand-ghost":
    "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] " +
    "hover:bg-[var(--brand-soft-hover)]",
};

const Button = forwardRef(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      iconLeft = null,
      iconRight = null,
      className = "",
      children,
      disabled,
      type = "button",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`${baseStyles} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" size={size === "xs" ? 12 : 14} />
        ) : (
          iconLeft
        )}
        {children && <span className="truncate">{children}</span>}
        {!loading && iconRight}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;

// Icon-only button (square). Pass an icon as children.
export function IconButton({
  size = "md",
  variant = "ghost",
  className = "",
  children,
  ...props
}) {
  const dims = {
    xs: "h-7 w-7",
    sm: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-10 w-10",
  };
  return (
    <button
      {...props}
      className={`${baseStyles} ${dims[size]} ${variants[variant]} ${className} px-0`}
    >
      {children}
    </button>
  );
}
