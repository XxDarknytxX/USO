// src/components/ui/Button.jsx
// Variants: primary | secondary | ghost | danger | brand-ghost. Sizes: xs|sm|md|lg.
//
// Pill-shaped, after Salesforce Cosmos. The hierarchy is deliberate: `secondary`
// (white, hairline border) is the workhorse and should be most of the buttons on
// a page; `primary` is solid Vodafone red and marks the one action a screen is
// for. `danger` is outlined rather than solid so a destructive button never
// looks identical to the brand action sitting next to it.

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

const baseStyles =
  "inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.005em] " +
  "transition-[background-color,color,border-color,box-shadow,transform] duration-150 " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-ring rounded-full whitespace-nowrap select-none";

// The small sizes grow on a touch screen: 28px is a comfortable click and a
// miss for a thumb. Desktop density is unchanged.
const sizes = {
  xs: "h-7 px-3 text-[12px] gap-1.5 pointer-coarse:h-9",
  sm: "h-8 px-3.5 text-[12.5px] pointer-coarse:h-9",
  md: "h-9 px-4 text-[13px] pointer-coarse:h-10",
  lg: "h-11 px-5 text-[14px]",
};

const variants = {
  primary:
    "bg-[var(--brand)] text-[var(--text-on-brand)] border border-transparent " +
    "hover:bg-[var(--brand-hover)] active:bg-[var(--brand-pressed)] " +
    "shadow-[var(--shadow-button)] hover:shadow-[var(--shadow-button-hover)]",

  secondary:
    "bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--input-border)] " +
    "hover:bg-[var(--bg-surface)] hover:border-[var(--input-border-hover)] " +
    "active:bg-[var(--surface-pressed)] shadow-[var(--shadow-xs)]",

  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent " +
    "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] " +
    "active:bg-[var(--surface-pressed)]",

  danger:
    "bg-[var(--surface)] text-[var(--danger-fg)] border border-[var(--danger-border)] " +
    "hover:bg-[var(--danger-soft)] active:bg-[var(--danger-soft)]",

  "brand-ghost":
    "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border border-transparent " +
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
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`${baseStyles} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" size={size === "xs" ? 12 : 14} /> : iconLeft}
      {children && <span className="truncate">{children}</span>}
      {!loading && iconRight}
    </button>
  )
);

Button.displayName = "Button";
export default Button;

/** Icon-only button. Round, to match the pill family. */
export function IconButton({ size = "md", variant = "ghost", className = "", children, ...props }) {
  const dims = { xs: "h-7 w-7 pointer-coarse:h-9 pointer-coarse:w-9", sm: "h-8 w-8 pointer-coarse:h-9 pointer-coarse:w-9", md: "h-9 w-9 pointer-coarse:h-10 pointer-coarse:w-10", lg: "h-10 w-10" };
  return (
    <button {...props} className={`${baseStyles} ${dims[size]} ${variants[variant]} ${className} px-0`}>
      {children}
    </button>
  );
}
