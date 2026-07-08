// src/components/layout/SiteSwitcher.jsx
// Scope selector at the top of the sidebar. "All Villages" = global scope
// (dashboards aggregate, pages show all sites); a village rescopes everything.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Globe2, ChevronsUpDown, Check, Plus } from "lucide-react";
import { useSite } from "../../hooks/useSite";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

export default function SiteSwitcher({ collapsed }) {
  const { sites, activeSite, isGlobal, setActiveSiteId, loading } = useSite();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = loading ? "Loading…" : isGlobal ? "All Villages" : activeSite?.name || "Select village";

  const menu = (
    <div
      className={cn(
        "z-50 py-1.5 rounded-xl max-h-[62vh] overflow-y-auto scrollbar-none animate-slide-down",
        "bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-elevated)]",
        collapsed ? "absolute left-full top-0 ml-2 w-56" : "absolute left-2.5 right-2.5 mt-1.5"
      )}
    >
      {/* All Villages */}
      <MenuItem
        icon={<Globe2 size={15} />}
        title="All Villages"
        subtitle="Global overview"
        active={isGlobal}
        onClick={() => {
          setActiveSiteId("all");
          setOpen(false);
        }}
      />
      <div className="my-1 h-px bg-[var(--border-default)]" />
      {sites.length === 0 && (
        <div className="px-3 py-2 text-[12px] text-[var(--fg-muted)]">No villages yet</div>
      )}
      {sites.map((s) => (
        <MenuItem
          key={s.id}
          icon={<MapPin size={15} />}
          title={s.name}
          subtitle={s.hostname}
          mono
          active={!isGlobal && activeSite?.id === s.id}
          onClick={() => {
            setActiveSiteId(s.id);
            setOpen(false);
          }}
        />
      ))}
      <div className="my-1 h-px bg-[var(--border-default)]" />
      <button
        onClick={() => {
          setOpen(false);
          navigate("/network");
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] transition-colors"
      >
        <Plus size={13} /> Manage villages
      </button>
    </div>
  );

  if (collapsed) {
    return (
      <div className="px-2 pt-2.5 relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={label}
          className="h-10 w-10 mx-auto flex items-center justify-center rounded-lg bg-[var(--bg-surface)] text-[var(--accent)] border border-[var(--border-default)] hover:border-[var(--border-hover)] transition-colors"
        >
          {isGlobal ? <Globe2 size={16} /> : <MapPin size={16} />}
        </button>
        {open && menu}
      </div>
    );
  }

  return (
    <div className="px-2.5 pt-2.5 relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-2.5 h-12 rounded-xl text-left transition-colors bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-hover)]"
      >
        <span className="shrink-0 h-7 w-7 rounded-lg inline-flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)]">
          {isGlobal ? <Globe2 size={15} /> : <MapPin size={15} />}
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-label leading-none">Scope</span>
          <span className="text-[13px] font-semibold text-[var(--fg-primary)] truncate leading-tight mt-1">
            {label}
          </span>
        </span>
        <ChevronsUpDown size={14} className="text-[var(--fg-muted)] shrink-0" />
      </button>
      {open && menu}
    </div>
  );
}

function MenuItem({ icon, title, subtitle, active, mono, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
        active
          ? "bg-[var(--accent)]/[0.08] text-[var(--fg-primary)]"
          : "text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
      )}
    >
      <span className={active ? "text-[var(--accent)] shrink-0" : "text-[var(--fg-muted)] shrink-0"}>{icon}</span>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-[12.5px] font-medium truncate">{title}</span>
        {subtitle && (
          <span className={cn("text-[10.5px] truncate text-[var(--fg-muted)]", mono && "font-mono")}>
            {subtitle}
          </span>
        )}
      </span>
      {active && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}
