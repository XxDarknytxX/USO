// src/pages/Login.jsx
// One continuous red→neutral sweep (login-canvas) across the whole viewport —
// no hard split. The form floats in a glass card that blurs the gradient behind
// it, the Service Desk "blur-in" feel.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";

import { api } from "../services/api";
import { Field, Input, Button } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const { token } = await api("/login", {
        method: "POST",
        body: { email, password },
      });
      localStorage.setItem("token", token);
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        if (payload.role) localStorage.setItem("role", payload.role);
      } catch {
        /* token will still be validated server-side */
      }
      navigate("/dashboard");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative flex flex-col lg:flex-row overflow-hidden login-canvas">
      {/* Texture + glow overlays over the sweep */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.55) 1px, transparent 0)",
          backgroundSize: "30px 30px",
        }}
      />
      <div className="pointer-events-none absolute -top-40 -left-28 w-[560px] h-[560px] rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 left-[30%] w-[480px] h-[480px] rounded-full bg-black/25 blur-3xl" />

      {/* -------- Left brand copy (over the red end of the sweep) -------- */}
      <aside className="hidden lg:flex lg:w-[46%] xl:w-[42%] relative z-10 flex-col justify-between p-14 text-white">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/15 backdrop-blur border border-white/20">
            <Ticket size={18} strokeWidth={2} />
          </span>
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold tracking-tight">Voucher Manager</span>
            <span className="text-[12px] font-medium text-white/70">Vodafone Fiji · USO Portal</span>
          </div>
        </div>

        <div className="space-y-6 max-w-md">
          <h1 className="text-[44px] xl:text-[52px] font-semibold tracking-[-0.025em] leading-[1.04]">
            Operations
            <br />
            <span className="text-white/60">for the field,</span>
            <br />
            not the boardroom.
          </h1>
          <p className="text-[14px] leading-relaxed text-white/75 max-w-sm">
            Generate codes, monitor sessions, and audit the entire payment-to-internet
            journey across the Vodafone captive portal — all from one console.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {["Ruijie Cloud sync", "M-PAiSA telemetry", "Signed audit trail"].map((feat) => (
              <span
                key={feat}
                className="px-2.5 h-7 inline-flex items-center text-[11px] font-medium rounded-lg border border-white/20 bg-white/10 text-white/90 backdrop-blur-sm"
              >
                {feat}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-medium text-white/55">
          <ShieldCheck size={13} />
          <span>Secured · JWT · TLS 1.3</span>
        </div>
      </aside>

      {/* -------- Right form (glass card floating on the neutral end) -------- */}
      <section className="flex-1 relative z-10 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[410px] rounded-2xl border border-[var(--border-strong)] surface-glass shadow-[var(--shadow-elevated)] p-7 sm:p-9 animate-scale-in">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <span className="brand-mark">
              <Ticket size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-tight">
                Voucher Manager
              </h2>
              <p className="text-[12px] font-medium text-[var(--text-tertiary)]">Vodafone Fiji</p>
            </div>
          </div>

          <div className="mb-8">
            <span className="text-label text-[var(--text-tertiary)] block mb-2">Sign in</span>
            <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text-primary)]">
              Welcome back.
            </h1>
            <p className="text-[13px] text-[var(--text-tertiary)] mt-1">
              Enter your credentials to continue to the console.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field label="Email" required>
              <div className="relative">
                <Mail
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
                />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@vodafone.com.fj"
                  required
                  autoComplete="email"
                  className="pl-9"
                />
              </div>
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <Lock
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
                />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors p-1 focus-ring rounded"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>

            {err && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--border-accent)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] mt-[7px] shrink-0" />
                <p className="text-[12.5px] text-[var(--danger-fg)] font-medium leading-relaxed">
                  {err}
                </p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              iconRight={!loading && <ArrowRight size={14} />}
              className="w-full mt-1"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-9 text-center text-[12.5px] font-medium text-[var(--text-tertiary)]">
            Voucher Manager · v1.0
          </p>
        </div>
      </section>
    </div>
  );
}
