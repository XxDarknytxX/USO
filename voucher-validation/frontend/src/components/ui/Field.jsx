// src/components/ui/Field.jsx
// Form field wrapper: label (top, never floating), optional hint and error.
// Use this around any Input/Select/Textarea/Toggle.

import { forwardRef, useId, useRef, useState } from "react";
import { ChevronDown, AlertCircle, X } from "lucide-react";

/* ------------ Field wrapper ----------------------------------------------- */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className = "",
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium tracking-tight text-[var(--text-secondary)] flex items-center gap-1"
        >
          {label}
          {required && (
            <span
              aria-hidden="true"
              className="text-[var(--brand)] leading-none"
            >
              *
            </span>
          )}
        </label>
      )}
      {children}
      {(hint || error) && (
        <div className="text-[11.5px] flex items-start gap-1 leading-snug">
          {error ? (
            <>
              <AlertCircle
                size={12}
                className="text-[var(--brand)] mt-px shrink-0"
              />
              <span className="text-[var(--brand)]">{error}</span>
            </>
          ) : (
            <span className="text-[var(--text-tertiary)]">{hint}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------ Input ------------------------------------------------------- */
const inputBase =
  "w-full h-9 px-3 text-[13px] rounded-md " +
  "bg-[var(--input-bg)] text-[var(--text-primary)] " +
  "border border-[var(--input-border)] " +
  "placeholder:text-[var(--text-quaternary)] " +
  "hover:border-[var(--input-border-hover)] " +
  "focus-input " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "font-sans";

export const Input = forwardRef(function Input(
  { className = "", mono = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`${inputBase} ${mono ? "font-mono tracking-tight" : ""} ${className}`}
      {...props}
    />
  );
});

/* ------------ Select ------------------------------------------------------ */
export const Select = forwardRef(function Select(
  { className = "", children, ...props },
  ref
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={`${inputBase} appearance-none pr-8 cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none"
      />
    </div>
  );
});

/* ------------ Textarea ---------------------------------------------------- */
export const Textarea = forwardRef(function Textarea(
  { className = "", rows = 3, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`${inputBase} h-auto py-2.5 resize-none leading-relaxed ${className}`}
      {...props}
    />
  );
});

/* ------------ Toggle (switch) -------------------------------------------- */
export function Toggle({ checked, onChange, label, hint, disabled, id }) {
  const reactId = useId();
  const inputId = id || reactId;
  return (
    <label
      htmlFor={inputId}
      className={`flex items-start gap-3 cursor-pointer select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <span className="relative inline-block shrink-0 mt-px">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />
        <span
          className={
            "block h-[20px] w-[34px] rounded-full transition-colors duration-150 " +
            "bg-[var(--surface-pressed)] peer-checked:bg-[var(--brand)] " +
            "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand-soft-hover)]"
          }
        />
        <span
          className={
            "absolute left-[2px] top-[2px] h-[16px] w-[16px] rounded-full bg-white " +
            "transition-transform duration-150 ease-out " +
            "shadow-[0_1px_2px_rgba(0,0,0,0.2)] " +
            "peer-checked:translate-x-[14px]"
          }
        />
      </span>
      {(label || hint) && (
        <span className="flex flex-col gap-0.5 -mt-0.5">
          {label && (
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {label}
            </span>
          )}
          {hint && (
            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              {hint}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

/* ------------ Tag input (chip list) -------------------------------------- */
export function TagInput({
  value = [],
  onChange,
  placeholder = "Type and press Enter…",
  className = "",
}) {
  const [draft, setDraft] = useState("");
  const ref = useRef(null);

  function add() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange?.([...value, tag]);
    setDraft("");
    ref.current?.focus();
  }
  function remove(tag) {
    onChange?.(value.filter((t) => t !== tag));
  }
  function onKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div
      onClick={() => ref.current?.focus()}
      className={
        `min-h-9 flex flex-wrap items-center gap-1.5 px-2 py-1.5 ` +
        `bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md ` +
        `hover:border-[var(--input-border-hover)] ` +
        `focus-within:border-[var(--border-focus)] ` +
        `focus-within:shadow-[0_0_0_3px_var(--brand-soft)] ` +
        `transition-[border-color,box-shadow] duration-150 cursor-text ${className}`
      }
    >
      {value.map((tag) => (
        <span
          key={tag}
          className={
            "inline-flex items-center gap-1 px-2 py-0.5 text-[12px] font-medium rounded " +
            "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
          }
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(tag);
            }}
            className="text-[var(--brand-fg-on-soft)]/60 hover:text-[var(--brand-fg-on-soft)] transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-[13px] outline-none placeholder:text-[var(--text-quaternary)] py-0.5 text-[var(--text-primary)]"
      />
    </div>
  );
}
