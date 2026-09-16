// src/pages/ProfilePage.jsx
// Account + appearance. Reachable by every signed-in user (incl. viewers and
// field engineers), so it is the one page that must make sense with no
// permissions at all.
//
// Laid out as a Lightning record home: the person IS the page header — their
// initial is the object tile, their name the title — rather than an identity
// card stacked under a header that only said "Profile". What is left is two
// short panels side by side, which is what stops a three-fact page reading as
// an afterthought.

import { useNavigate, useSearchParams } from "react-router-dom";
import { UserCircle, Shield, Eye, Moon, Sun, Check, LogOut, Wrench, Mail, IdCard } from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { PageShell, PageHeader, Panel, Button, StatusPill, ObjectTile } from "../components/ui";
import AccountSecurity from "../components/AccountSecurity";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

/* One theme option — a mini-UI preview card that lights up when selected. The
   preview is worth the markup: "Dark" and "Light" as radio labels tell you the
   name of the choice, not what it does to the console you are looking at. */
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
          <span className={cn("text-[13.5px] font-semibold font-display", active ? "text-[var(--fg-primary)]" : "text-[var(--fg-secondary)]")}>
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

/** One fact about the account: what it is, and what it says. */
function DetailRow({ icon, tone = "slate", label, children }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <ObjectTile tone={tone} size="sm">{icon}</ObjectTile>
      <div className="min-w-0 flex-1">
        <p className="text-label">{label}</p>
        <div className="mt-1 min-w-0 text-[13px] text-[var(--fg-primary)]">{children}</div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  // An account on a temporary password is sent here with ?changePassword=1.
  // The flag is dropped from the URL the moment the change lands, so a reload
  // does not reopen a dialog for something already done.
  const [params, setParams] = useSearchParams();
  const forcePasswordChange = params.get("changePassword") === "1";
  const { email, name, role, isAdmin, isEngineer, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const displayName = name?.trim() || (email ? email.split("@")[0] : "User");
  const initial = displayName[0].toUpperCase();
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";
  const RoleIcon = isAdmin ? Shield : isEngineer ? Wrench : Eye;
  const roleBlurb = isAdmin
    ? "Full administrative access to every village, setting and account."
    : isEngineer
      ? "Files maintenance reports for any village; nothing else in the console."
      : "Read-only access to the villages an administrator has assigned to you.";

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Your account"
        title={displayName}
        subtitle={email || "Signed in to the USO operations console."}
        icon={<span className="text-[18px] font-bold font-display leading-none">{initial}</span>}
        tone="pink"
        actions={
          <>
            <StatusPill tone="success">Signed in</StatusPill>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logout();
                navigate("/login");
              }}
              iconLeft={<LogOut size={14} />}
            >
              Sign out
            </Button>
          </>
        }
      />

      {/* Two short panels rather than a stack: neither has enough in it to earn
          a full-width row of its own. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel title="Account" subtitle="What the console knows about you." icon={<UserCircle size={15} />} tone="pink" padding={false}>
          <div className="divide-y divide-[var(--border-subtle)]">
            <DetailRow icon={<IdCard size={13} />} tone="pink" label="Name">
              <span className="block truncate">{displayName}</span>
            </DetailRow>
            <DetailRow icon={<Mail size={13} />} tone="blue" label="Email">
              <span className="block truncate">{email || "—"}</span>
            </DetailRow>
            <DetailRow icon={<RoleIcon size={13} />} tone={isAdmin ? "violet" : isEngineer ? "orange" : "teal"} label="Role">
              <span className="flex flex-col gap-1.5">
                <StatusPill tone={isAdmin ? "brand" : isEngineer ? "warning" : "info"} dot={false} className="self-start">
                  <RoleIcon size={11} />
                  {roleLabel}
                </StatusPill>
                <span className="text-[12px] text-[var(--fg-muted)] whitespace-normal leading-relaxed">
                  {roleBlurb}
                </span>
              </span>
            </DetailRow>
          </div>
        </Panel>

        {/* Appearance — the theme switch lives here, not in the header chrome. */}
        <Panel title="Appearance" subtitle="Choose how the console looks on this device." icon={<Sun size={15} />} tone="orange">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ThemeCard mode="dark" active={theme === "dark"} onClick={() => setTheme("dark")} />
            <ThemeCard mode="light" active={theme === "light"} onClick={() => setTheme("light")} />
          </div>
        </Panel>

        {/* Security spans both columns: it is the only part of this page with
            consequences, and a half-width panel would read as an aside. */}
        <div className="lg:col-span-2">
          <AccountSecurity
            forcePasswordChange={forcePasswordChange}
            onPasswordChanged={() => setParams({}, { replace: true })}
          />
        </div>
      </div>
    </PageShell>
  );
}
