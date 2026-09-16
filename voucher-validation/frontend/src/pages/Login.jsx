// src/pages/Login.jsx
//
// Sign-in, rebuilt as a two-panel layout after Salesforce's product login: a
// branded panel that says what this system is and what it is for, beside a calm
// white form panel that does one job.
//
// The previous version was a single card floating on an ambient wash — it could
// have been any admin tool. The brand panel is where the product gets to have a
// personality; the form side stays deliberately plain, because nobody wants a
// designed experience while typing a password. On narrow screens the brand panel
// collapses to a compact header so the form is never pushed below the fold.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck, Wifi, Ticket, Wrench, KeyRound } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../services/api";
import { Field, Input, Button } from "../components/ui";
import VodafoneLogo from "../components/ui/VodafoneLogo";
import TwoFactorEnrol from "../components/TwoFactorEnrol";

const HIGHLIGHTS = [
  { Icon: Wifi, title: "Village connectivity", copy: "Live health for every USO site, in one place." },
  { Icon: Ticket, title: "Vouchers & revenue", copy: "Sales, stock and usage across the estate." },
  { Icon: Wrench, title: "Field maintenance", copy: "Six-monthly inspections, with photographic evidence." },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "password" | "verify" | "enrol". The whole sign-in lives on this one screen
  // rather than across routes, because every intermediate state holds a token
  // that must not outlive the attempt — and a route can be navigated back to.
  const [stage, setStage] = useState("password");
  const [tempToken, setTempToken] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  /**
   * Stores a finished session. Kept in one place because a token written
   * without its role leaves the SPA guessing what the account may see.
   */
  function completeLogin(token, mustChangePassword) {
    localStorage.setItem("token", token);
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.role) localStorage.setItem("role", payload.role);
    } catch {
      /* token will still be validated server-side */
    }
    navigate(mustChangePassword ? "/profile?changePassword=1" : "/dashboard");
  }

  async function onVerify(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await api("/2fa/login-verify", {
        method: "POST",
        body: { tempToken, code: code.replace(/\s+/g, "") },
      });
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
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
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
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[var(--bg-base)] text-[var(--fg-primary)]">
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
      <main className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14 xl:px-20">
        <div className="w-full max-w-[400px] mx-auto">
          {/* Compact brand lockup for narrow screens, where the panel is hidden */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <span className="h-11 w-11 rounded-[14px] bg-[var(--brand-soft)] flex items-center justify-center">
              <VodafoneLogo size={26} />
            </span>
            <div className="leading-tight">
              <p className="font-display font-extrabold text-[15px] tracking-tight">Voucher Manager</p>
              <p className="text-[11.5px] text-[var(--fg-muted)]">Vodafone Fiji · USO</p>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-h1 text-[var(--fg-primary)]">
              {stage === "verify" ? "Two-factor check" : stage === "enrol" ? "Set up two-factor" : "Sign in"}
            </h1>
            <p className="text-[13.5px] text-[var(--fg-secondary)] mt-2">
              {stage === "verify"
                ? "Enter the six-digit code from your authenticator app, or one of your backup codes."
                : stage === "enrol"
                  ? "This console requires two-factor authentication. It takes a minute and only has to be done once."
                  : "Use your Vodafone Fiji account to continue to the operations console."}
            </p>
          </div>

          {/* ENROL — the account has no second factor and the estate requires
              one. Rendered here rather than behind a route because the setup
              token must not outlive the attempt, and a route can be navigated
              back to with a stale one. */}
          {stage === "enrol" && (
            <TwoFactorEnrol
              token={setupToken}
              onDone={(token) => completeLogin(token, false)}
              onCancel={() => { setStage("password"); setSetupToken(""); setPassword(""); }}
            />
          )}

          {/* VERIFY — enrolled already; one code away from a session. */}
          {stage === "verify" && (
            <form onSubmit={onVerify} className="flex flex-col gap-5">
              <Field label="Authentication code" required>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    required
                    autoFocus
                    // one-time-code lets a phone offer the code from the
                    // notification instead of making someone switch apps.
                    autoComplete="one-time-code"
                    inputMode="text"
                    className="pl-10 font-mono tracking-[0.2em]"
                  />
                </div>
              </Field>
              {err && (
                <p className="text-[13px] text-[var(--danger-fg)] bg-[var(--danger-soft)] border border-[var(--danger-border)] rounded-lg px-3.5 py-2.5">
                  {err}
                </p>
              )}
              <Button type="submit" loading={loading} iconRight={!loading && <ArrowRight size={16} />}>
                Verify
              </Button>
              <button
                type="button"
                onClick={() => { setStage("password"); setTempToken(""); setCode(""); setErr(""); }}
                className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
              >
                Use a different account
              </button>
            </form>
          )}

          {stage === "password" && (
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <Field label="Email" required>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@vodafone.com.fj"
                  required
                  autoComplete="email"
                  className="pl-10"
                />
              </div>
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="pl-10 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>

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
          )}

          <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-center gap-2 text-[11.5px] text-[var(--fg-muted)]">
            <ShieldCheck size={13} />
            <span>Secured · JWT · TLS 1.3</span>
          </div>
        </div>
      </main>
    </div>
  );
}
