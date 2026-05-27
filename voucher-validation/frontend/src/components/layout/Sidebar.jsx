// src/components/layout/Sidebar.jsx
import { NavLink } from "react-router-dom";
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
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";

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

  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={`${
        collapsed ? "w-[68px]" : "w-60"
      } flex flex-col bg-white border-r border-gray-100 transition-all duration-300 h-screen sticky top-0`}
    >
      {/* Logo / Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-100">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md shadow-purple-200">
              <Ticket className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-800 tracking-tight">
              Voucher Mgr
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              }`
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User info + Logout */}
      <div className="p-3 border-t border-gray-100 space-y-2">
        {/* User info */}
        {!collapsed && (
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-gray-700 truncate">{email}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Shield size={11} className={isAdmin ? "text-purple-500" : "text-gray-400"} />
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  isAdmin ? "text-purple-500" : "text-gray-400"
                }`}
              >
                {role}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
