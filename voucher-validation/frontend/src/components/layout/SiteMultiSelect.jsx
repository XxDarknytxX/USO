// src/components/layout/SiteMultiSelect.jsx
// "Which villages to show" filter — drives the Overview board + Network tab.
// Reads/writes the shared visible-villages selection in useSite.

import { useEffect, useRef, useState } from "react";
import { ListFilter, Check, ChevronDown, MapPin } from "lucide-react";
import { useSite } from "../../hooks/useSite";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

export default function SiteMultiSelect() {
  const { sites, isSiteVisible, toggleVisibleSite, setVisibleSiteIds, allVisible, visibleSites } = useSite();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const total = sites.length;
  const shown = allVisible ? total : visibleSites.length;
  const label = allVisible ? "All villages" : `${shown} of ${total} villages`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-colors",
          "border",
          allVisible
            ? "bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:border-[var(--border-hover)]"
            : "bg-[var(--accent)]/[0.08] border-[var(--accent)]/30 text-[var(--fg-primary)]"
        )}
      >
        <ListFilter size={15} className={allVisible ? "text-[var(--fg-muted)]" : "text-[var(--accent)]"} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{allVisible ? "All" : `${shown}/${total}`}</span>
        <ChevronDown size={14} className="text-[var(--fg-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-50 w-64 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-elevated)] animate-slide-down overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)]">
            <span className="text-label">Show villages</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVisibleSiteIds(null)}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] transition-colors"
              >
                All
              </button>
              <button
                onClick={() => setVisibleSiteIds([])}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] transition-colors"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-[52vh] overflow-y-auto py-1 scrollbar-none">
            {sites.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-[var(--fg-muted)]">No villages yet</div>
            ) : (
              sites.map((s) => {
                const on = isSiteVisible(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleVisibleSite(s.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <span
                      className={cn(
                        "shrink-0 h-4 w-4 rounded flex items-center justify-center border transition-colors",
                        on
                          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                          : "border-[var(--border-strong)] text-transparent"
                      )}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <MapPin size={13} className="shrink-0 text-[var(--fg-muted)]" />
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-[12.5px] font-medium text-[var(--fg-primary)] truncate">{s.name}</span>
                      {s.hostname && (
                        <span className="text-[10.5px] font-mono text-[var(--fg-muted)] truncate">{s.hostname}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
