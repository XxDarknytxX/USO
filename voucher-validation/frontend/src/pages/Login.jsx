// src/pages/Login.jsx
// Focused, premium sign-in: a deep canvas with a slowly-breathing Vodafone-red
// aurora, a centered glass card carrying the app's living red accent line, and a
// staggered blur-in on load. Theme-aware (uses the same tokens as the app shell).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";

import { api } from "../services/api";
import { Field, Input, Button } from "../components/ui";
import VodafoneLogo from "../components/ui/VodafoneLogo";

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
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[var(--bg-base)] text-[var(--fg-primary)] px-5 py-10">
      {/* ===== Ambient backdrop ===== */}
      {/* Breathing red aurora — drifts + pulses behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-[22%] w-[min(920px,120vw)] h-[min(920px,120vw)] rounded-full blur-[130px] opacity-70 animate-float-slow"
        style={{ background: "radial-gradient(circle, rgba(230,0,0,0.30), rgba(230,0,0,0.06) 45%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[28%] -right-[12%] w-[min(680px,90vw)] h-[min(680px,90vw)] rounded-full blur-[130px] opacity-45 animate-float"
        style={{ background: "radial-gradient(circle, rgba(230,0,0,0.20), transparent 65%)" }}
      />
      {/* Fine dot grid + focusing vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--fg-primary) 1px, transparent 0)", backgroundSize: "34px 34px" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 38%, var(--bg-base) 94%)" }}
      />

      {/* ===== Content ===== */}
      <div className="relative z-10 w-full max-w-[420px]">
        {/* Brand lockup */}
        <div className="flex flex-col items-center text-center mb-7 animate-fade-up">
          <VodafoneLogo size={52} className="drop-shadow-[0_0_26px_rgba(230,0,0,0.5)]" />
          <h2 className="mt-4 text-[15px] font-semibold text-[var(--fg-primary)] tracking-tight">Voucher Manager</h2>
          <p className="text-[12px] font-medium text-[var(--fg-muted)] mt-0.5">Vodafone Fiji · USO Portal</p>
        </div>

        {/* Card */}
        <div
          className="relative rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)]/85 backdrop-blur-xl shadow-[var(--shadow-elevated)] overflow-hidden animate-fade-up"
          style={{ animationDelay: "80ms", animationFillMode: "both" }}
        >
          {/* Living red accent line — the same pulse as the app chrome */}
          <div
            aria-hidden
            className="absolute top-0 left-0 right-0 h-[2px] animate-header-wave"
            style={{
              background:
                "linear-gradient(90deg, rgba(230,0,0,0.04) 0%, rgba(230,0,0,0.6) 25%, #E60000 50%, rgba(230,0,0,0.6) 75%, rgba(230,0,0,0.04) 100%)",
              backgroundSize: "200% 100%",
            }}
          />

          <div className="p-7 sm:p-8">
            <div className="mb-6">
              <span className="text-label !text-[var(--accent)] block mb-2">Sign in</span>
              <h1 className="text-[26px] font-semibold tracking-tight text-[var(--fg-primary)] leading-tight">Welcome back</h1>
              <p className="text-[13px] text-[var(--fg-secondary)] mt-1.5">Sign in to continue to the operations console.</p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field label="Email" required>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
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
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
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
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors p-1 rounded"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>

              {err && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/25 animate-fade-in">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] mt-[7px] shrink-0" />
                  <p className="text-[12.5px] text-[var(--accent)] font-medium leading-relaxed">{err}</p>
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
          </div>

          {/* Card footer — trust line */}
          <div className="px-7 sm:px-8 py-3.5 border-t border-[var(--border-default)] bg-[var(--bg-surface)]/40 flex items-center justify-center gap-2 text-[11px] font-medium text-[var(--fg-muted)]">
            <ShieldCheck size={12} />
            <span>Secured · JWT · TLS 1.3</span>
          </div>
        </div>

        <p
          className="mt-6 text-center text-[11.5px] text-[var(--fg-muted)] animate-fade-up"
          style={{ animationDelay: "160ms", animationFillMode: "both" }}
        >
          Voucher Manager · v1.0 · Vodafone Fiji
        </p>
      </div>
    </div>
  );
}
