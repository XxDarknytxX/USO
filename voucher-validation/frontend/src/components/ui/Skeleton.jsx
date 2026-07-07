/**
 * Skeleton — theme-aware shimmer loading placeholders.
 * Uses the `.skeleton` utility (main.css). Helpers cover lines, KPI rails,
 * tables, and cards.
 */

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function Skeleton({ className, rounded = "rounded-lg", style, ...props }) {
  return <div className={cn("skeleton", rounded, className)} style={style} {...props} />;
}

export function SkeletonText({ lines = 3, className, lastWidth = "70%" }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          rounded="rounded-md"
          style={{ width: i === lines - 1 ? lastWidth : "100%" }}
        />
      ))}
    </div>
  );
}

/** Horizontal rail of KPI placeholders. */
export function SkeletonKpis({ count = 4, className }) {
  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" rounded="rounded-md" />
            <Skeleton className="h-9 w-9" rounded="rounded-xl" />
          </div>
          <Skeleton className="h-8 w-20" rounded="rounded-lg" />
          <Skeleton className="h-2.5 w-24" rounded="rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A card-shaped block (e.g. for chart / panel loading). */
export function SkeletonCard({ className, height = "h-72" }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5",
        height,
        className
      )}
    >
      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-4 w-32" rounded="rounded-md" />
        <Skeleton className="h-7 w-20" rounded="rounded-lg" />
      </div>
      <div className="flex items-end gap-3 h-[60%]">
        {[60, 85, 45, 95, 70, 55, 80].map((h, i) => (
          <Skeleton key={i} className="flex-1" rounded="rounded-md" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Table placeholder with header + rows. */
export function SkeletonTable({ rows = 6, cols = 4, className }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] overflow-hidden",
        className
      )}
    >
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/40">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 0 ? "w-40" : "w-24")} rounded="rounded-md" />
        ))}
      </div>
      <div className="divide-y divide-[var(--border-default)]">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn("h-3.5", c === 0 ? "w-44" : "w-20")}
                rounded="rounded-md"
                style={{ animationDelay: `${(r * cols + c) * 40}ms` }}
              />
            ))}
            <div className="ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
