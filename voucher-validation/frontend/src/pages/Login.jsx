// src/pages/Login.jsx
// Split-screen login. Left rail is a saturated brand panel; right side is the
// form — pure neutral surface. Reads as a serious operations console.

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
    <div className="min-h-screen flex bg-[var(--surface)] text-[var(--text-primary)]">
      {/* -------- Left brand panel -------- */}
      <aside
        className="hidden lg:flex lg:w-[44%] xl:w-[40%] relative overflow-hidden text-white"
        style={{
          background:
            "linear-gradient(155deg, #7a0a0a 0%, #c20000 38%, #e60000 100%)",
        }}
      >
        {/* Subtle grid mesh */}
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Soft glow */}
        <div className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 w-[420px] h-[420px] rounded-full bg-black/30 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-14 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/15 backdrop-blur border border-white/15"
            >
              <Ticket size={18} strokeWidth={2} />
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold tracking-tight">
                Voucher Manager
              </span>
              <span className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-white/55">
                Vodafone Fiji · USO Portal
              </span>
            </div>
          </div>

          {/* Center */}
          <div className="space-y-6 max-w-md">
            <h1 className="text-[44px] xl:text-[52px] font-semibold tracking-[-0.025em] leading-[1.04]">
              Operations
              <br />
              <span className="text-white/65">for the field,</span>
              <br />
              not the boardroom.
            </h1>
            <p className="text-[14px] leading-relaxed text-white/70 max-w-sm">
              Generate codes, monitor sessions, and audit the entire payment-to-internet
              journey across the Vodafone captive portal — all from one console.
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                "Ruijie Cloud sync",
                "M-PAiSA telemetry",
                "Signed audit trail",
              ].map((feat) => (
                <span
                  key={feat}
                  className="px-2.5 h-7 inline-flex items-center text-[11px] font-mono uppercase tracking-[0.08em] rounded border border-white/15 bg-white/5 text-white/85"
                >
                  {feat}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] text-white/45">
            <ShieldCheck size={13} />
            <span>Secured · JWT · TLS 1.3</span>
          </div>
        </div>
      </aside>

      {/* -------- Right form panel -------- */}
      <section className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <span className="brand-mark">
              <Ticket size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-tight">
                Voucher Manager
              </h2>
              <p className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
                Vodafone Fiji
              </p>
            </div>
          </div>

          <div className="mb-8">
            <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-[var(--text-quaternary)] block mb-2">
              Sign in
            </span>
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
              <div
                className={
                  "flex items-start gap-2 px-3 py-2.5 rounded-md " +
                  "bg-[var(--danger-soft)] border border-[var(--brand-soft-hover)]"
                }
              >
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

          <p className="mt-10 text-center text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
            Voucher Manager · v1.0
          </p>
        </div>
      </section>
    </div>
  );
}
