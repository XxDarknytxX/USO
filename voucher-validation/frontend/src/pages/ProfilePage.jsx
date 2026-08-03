// src/pages/ProfilePage.jsx
// Account + appearance. Mirrors the Service Desk profile: identity header and a
// Dark/Light "Appearance" theme selector (the theme switch lives here, not in
// the header chrome). Reachable by every signed-in user (incl. viewers).

import { useNavigate } from "react-router-dom";
import { UserCircle, Shield, Eye, Moon, Sun, Check, LogOut } from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { PageHeader, Panel, Button } from "../components/ui";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

/* One theme option — a mini-UI preview card that lights up when selected. */
function ThemeCard({ mode, active, onClick }) {
  const isDark = mode === "dark";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative group text-left rounded-xl overflow-hidden border-2 p-1 transition-all duration-300",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        active
          ? "border-[var(--accent)] shadow-[0_0_20px_rgba(230,0,0,0.12)]"
          : "border-[var(--border-default)] hover:border-[var(--border-hover)]"
      )}
    >
      {/* Mini dashboard preview */}
      <div className={cn("rounded-lg overflow-hidden p-3", isDark ? "bg-[#0a0a0c]" : "bg-[#F5F6F8]")}>
        <div className="flex gap-2 h-24">
          {/* mini sidebar */}
          <div
            className={cn(
              "w-10 rounded-md p-1.5 flex flex-col gap-1.5 border",
              isDark ? "bg-[#111113] border-white/[0.06]" : "bg-white border-black/[0.08]"
            )}
          >
            <div className={cn("w-full h-1.5 rounded-full", isDark ? "bg-[#E60000]/40" : "bg-[#E60000]/30")} />
            <div className={cn("w-full h-1.5 rounded-full", isDark ? "bg-white/10" : "bg-black/10")} />
            <div className={cn("w-full h-1.5 rounded-full", isDark ? "bg-white/10" : "bg-black/10")} />
            <div className={cn("w-full h-1.5 rounded-full", isDark ? "bg-white/[0.06]" : "bg-black/[0.06]")} />
          </div>
          {/* mini content */}
          <div className="flex-1 flex flex-col gap-1.5">
            <div className={cn("h-4 rounded-md border", isDark ? "bg-white/[0.04] border-white/[0.06]" : "bg-white border-black/[0.06]")} />
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              <div className={cn("rounded-md border", isDark ? "bg-white/[0.04] border-white/[0.06]" : "bg-white border-black/[0.06]")} />
              <div className={cn("rounded-md border", isDark ? "bg-white/[0.04] border-white/[0.06]" : "bg-white border-black/[0.06]")} />
              <div className={cn("rounded-md border col-span-2", isDark ? "bg-white/[0.04] border-white/[0.06]" : "bg-white border-black/[0.06]")} />
            </div>
          </div>
        </div>
      </div>

      {/* Label + selected check */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          {isDark ? (
            <Moon size={16} className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"} />
          ) : (
            <Sun size={16} className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"} />
          )}
          <span className={cn("text-sm font-medium", active ? "text-[var(--fg-primary)]" : "text-[var(--fg-secondary)]")}>
            {isDark ? "Dark" : "Light"}
          </span>
        </div>
        {active && (
          <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center animate-scale-in">
            <Check size={12} className="text-white" />
          </div>
        )}
      </div>
    </button>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { email, role, isAdmin, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const displayName = email || "User";
  const initial = displayName[0].toUpperCase();
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        subtitle="Your account details and appearance preferences."
        icon={<UserCircle size={20} />}
      />

      <div className="mt-6 max-w-3xl space-y-5">
        {/* Identity */}
        <Panel title="Account" icon={<UserCircle size={15} />} padding={false}>
          <div className="flex items-center gap-4 px-5 py-5">
            <div className="relative h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15 text-xl font-semibold">
              {initial}
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-[var(--bg-elevated)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-[var(--fg-primary)] truncate leading-snug">{displayName}</p>
              <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
                {isAdmin ? <Shield size={11} /> : <Eye size={11} />} {roleLabel}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout();
                navigate("/login");
              }}
              iconLeft={<LogOut size={14} />}
            >
              Sign out
            </Button>
          </div>
        </Panel>

        {/* Appearance — the theme switch */}
        <Panel title="Appearance" subtitle="Choose how the dashboard looks." icon={<Sun size={15} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ThemeCard mode="dark" active={theme === "dark"} onClick={() => setTheme("dark")} />
            <ThemeCard mode="light" active={theme === "light"} onClick={() => setTheme("light")} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
