// src/components/layout/AppLayout.jsx
// Service Desk shell, faithfully ported: unified sidebar + header chrome sharing
// one elevated surface, a full-width flowing red accent line at y=64, a floating
// edge collapse toggle, VodafoneLogo, ambient FloatingBlobs, sectioned nav with
// accent active-bar, and a header user menu. Wired to the admin's auth / theme /
// site-scope + the site switcher.

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { Toaster } from "react-hot-toast";
import {
  LayoutDashboard, Gauge, Network, Ticket, History, RefreshCw, Globe,
  FileText, GitBranch, Users, Settings, Menu, X, ChevronLeft, ChevronRight,
  ChevronDown, LogOut, Shield, Eye, LifeBuoy, UserCircle,
} from "lucide-react";

import { useAuth } from "../../hooks/useAuth";
import { SiteProvider, useSite } from "../../hooks/useSite";
import VodafoneLogo from "../ui/VodafoneLogo";
import FloatingBlobs from "../ui/FloatingBlobs";
import SiteSwitcher from "./SiteSwitcher";

const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 72;

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

const navSections = [
  {
    title: "Monitoring",
    items: [
      // viewerOk: the read-only viewer role sees ONLY the Dashboard tab.
      { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard, end: true, viewerOk: true },
      { to: "/overview", label: "Overview", Icon: Gauge },
      { to: "/network", label: "Network", Icon: Network },
    ],
  },
  {
    title: "Vouchers",
    items: [
      { to: "/vouchers", label: "Vouchers", Icon: Ticket },
      { to: "/activity", label: "Activity", Icon: History },
    ],
  },
  {
    title: "Operations",
    adminOnly: true,
    items: [
      { to: "/sync", label: "Sync", Icon: RefreshCw },
      { to: "/portal-config", label: "Portal Plans", Icon: Globe },
      { to: "/portal-audit", label: "Portal Logs", Icon: FileText },
      { to: "/portal-flows", label: "Txn Flows", Icon: GitBranch },
      { to: "/manual-assistance", label: "Manual Assistance", Icon: LifeBuoy },
    ],
  },
  {
    title: "Admin",
    adminOnly: true,
    items: [
      { to: "/users", label: "Users", Icon: Users },
      { to: "/settings", label: "Settings", Icon: Settings },
    ],
  },
];

export default function AppLayout() {
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { email, role, isAdmin, isViewer, logout } = useAuth();
  const { loading: siteLoading } = useSite();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("vv:sidebarCollapsed") === "1");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  const expanded = !collapsed || mobileOpen;
  const sidebarWidth = mobileOpen ? SIDEBAR_EXPANDED : collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const displayName = email || "User";
  const initial = displayName[0].toUpperCase();
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";

  // Section-level admin gate, then a per-item viewer gate: a viewer keeps only
  // items marked viewerOk (just Dashboard), and empty sections are dropped.
  const sections = navSections
    .filter((s) => !s.adminOnly || isAdmin)
    .map((s) => ({ ...s, items: s.items.filter((it) => !isViewer || it.viewerOk) }))
    .filter((s) => s.items.length > 0);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem("vv:sidebarCollapsed", prev ? "0" : "1");
      return !prev;
    });
  }

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    function onDoc(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
    }
    if (showUserMenu) {
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }
  }, [showUserMenu]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const labelCls = (extra) =>
    cn(
      "transition-[opacity,transform] duration-200 ease-out whitespace-nowrap",
      expanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none",
      extra
    );

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--fg-primary)]">
      <FloatingBlobs variant="minimal" />

      {/* Full-width flowing accent line at y=64, across sidebar + header */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-16 h-[2px] z-30 lg:z-[55] animate-header-wave"
        style={{
          background:
            "linear-gradient(90deg, rgba(230,0,0,0.04) 0%, rgba(230,0,0,0.55) 22%, #E60000 50%, rgba(230,0,0,0.55) 78%, rgba(230,0,0,0.04) 100%)",
          backgroundSize: "200% 100%",
        }}
      />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ===== SIDEBAR ===== */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col",
          "bg-[var(--bg-elevated)] border-r border-[var(--border-default)]",
          "transition-[width,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "lg:relative lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: sidebarWidth }}
      >
        {/* Accent glow line at top */}
        <div className="absolute top-0 left-[20%] right-[20%] h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-30 pointer-events-none" />

        {/* Floating collapse toggle (desktop) */}
        <button
          onClick={toggleCollapsed}
          className={cn(
            "hidden lg:flex absolute -right-3 top-[20px] z-10 h-6 w-6 items-center justify-center rounded-full",
            "bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-[var(--fg-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.25)]",
            "hover:text-[var(--accent)] hover:border-[var(--accent)]/50 hover:scale-110 active:scale-95 transition-all duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>

        {/* Logo row */}
        <div className="h-16 flex items-center gap-3 px-[18px] border-b border-[var(--border-default)] shrink-0 overflow-hidden">
          <VodafoneLogo size={34} className="shrink-0 drop-shadow-[0_0_14px_rgba(230,0,0,0.4)]" />
          <div className={labelCls("min-w-0 flex-1")} aria-hidden={!expanded}>
            <h1 className="text-sm font-semibold text-[var(--fg-primary)] tracking-tight leading-tight truncate">Voucher Manager</h1>
            <p className="text-[10px] text-[var(--fg-muted)] truncate">Vodafone Fiji · USO</p>
          </div>
          {mobileOpen && (
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-2 rounded-lg shrink-0 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-surface)] transition-colors"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Scope switcher */}
        <div className="shrink-0">
          <SiteSwitcher collapsed={!expanded} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 overflow-y-auto overflow-x-hidden scrollbar-none">
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.title}>
                <div className="relative h-6 mb-1 flex items-center overflow-visible">
                  <p className={cn("px-1 text-label whitespace-nowrap transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")} aria-hidden={!expanded}>
                    {section.title}
                  </p>
                  <div className={cn("absolute left-1/2 -translate-x-1/2 w-5 h-px bg-[var(--border-strong)] transition-opacity duration-200", expanded ? "opacity-0" : "opacity-100")} />
                </div>
                <div className="space-y-0.5">
                  {section.items.map(({ to, label, Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      title={!expanded ? label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center h-10 rounded-lg overflow-hidden transition-colors duration-150",
                          isActive
                            ? "bg-[var(--accent)]/[0.08] text-[var(--fg-primary)]"
                            : "text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={cn(
                              "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-[var(--accent)] transition-all duration-200",
                              isActive ? "h-5 opacity-100" : "h-0 opacity-0"
                            )}
                          />
                          <span className={cn("w-10 shrink-0 flex items-center justify-center transition-colors duration-150", isActive ? "text-[var(--accent)]" : "text-[var(--fg-muted)] group-hover:text-[var(--fg-secondary)]")}>
                            <Icon size={18} />
                          </span>
                          <span className={labelCls("text-sm font-medium")} aria-hidden={!expanded}>{label}</span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer — user identity → Profile */}
        <div className="border-t border-[var(--border-default)] shrink-0 px-4 py-4">
          <button
            onClick={() => navigate("/profile")}
            title={!expanded ? `${displayName} — view profile` : "View profile"}
            className={cn(
              "w-full flex items-center h-12 rounded-xl text-left transition-colors duration-150",
              expanded && "overflow-hidden",
              "hover:bg-[var(--bg-surface)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            )}
          >
            <div className="w-10 shrink-0 flex items-center justify-center">
              <div className="relative h-10 w-10 rounded-xl flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15 text-sm font-semibold">
                {initial}
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[var(--bg-elevated)]" />
              </div>
            </div>
            {expanded && (
              <>
                <div className="min-w-0 flex-1 ml-3">
                  <p className="text-sm font-semibold text-[var(--fg-primary)] truncate leading-snug">{displayName}</p>
                  <p className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)] truncate mt-0.5">
                    {isAdmin ? <Shield size={10} /> : <Eye size={10} />} {roleLabel}
                  </p>
                </div>
                <span className="shrink-0 pr-1 text-[var(--fg-muted)]">
                  <ChevronRight size={14} />
                </span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ===== MAIN ===== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header — same surface + border as the sidebar (one continuous chrome) */}
        <header className="h-16 flex-shrink-0 z-20 bg-[var(--bg-elevated)] border-b border-[var(--border-default)]">
          <div className="h-full flex items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2.5 rounded-lg text-[var(--fg-muted)] border border-[var(--border-default)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-hover)] transition-all duration-150"
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
              <span className="hidden sm:block text-sm font-medium text-[var(--fg-muted)]">
                Vodafone Fiji · USO Operations
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* User menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu((v) => !v)}
                  className="flex items-center gap-2.5 p-1.5 pr-3 rounded-lg border border-[var(--border-default)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-hover)] transition-all duration-150"
                  aria-expanded={showUserMenu}
                >
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] text-sm font-semibold">
                    {initial}
                  </div>
                  <span className="hidden md:block text-sm font-medium text-[var(--fg-primary)] truncate max-w-[140px]">
                    {displayName}
                  </span>
                  <ChevronDown size={14} className="text-[var(--fg-muted)] hidden md:block" />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-[18px] w-56 bg-[var(--bg-elevated)] rounded-xl overflow-hidden border border-[var(--border-default)] shadow-[var(--shadow-elevated)] animate-slide-down">
                    <div className="px-4 py-3 border-b border-[var(--border-default)]">
                      <p className="text-sm font-semibold text-[var(--fg-primary)] truncate">{displayName}</p>
                      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
                        {isAdmin ? <Shield size={10} /> : <Eye size={10} />} {roleLabel}
                      </span>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => { setShowUserMenu(false); navigate("/profile"); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] transition-colors duration-150"
                      >
                        <UserCircle size={16} /> Profile
                      </button>
                      <div className="mx-3 my-1 h-px bg-[var(--border-default)]" />
                      <button
                        onClick={() => { logout(); navigate("/login"); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors duration-150"
                      >
                        <LogOut size={16} /> Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content — pages own their padding (.page-shell / p-4…).
            Hold rendering until the site scope has loaded so scope-aware pages
            mount with the correct activeGroupId from their first fetch. Otherwise,
            on a hard reload they fire an UNSCOPED request while `sites` is still
            loading, and that "all villages" response can land after the scoped one
            and clobber it — the page then shows data across every scope. This gate
            fires only during the one-time context load after a full reload. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {siteLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--fg-muted)]">
              <div
                className="w-9 h-9 rounded-full border-[3px] animate-spin"
                style={{ borderColor: "var(--bg-surface)", borderTopColor: "var(--accent)" }}
              />
              <p className="text-[13px] font-medium">Loading villages…</p>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: "var(--bg-elevated)",
            color: "var(--fg-primary)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-elevated)",
            borderRadius: "12px",
            fontSize: "13px",
            padding: "10px 14px",
            fontFamily: "var(--font-sans)",
          },
          success: { iconTheme: { primary: "var(--success)", secondary: "var(--bg-elevated)" } },
          error: { iconTheme: { primary: "var(--accent)", secondary: "var(--bg-elevated)" } },
        }}
      />
    </div>
  );
}
