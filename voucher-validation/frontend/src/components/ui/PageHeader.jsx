/**
 * Page header — modelled on Salesforce's record home: the page identifies itself
 * on its own white card, with a coloured object tile, an eyebrow for context, a
 * title, and its actions on the right.
 *
 * It renders its own surface rather than sitting bare on the canvas, which is
 * what makes a page read as "a thing you are looking at" rather than as a wall
 * of controls. The wash behind the tile is the one decorative flourish — enough
 * to stop a dense admin feeling like a spreadsheet.
 *
 * Props unchanged: title, subtitle, actions, icon, eyebrow, className, gradient.
 * New: tone (tile colour) and media (an image/illustration for the right edge).
 */

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

import { ObjectTile } from "./StatCard";
import { usePublishPageTitle } from "../layout/pageTitle";

export default function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  eyebrow,
  className,
  tone = "red",
  media = null,
  gradient = false, // eslint-disable-line no-unused-vars -- kept for API compatibility
}) {
  // The phone's app bar carries the name of the screen, so the hero does not
  // repeat it: it keeps the sentence that explains the page and the buttons
  // that act on it, and gives the rest of the screen back to the content.
  usePublishPageTitle(title);
  const phoneEmpty = !subtitle && !actions && !media;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-[var(--border-default)]",
        "bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]",
        "px-5 py-4 sm:px-6 sm:py-5 max-sm:px-4 max-sm:py-3.5",
        phoneEmpty && "max-sm:hidden",
        className
      )}
    >
      {/* Decorative wash — keeps the header from reading as a plain grey bar. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full opacity-[0.55]"
        style={{ background: "radial-gradient(circle, var(--tile-blue-soft) 0%, transparent 68%)" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 right-24 h-48 w-48 rounded-full opacity-40"
        style={{ background: "radial-gradient(circle, var(--brand-soft) 0%, transparent 70%)" }}
      />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4 min-w-0 max-sm:gap-0">
          {icon && (
            <ObjectTile tone={tone} size="lg" className="mt-0.5 shadow-[var(--shadow-xs)] max-sm:hidden">
              {icon}
            </ObjectTile>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="text-label mb-1 max-sm:hidden">{eyebrow}</p>}
            {/* Still the page's heading for a screen reader; the phone just
                reads it from the bar instead of showing it twice. */}
            <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-[-0.022em] leading-tight text-[var(--fg-primary)] max-sm:sr-only">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[13.5px] text-[var(--fg-secondary)] mt-1 leading-relaxed max-w-3xl max-sm:mt-0 max-sm:text-[12.5px]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {media}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** Section header — for subsections inside a page. */
export function SectionHeader({ title, subtitle, actions, icon, className }) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <span className="shrink-0 text-[var(--fg-muted)]">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-[var(--fg-primary)] tracking-tight">{title}</h2>
          {subtitle && <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
