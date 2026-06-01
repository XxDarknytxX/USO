// src/components/layout/SiteSwitcher.jsx
// Village/site selector at the top of the sidebar. Switching scopes all the
// management pages (vouchers, network, …) to that site.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, ChevronsUpDown, Check, Plus } from "lucide-react";
import { useSite } from "../../hooks/useSite";

export default function SiteSwitcher({ collapsed }) {
  const { sites, activeSite, setActiveSiteId, loading } = useSite();
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

  if (collapsed) {
    return (
      <div className="px-2 pt-2">
        <button
          onClick={() => navigate("/network")}
          title={activeSite?.name || "Sites"}
          className="h-9 w-9 mx-auto flex items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--brand-fg-on-soft)] border border-[var(--border-subtle)]"
        >
          <MapPin size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2.5 pt-2.5 relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          "w-full flex items-center gap-2.5 px-2.5 h-11 rounded-lg text-left transition-colors " +
          "bg-[var(--surface-raised)] border border-[var(--border-default)] hover:border-[var(--border-strong)]"
        }
      >
        <span className="shrink-0 h-7 w-7 rounded-md inline-flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
          <MapPin size={14} />
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-[var(--text-quaternary)] leading-none">
            Site
          </span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate leading-tight mt-0.5">
            {loading ? "Loading…" : activeSite?.name || "No site"}
          </span>
        </span>
        <ChevronsUpDown size={14} className="text-[var(--text-quaternary)] shrink-0" />
      </button>

      {open && (
        <div
          className={
            "absolute left-2.5 right-2.5 mt-1 z-50 py-1 rounded-lg max-h-[60vh] overflow-y-auto " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] shadow-[var(--elev-3)]"
          }
        >
          {sites.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">No sites yet</div>
          )}
          {sites.map((s) => {
            const active = activeSite?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSiteId(s.id);
                  setOpen(false);
                }}
                className={
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors " +
                  (active
                    ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]")
                }
              >
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-[12.5px] font-medium truncate">{s.name}</span>
                  {s.hostname && (
                    <span className="text-[10.5px] font-mono text-[var(--text-quaternary)] truncate">
                      {s.hostname}
                    </span>
                  )}
                </span>
                {active && <Check size={13} className="shrink-0" />}
              </button>
            );
          })}
          <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/network");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plus size={13} /> Manage sites
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
