// src/pages/Login.jsx
//
// Sign-in: a branded panel that says what this system is, beside a form panel
// that does one job.
//
// The form is a single bordered block with the two rows joined by a hairline,
// each row carrying its own icon rail and a label that sits inside the row
// rather than floating above it. Two free-standing boxes with labels stacked
// over them is what every admin tool ships; joining them makes the credential
// pair read as one instrument, and gives the focused row somewhere to light up.
//
// The two-factor steps are dialogs over this screen, not replacements for it.
// An attempt that is halfway done should still look halfway done — and the
// tokens those steps hold are short-lived, so they stay in this component's
// state and are never written anywhere that outlives the attempt.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck, Wifi, Ticket, Wrench, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../services/api";
import { homePathFor, clearSiteCache } from "../hooks/useAuth";
import { Button } from "../components/ui";
import VodafoneLogo from "../components/ui/VodafoneLogo";
import { TwoFactorEnrolModal } from "../components/TwoFactorEnrol";
import TwoFactorVerifyModal from "../components/TwoFactorVerifyModal";

const HIGHLIGHTS = [
  { Icon: Wifi, title: "Village connectivity", copy: "Live health for every USO site, in one place." },
  { Icon: Ticket, title: "Vouchers & revenue", copy: "Sales, stock and usage across the estate." },
  { Icon: Wrench, title: "Field maintenance", copy: "Six-monthly inspections, with photographic evidence." },
];

/* ─────────────────────────────────────────────────────────────────────────────
   One row of the joined credential block.
   The label lives inside the row, above the value, so the row is a single
   target and the focused state has a whole surface to tint rather than a
   1px border to thicken.
   ───────────────────────────────────────────────────────────────────────── */
function CredentialRow({ icon: Icon, label, trailing, children, focused }) {
  return (
    <div
      className={
        "relative flex items-stretch transition-colors duration-150 " +
        (focused ? "bg-[var(--brand-soft)]" : "bg-transparent")
      }
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--brand)] origin-center transition-transform duration-150"
        style={{ transform: focused ? "scaleY(1)" : "scaleY(0)" }}
      />
      <span
        className={
          "w-[52px] shrink-0 flex items-center justify-center border-r transition-colors duration-150 " +
          (focused
            ? "border-[var(--brand-soft-hover)] text-[var(--brand)]"
            : "border-[var(--border-default)] text-[var(--fg-subtle)]")
        }
      >
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2.5">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--fg-muted)] leading-none mb-1.5">
          {label}
        </span>
        {children}
      </span>
      {trailing && <span className="flex items-center pr-3 pointer-coarse:pr-1.5">{trailing}</span>}
    </div>
  );
}

const inputClass =
  "w-full bg-transparent outline-none border-0 p-0 text-[14.5px] leading-[1.35] " +
  "text-[var(--fg-primary)] placeholder:text-[var(--fg-subtle)] font-sans";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "password" | "verify" | "enrol". The whole sign-in lives on this one screen
  // rather than across routes, because every intermediate state holds a token
  // that must not outlive the attempt — and a route can be navigated back to.
  const [stage, setStage] = useState("password");
  const [tempToken, setTempToken] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusField, setFocusField] = useState(null);
  const [capsLock, setCapsLock] = useState(false);
  const navigate = useNavigate();

  /**
   * Stores a finished session. Kept in one place because a token written
   * without its role leaves the SPA guessing what the account may see.
   */
  function completeLogin(token, mustChangePassword) {
    // A new session starts from its own preferences, not the last account's.
    clearSiteCache();
    localStorage.setItem("token", token);
    let role = null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      role = payload.role || null;
      if (role) localStorage.setItem("role", role);
    } catch {
      /* token will still be validated server-side */
    }
    // An unreadable role lands on "/", whose own redirect reads the token again.
    navigate(mustChangePassword ? "/profile?changePassword=1" : role ? homePathFor(role) : "/");
  }

  function onVerified(r) {
    if (r.usedBackupCode) {
      // Said now rather than discovered later: someone down to their last
      // codes should know while they are still able to generate more.
      toast(
        r.backupCodesRemaining === 0
          ? "That was your last backup code. Set up two-factor again to get a new set."
          : `Backup code used — ${r.backupCodesRemaining} left.`,
        { icon: "🔑", duration: 8000 }
      );
    }
    completeLogin(r.token, r.mustChangePassword);
  }

  function abandonChallenge() {
    setStage("password");
    setTempToken("");
    setSetupToken("");
    setPassword("");
    setErr("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await api("/login", { method: "POST", body: { email, password } });

      // Three outcomes, decided entirely by the server. The page never chooses
      // which one it is in — it only renders what it was told.
      if (r.requires2FA) {
        setTempToken(r.tempToken);
        setStage("verify");
        return;
      }
      if (r.requires2FASetup) {
        // A setup token. Held in state, NOT written as the session token:
        // storing it would let the rest of the app treat a half-finished login
        // as a real one.
        setSetupToken(r.token);
        setStage("enrol");
        return;
      }
      completeLogin(r.token, r.mustChangePassword);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    // dvh below lg: a phone's 100vh includes the browser bar, which would push
    // a centred form down and make an empty page scroll.
    <div className="min-h-screen max-lg:min-h-dvh grid lg:grid-cols-[1.05fr_1fr] bg-[var(--bg-base)] text-[var(--fg-primary)]">
      {/* ============================ Brand panel ============================ */}
      <aside className="relative overflow-hidden hidden lg:flex flex-col justify-between p-12 xl:p-16 text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(150deg, #7A0A0A 0%, #C20000 34%, #E60000 58%, #FF4D4D 100%)" }}
        />
        {/* Speechmark motif, blown up and cropped — brand as texture, not a logo
            pasted twice. */}
        <div
          aria-hidden
          className="absolute -right-24 -bottom-32 w-[560px] h-[560px] rounded-full opacity-[0.18]"
          style={{ background: "radial-gradient(circle at 30% 30%, #fff 0%, transparent 62%)" }}
        />
        <div
          aria-hidden
          className="absolute -left-40 top-[-15%] w-[520px] h-[520px] rounded-full opacity-[0.14] animate-float-slow"
          style={{ background: "radial-gradient(circle, #fff 0%, transparent 60%)" }}
        />

        <div className="relative flex items-center gap-3">
          <span className="h-11 w-11 rounded-[14px] bg-white/15 backdrop-blur-sm flex items-center justify-center">
            <VodafoneLogo size={26} />
          </span>
          <div className="leading-tight">
            <p className="font-display font-extrabold text-[15px] tracking-tight">Voucher Manager</p>
            <p className="text-[11.5px] text-white/70">Vodafone Fiji · USO</p>
          </div>
        </div>

        <div className="relative max-w-[440px]">
          <h2 className="font-display font-extrabold text-[40px] xl:text-[46px] leading-[1.08] tracking-[-0.03em]">
            Connectivity for every village.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            The operations console for the Universal Service Obligation programme — vouchers, network health and
            field maintenance across Fiji.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ Icon, title, copy }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="mt-0.5 h-9 w-9 shrink-0 rounded-[11px] bg-white/15 backdrop-blur-sm flex items-center justify-center">
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block font-display font-bold text-[13.5px]">{title}</span>
                  <span className="block text-[12.5px] text-white/70 leading-relaxed">{copy}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] text-white/60">
          © {new Date().getFullYear()} Vodafone Fiji · Universal Service Obligation
        </p>
      </aside>

      {/* ============================= Form panel ============================ */}
      {/* A phone puts the form near the top rather than centred, so the Sign
          in button stays above the on-screen keyboard. */}
      <main className="relative flex flex-col justify-center px-6 py-12 max-sm:justify-start max-sm:px-5 max-sm:pt-10 max-sm:pb-8 sm:px-10 lg:px-14 xl:px-20">
        {/* Faint engineering grid — the form sits on a surface rather than in a
            void, without competing with anything on it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(var(--border-default) 1px, transparent 1px), linear-gradient(90deg, var(--border-default) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
            maskImage: "radial-gradient(ellipse 78% 60% at 50% 46%, #000 18%, transparent 76%)",
            WebkitMaskImage: "radial-gradient(ellipse 78% 60% at 50% 46%, #000 18%, transparent 76%)",
          }}
        />

        <div className="relative w-full max-w-[404px] mx-auto">
          {/* Compact brand lockup for narrow screens, where the panel is hidden */}
          <div className="lg:hidden flex items-center gap-3 mb-10 max-sm:mb-8">
            <span className="h-11 w-11 rounded-[14px] bg-[var(--brand-soft)] flex items-center justify-center">
              <VodafoneLogo size={26} />
            </span>
            <div className="leading-tight">
              <p className="font-display font-extrabold text-[15px] tracking-tight">Voucher Manager</p>
              <p className="text-[11.5px] text-[var(--fg-muted)]">Vodafone Fiji · USO</p>
            </div>
          </div>

          <div className="mb-7">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="h-[2.5px] w-7 rounded-full bg-[var(--brand)]" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                Operations console
              </span>
            </div>
            <h1 className="font-display font-extrabold text-[28px] sm:text-[32px] leading-[1.1] tracking-[-0.028em] text-[var(--fg-primary)]">
              Sign in
            </h1>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-secondary)] mt-2.5">
              Use your Vodafone Fiji account to continue.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {/* The joined credential block */}
            <div
              className={
                "overflow-hidden rounded-2xl border bg-[var(--surface)] transition-shadow duration-150 " +
                (focusField
                  ? "border-[var(--brand)] shadow-[0_0_0_4px_var(--brand-soft)]"
                  : "border-[var(--input-border)] shadow-[var(--shadow-sm)]")
              }
            >
              <CredentialRow icon={Mail} label="Email" focused={focusField === "email"}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusField("email")}
                  onBlur={() => setFocusField(null)}
                  placeholder="you@vodafone.com.fj"
                  required
                  autoComplete="email"
                  autoFocus
                  className={inputClass}
                />
              </CredentialRow>

              <div className="h-px bg-[var(--border-default)]" />

              <CredentialRow
                icon={Lock}
                label="Password"
                focused={focusField === "password"}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] pointer-coarse:grid pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:place-items-center pointer-coarse:p-0"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              >
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusField("password")}
                  onBlur={() => { setFocusField(null); setCapsLock(false); }}
                  // Checked on the way in as well as the way out, so the
                  // warning appears on the first keystroke and not the second.
                  onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className={`${inputClass} ${showPassword || !password ? "" : "tracking-[0.12em]"}`}
                />
              </CredentialRow>
            </div>

            {capsLock && (
              <p className="flex items-center gap-2 text-[12px] font-medium text-[var(--warning-fg)]">
                <AlertTriangle size={13} className="shrink-0" />
                Caps Lock is on.
              </p>
            )}

            {err && (
              <div
                role="alert"
                className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger-border)] animate-fade-in"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger-fg)] mt-[7px] shrink-0" />
                <p className="text-[12.5px] text-[var(--danger-fg)] font-medium leading-relaxed">{err}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              iconRight={!loading && <ArrowRight size={15} />}
              className="w-full mt-1"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-center gap-2 text-[11.5px] text-[var(--fg-muted)]">
            <ShieldCheck size={13} />
            <span>Secured · JWT · TLS 1.3</span>
          </div>
        </div>
      </main>

      {/* ===================== Two-factor, over the form ===================== */}
      <TwoFactorVerifyModal
        open={stage === "verify"}
        tempToken={tempToken}
        email={email}
        onSuccess={onVerified}
        onCancel={abandonChallenge}
      />
      <TwoFactorEnrolModal
        open={stage === "enrol"}
        token={setupToken}
        onDone={(token) => completeLogin(token, false)}
        onCancel={abandonChallenge}
      />
    </div>
  );
}
