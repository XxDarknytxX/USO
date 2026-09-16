// src/components/layout/SiteSwitcher.jsx
//
// Scope selector — the control that decides whether the whole console is showing
// the estate or one village. It sits in the sidebar because it governs every
// page, not the page you happen to be on.
//
// Rebuilt after Salesforce's object switcher. The old one listed thirty-one
// identical rows with no way to search and no indication of which villages were
// in trouble, so picking a site meant scrolling and reading hostnames. Now:
//   • the trigger states the scope AND what it covers ("31 villages"), so the
//     current state is legible without opening anything
//   • the panel opens with a search box, because thirty-one is past the point
//     where scanning beats typing
//   • every village carries a health dot from the network overview, so the
//     switcher doubles as the fastest route to the site that needs attention
//   • the panel is a floating card with its own scroll, not an inline list that
//     pushes the navigation down the page

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { MapPin, Globe2, ChevronsUpDown, Check, Search, Settings2, X } from "lucide-react";
import { useSite } from "../../hooks/useSite";
import { networkApi } from "../../services/api";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

export default function SiteSwitcher({ collapsed }) {
  const { sites, activeSite, isGlobal, setActiveSiteId, loading, isSiteVisible, activeSiteId } = useSite();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [health, setHealth] = useState(null); // projectId -> online|offline|unknown
  const ref = useRef(null);
  const searchRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
      // Thirty-one villages: typing should be the default way in.
      setTimeout(() => searchRef.current?.focus(), 40);
      return () => {
        document.removeEventListener("mousedown", onDoc);
        document.removeEventListener("keydown", onKey);
      };
    }
    setQ("");
  }, [open]);

  // Health dots, fetched once when the panel is first opened. Cheap (it reads
  // stored snapshots, no Ruijie calls) and it turns the switcher into the
  // quickest way to reach a village that is down.
  useEffect(() => {
    if (!open || health) return;
    let cancelled = false;
    networkApi
      .overview()
      .then((d) => {
        if (cancelled) return;
        const map = {};
        for (const s of d?.sites || []) map[s.id] = s.online === true ? "online" : s.online === false ? "offline" : "unknown";
        setHealth(map);
      })
      .catch(() => setHealth({}));
    return () => { cancelled = true; };
  }, [open, health]);

  const label = loading ? "Loading…" : isGlobal ? "All villages" : activeSite?.name || "Select village";

  // Villages hidden by the All-Villages scope stay hidden, except the current
  // one — you must never be able to select yourself into a dead end.
  const shownSites = useMemo(
    () => sites.filter((s) => isSiteVisible(s.id) || s.id === activeSiteId),
    [sites, isSiteVisible, activeSiteId]
  );
  const hiddenCount = sites.length - shownSites.length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return shownSites;
    return shownSites.filter(
      (s) => s.name.toLowerCase().includes(needle) || String(s.hostname || "").toLowerCase().includes(needle)
    );
  }, [shownSites, q]);

  const downCount = useMemo(
    () => (health ? shownSites.filter((s) => health[s.id] === "offline").length : 0),
    [health, shownSites]
  );

  function choose(id) {
    setActiveSiteId(id);
    setOpen(false);
  }

  const panel = (
    <div
      className={cn(
        "z-50 rounded-2xl overflow-hidden animate-slide-down",
        "bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-elevated)]",
        collapsed ? "absolute left-full top-0 ml-2 w-[300px]" : "absolute left-2.5 right-2.5 mt-2"
      )}
      role="dialog"
      aria-label="Choose scope"
    >
      {/* Search */}
      <div className="p-2.5 border-b border-[var(--border-subtle)]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search villages…"
            className="h-9 w-full pl-9 pr-8 text-[13px] rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus-input"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              aria-label="Clear"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[46vh] overflow-y-auto py-1.5">
        {!q && (
          <Row
            tone="brand"
            icon={<Globe2 size={15} />}
            title="All villages"
            subtitle={`${shownSites.length} in scope${downCount ? ` · ${downCount} down` : ""}`}
            active={isGlobal}
            onClick={() => choose("all")}
          />
        )}
        {!q && <div className="my-1.5 mx-3 h-px bg-[var(--border-subtle)]" />}

        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--fg-muted)]">
            {sites.length === 0 ? "No villages yet" : `No village matches “${q}”`}
          </p>
        )}

        {filtered.map((s) => (
          <Row
            key={s.id}
            tone="navy"
            icon={<MapPin size={15} />}
            title={s.name}
            subtitle={s.hostname}
            mono
            status={health?.[s.id]}
            active={!isGlobal && activeSite?.id === s.id}
            onClick={() => choose(s.id)}
          />
        ))}
      </div>

      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 flex items-center justify-between gap-2">
        {hiddenCount > 0 ? (
          <span className="text-[11px] text-[var(--fg-muted)]">{hiddenCount} hidden by scope</span>
        ) : (
          <span className="text-[11px] text-[var(--fg-muted)]">{sites.length} villages</span>
        )}
        {/* Settings is admin-only, so for anyone else this button is a link
            that bounces them straight back to the dashboard — offered, most
            likely, at the exact moment they are trying to work out why their
            village list looks short. */}
        {isAdmin && (
          <button
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--fg-secondary)] hover:text-[var(--brand)] transition-colors font-display"
          >
            <Settings2 size={12} /> Manage scope
          </button>
        )}
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <div className="px-2 pt-3 relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={label}
          aria-label={`Scope: ${label}`}
          className={cn(
            "h-10 w-10 mx-auto flex items-center justify-center rounded-[12px] transition-colors",
            isGlobal
              ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
              : "bg-[var(--tile-navy-soft)] text-[var(--tile-navy)]"
          )}
        >
          {isGlobal ? <Globe2 size={17} /> : <MapPin size={17} />}
        </button>
        {open && panel}
      </div>
    );
  }

  return (
    <div className="px-3 pt-3 relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 h-[52px] rounded-[14px] text-left transition-all duration-150",
          "bg-[var(--bg-surface)] border border-[var(--border-default)]",
          "hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface-hover)]",
          open && "border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-soft)]"
        )}
      >
        <span
          className={cn(
            "shrink-0 h-8 w-8 rounded-[10px] inline-flex items-center justify-center",
            isGlobal ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]" : "bg-[var(--tile-navy-soft)] text-[var(--tile-navy)]"
          )}
        >
          {isGlobal ? <Globe2 size={16} /> : <MapPin size={16} />}
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--fg-muted)] leading-none font-display">
            Scope
          </span>
          <span className="text-[13.5px] font-bold text-[var(--fg-primary)] truncate leading-tight mt-1 font-display">
            {label}
          </span>
        </span>
        <ChevronsUpDown size={14} className="text-[var(--fg-muted)] shrink-0" />
      </button>
      {open && panel}
    </div>
  );
}

function Row({ icon, title, subtitle, active, mono, status, tone = "navy", onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
        active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--bg-surface)]"
      )}
    >
      <span
        className={cn(
          "shrink-0 h-7 w-7 rounded-[9px] inline-flex items-center justify-center",
          tone === "brand" ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]" : "bg-[var(--tile-navy-soft)] text-[var(--tile-navy)]"
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col min-w-0 flex-1">
        <span
          className={cn(
            "text-[12.5px] truncate font-display",
            active ? "font-bold text-[var(--brand-fg-on-soft)]" : "font-semibold text-[var(--fg-primary)]"
          )}
        >
          {title}
        </span>
        {subtitle && (
          <span className={cn("text-[10.5px] truncate text-[var(--fg-muted)]", mono && "font-mono")}>{subtitle}</span>
        )}
      </span>
      {status && status !== "unknown" && (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          title={status === "online" ? "Online" : "Offline"}
          style={{ background: status === "online" ? "var(--success-fg)" : "var(--danger-fg)" }}
        />
      )}
      {active && <Check size={14} className="shrink-0 text-[var(--brand)]" />}
    </button>
  );
}
