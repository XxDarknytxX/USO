// src/components/shared/Pagination.jsx
// Compact page navigator. Lives at the bottom of tables.

import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div
      className={
        "flex items-center justify-between gap-3 px-5 py-3 " +
        "border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
      }
    >
      <span className="text-[12px] text-[var(--text-tertiary)] font-mono">
        Page {page} of {totalPages}
        <span className="text-[var(--text-quaternary)]"> · {total} items</span>
      </span>
      <div className="flex items-center gap-0.5">
        <PageNavButton
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </PageNavButton>

        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pageNum;
          if (totalPages <= 5) pageNum = i + 1;
          else if (page <= 3) pageNum = i + 1;
          else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = page - 2 + i;

          const active = pageNum === page;
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={
                "min-w-[28px] h-7 px-2 rounded text-[12px] font-mono transition-colors focus-ring " +
                (active
                  ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border border-[var(--brand-soft-hover)]"
                  : "text-[var(--text-secondary)] border border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
              }
            >
              {pageNum}
            </button>
          );
        })}

        <PageNavButton
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </PageNavButton>
      </div>
    </div>
  );
}

function PageNavButton({ children, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={
        "h-7 w-7 flex items-center justify-center rounded " +
        "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] " +
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent " +
        "focus-ring transition-colors"
      }
    >
      {children}
    </button>
  );
}
