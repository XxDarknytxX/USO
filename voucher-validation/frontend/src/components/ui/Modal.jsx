// src/components/ui/Modal.jsx
// Centered modal dialog. Wide, generous padding, locked body scroll.
// Composable: <Modal open onClose><Modal.Header/><Modal.Body/><Modal.Footer/></Modal>

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { IconButton } from "./Button";

const widths = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
  "2xl": "max-w-4xl",
};

export default function Modal({
  open,
  onClose,
  width = "xl",
  closeOnBackdrop = true,
  children,
  className = "",
}) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 backdrop-saturate"
            style={{ backgroundColor: "var(--overlay)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => closeOnBackdrop && onClose?.()}
          />

          {/* Panel */}
          <motion.div
            className={
              `relative w-full ${widths[width]} max-h-[88vh] flex flex-col ` +
              `bg-[var(--surface-raised)] ` +
              `border border-[var(--border-default)] ` +
              `rounded-xl shadow-[var(--elev-4)] ` +
              `overflow-hidden grain ${className}`
            }
            initial={{ scale: 0.98, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{
              type: "spring",
              damping: 28,
              stiffness: 320,
              mass: 0.7,
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------ Header ------------------------------------------------------ */
function Header({
  eyebrow,
  title,
  subtitle,
  onClose,
  icon: Icon,
  className = "",
}) {
  return (
    <div
      className={
        `relative flex items-start justify-between gap-4 ` +
        `px-7 pt-6 pb-5 ` +
        `border-b border-[var(--border-subtle)] ` +
        className
      }
    >
      <div className="flex items-start gap-4 min-w-0">
        {Icon && (
          <span
            className={
              "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center " +
              "bg-[var(--brand-soft)] text-[var(--brand)] " +
              "border border-[var(--brand-soft-hover)]"
            }
          >
            <Icon size={18} strokeWidth={1.75} />
          </span>
        )}
        <div className="flex flex-col min-w-0">
          {eyebrow && (
            <span className="text-[12px] font-medium text-[var(--text-tertiary)] mb-0.5">
              {eyebrow}
            </span>
          )}
          <h2 className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)] leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 leading-snug">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {onClose && (
        <IconButton onClick={onClose} aria-label="Close" size="sm">
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}

/* ------------ Body (scrollable) ------------------------------------------ */
function Body({ children, className = "" }) {
  return (
    <div
      className={`flex-1 overflow-y-auto px-7 py-6 ${className}`}
      // Subtle inner shadow at the top/bottom edges when content is scrollable
      // — uses radial mask to fade the edges
    >
      {children}
    </div>
  );
}

/* ------------ Footer ------------------------------------------------------ */
function Footer({ children, className = "" }) {
  return (
    <div
      className={
        `shrink-0 flex items-center justify-end gap-2.5 ` +
        `px-7 py-4 ` +
        `border-t border-[var(--border-subtle)] ` +
        `bg-[var(--surface-sunken)] ` +
        className
      }
    >
      {children}
    </div>
  );
}

Modal.Header = Header;
Modal.Body = Body;
Modal.Footer = Footer;
