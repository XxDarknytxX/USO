// src/components/layout/Sidebar.jsx
// Left rail — Service Desk style. Sectioned nav, accent active-bar, site
// switcher, user footer. Collapsible (persisted).

import { NavLink } from "react-router-dom";
import { useState } from "react";
import {
  LayoutDashboard,
  Ticket,
  RefreshCw,
  History,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Users,
  Shield,
  Globe,
  FileText,
  GitBranch,
  Network,
  Gauge,
  Sun,
  Moon,
  Eye,
} from "lucide-react";

import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import SiteSwitcher from "./SiteSwitcher";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

const NAV_SECTIONS = [
  {
    title: "Monitoring",
    items: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
      { path: "/overview", label: "Overview", icon: Gauge },
      { path: "/network", label: "Network", icon: Network },
    ],
  },
  {
    title: "Vouchers",
    items: [
      { path: "/vouchers", label: "Vouchers", icon: Ticket },
      { path: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    title: "Operations",
    adminOnly: true,
    items: [
      { path: "/sync", label: "Sync", icon: RefreshCw },
      { path: "/portal-config", label: "Portal Plans", icon: Globe },
      { path: "/portal-audit", label: "Portal Logs", icon: FileText },
      { path: "/portal-flows", label: "Txn Flows", icon: GitBranch },
    ],
  },
  {
    title: "Admin",
    adminOnly: true,
    items: [
      { path: "/users", label: "Users", icon: Users },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const COLLAPSE_KEY = "vv:sidebarCollapsed";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const { email, role, isAdmin, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  return (
    <aside
      className={cn(
        collapsed ? "w-[72px]" : "w-[260px]",
        "flex flex-col shrink-0 h-screen sticky top-0 z-30 sidebar-bg",
        "border-r border-[var(--border-default)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex items-center h-16 px-4 border-b border-[var(--border-default)]",
          collapsed ? "justify-center" : "gap-3"
        )}
      >
        <span className="brand-mark">
          <Ticket size={16} strokeWidth={2} />
        </span>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold tracking-tight text-[var(--fg-primary)] truncate leading-tight">
              Voucher Manager
            </span>
            <span className="text-[11.5px] text-[var(--fg-secondary)] leading-tight">Vodafone Fiji</span>
          </div>
        )}
      </div>

      {/* Site switcher */}
      <SiteSwitcher collapsed={collapsed} />

      {/* Nav */}
      <nav className="flex-1 py-3 px-2.5 overflow-y-auto scrollbar-none">
        {sections.map((section, si) => (
          <div key={section.title} className={si > 0 ? "mt-5" : ""}>
            {!collapsed ? (
              <p className="text-label px-2.5 mb-1.5">{section.title}</p>
            ) : (
              si > 0 && <div className="mx-auto my-3 h-px w-6 bg-[var(--border-default)]" />
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ path, label, icon: Icon, end }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={end}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors duration-150",
                      collapsed ? "justify-center h-10 w-10 mx-auto" : "h-10 pr-3",
                      isActive
                        ? "bg-[var(--accent)]/[0.08] text-[var(--fg-primary)]"
                        : "text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[var(--accent)]" />
                      )}
                      <span className="w-10 flex items-center justify-center shrink-0">
                        <Icon
                          size={18}
                          strokeWidth={isActive ? 2.15 : 1.75}
                          className={isActive ? "text-[var(--accent)]" : ""}
                        />
                      </span>
                      {!collapsed && <span className="truncate">{label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border-default)] p-2.5 flex flex-col gap-1">
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="relative shrink-0 h-9 w-9 rounded-lg flex items-center justify-center text-[13px] font-semibold uppercase bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15">
              {(email || "?").charAt(0)}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[var(--bg-elevated)]" />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-[12.5px] text-[var(--fg-primary)] truncate font-medium leading-tight">
                {email}
              </span>
              <span className="flex items-center gap-1 text-[11.5px] text-[var(--fg-secondary)] capitalize leading-tight mt-0.5">
                {isAdmin ? <Shield size={10} /> : <Eye size={10} />}
                {role}
              </span>
            </div>
          </div>
        )}

        <SidebarAction collapsed={collapsed} onClick={toggle} icon={isDark ? Sun : Moon} label={isDark ? "Light mode" : "Dark mode"} />
        <SidebarAction collapsed={collapsed} onClick={toggleCollapse} icon={collapsed ? ChevronRight : ChevronLeft} label="Collapse" />
        <SidebarAction collapsed={collapsed} onClick={logout} icon={LogOut} label="Log out" tone="danger" />
      </div>
    </aside>
  );
}

function SidebarAction({ collapsed, onClick, icon: Icon, label, tone }) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--fg-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/[0.08]"
      : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-surface)]";

  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg text-[13px] font-medium transition-colors",
        collapsed ? "justify-center h-9 w-9 mx-auto" : "px-3 h-9",
        toneClass
      )}
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
