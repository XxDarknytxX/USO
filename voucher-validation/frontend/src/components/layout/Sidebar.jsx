// src/components/layout/Sidebar.jsx
// Collapsible left rail. Brand mark, primary nav, user identity, theme toggle, logout.

import { NavLink } from "react-router-dom";
import { useState } from "react";
import {
  BarChart3,
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
  Sun,
  Moon,
  Eye,
} from "lucide-react";

import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";

const allNavItems = [
  { path: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { path: "/vouchers", label: "Vouchers", icon: Ticket },
  { path: "/activity", label: "Activity", icon: History },
  { path: "/sync", label: "Sync", icon: RefreshCw, adminOnly: true },
  { path: "/users", label: "Users", icon: Users, adminOnly: true },
  { path: "/portal-config", label: "Portal Plans", icon: Globe, adminOnly: true },
  { path: "/portal-audit", label: "Portal Logs", icon: FileText, adminOnly: true },
  { path: "/portal-flows", label: "Txn Flows", icon: GitBranch, adminOnly: true },
  { path: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { email, role, isAdmin, logout } = useAuth();
  const { theme, toggle } = useTheme();

  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin);
  const isDark = theme === "dark";

  return (
    <aside
      className={
        (collapsed ? "w-[64px]" : "w-[220px]") +
        " flex flex-col shrink-0 h-screen sticky top-0 " +
        "bg-[var(--surface-sunken)] border-r border-[var(--border-subtle)] " +
        "transition-[width] duration-200"
      }
    >
      {/* ----- Brand row ----- */}
      <div
        className={
          "flex items-center h-14 px-3 border-b border-[var(--border-subtle)] " +
          (collapsed ? "justify-center" : "justify-between gap-2")
        }
      >
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="brand-mark">
              <Ticket size={15} strokeWidth={2} />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)] truncate">
                Voucher Mgr
              </span>
              <span className="text-[9.5px] font-mono uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
                Vodafone Fiji
              </span>
            </div>
          </div>
        )}
        {collapsed && (
          <span className="brand-mark">
            <Ticket size={15} strokeWidth={2} />
          </span>
        )}
      </div>

      {/* ----- Nav ----- */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {!collapsed && (
          <p className="px-2 mb-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-quaternary)]">
            Navigate
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                "group flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors duration-150 " +
                (collapsed ? "justify-center h-9 w-9 mx-auto " : "px-2.5 h-8 ") +
                (isActive
                  ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={15}
                    strokeWidth={isActive ? 2.25 : 1.75}
                    className="shrink-0"
                  />
                  {!collapsed && <span className="truncate">{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ----- Footer: user + theme + logout ----- */}
      <div className="border-t border-[var(--border-subtle)] p-2 flex flex-col gap-1">
        {!collapsed && (
          <div className="flex items-center gap-2 px-2 py-2">
            <span
              className={
                "shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-[11px] font-semibold uppercase " +
                "bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              }
            >
              {(email || "?").charAt(0)}
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] text-[var(--text-primary)] truncate font-medium">
                {email}
              </span>
              <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-quaternary)]">
                {isAdmin ? <Shield size={9} /> : <Eye size={9} />}
                {role}
              </span>
            </div>
          </div>
        )}

        {/* Theme toggle */}
        <SidebarAction
          collapsed={collapsed}
          onClick={toggle}
          icon={isDark ? Sun : Moon}
          label={isDark ? "Light mode" : "Dark mode"}
        />

        {/* Collapse */}
        <SidebarAction
          collapsed={collapsed}
          onClick={() => setCollapsed(!collapsed)}
          icon={collapsed ? ChevronRight : ChevronLeft}
          label="Collapse"
        />

        {/* Logout */}
        <SidebarAction
          collapsed={collapsed}
          onClick={logout}
          icon={LogOut}
          label="Log out"
          tone="danger"
        />
      </div>
    </aside>
  );
}

function SidebarAction({ collapsed, onClick, icon: Icon, label, tone }) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--text-tertiary)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)]"
      : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]";

  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={
        "flex items-center gap-2.5 rounded-md text-[12.5px] font-medium transition-colors " +
        (collapsed ? "justify-center h-8 w-8 mx-auto " : "px-2.5 h-8 ") +
        toneClass
      }
    >
      <Icon size={14} strokeWidth={1.75} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
