// src/pages/Login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { Ticket, Mail, Lock, ArrowRight, Eye, EyeOff, Shield } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(null);
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
      // Decode role from JWT payload for quick client-side checks
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        if (payload.role) localStorage.setItem("role", payload.role);
      } catch { /* token will still be validated server-side */ }
      navigate("/dashboard");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side - branding panel */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0">
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-white/5 rounded-full blur-3xl" />
          <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-pink-400/10 rounded-full blur-3xl" />
          <div className="absolute top-[30%] right-[10%] w-[30%] h-[30%] bg-purple-300/10 rounded-full blur-2xl" />
        </div>

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo and brand */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/10">
                <Ticket className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white text-xl font-bold tracking-tight">VoucherHub</h2>
                <p className="text-purple-200 text-xs font-medium">Management System</p>
              </div>
            </div>
          </div>

          {/* Center feature */}
          <div className="space-y-6">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight">
              Manage your
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-200 to-purple-200">
                vouchers
              </span>
              <br />
              with ease.
            </h1>
            <p className="text-purple-200 text-base leading-relaxed max-w-sm">
              Generate, track, and manage vouchers across your network with a powerful and intuitive dashboard.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 pt-2">
              {["Real-time Sync", "Bulk Actions", "Analytics"].map((feature) => (
                <span
                  key={feature}
                  className="px-3.5 py-1.5 bg-white/10 backdrop-blur-sm text-white/90 text-xs font-medium rounded-full border border-white/10"
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <div className="flex items-center gap-2 text-purple-300/60 text-xs">
            <Shield size={13} />
            <span>Secured with JWT authentication</span>
          </div>
        </div>
      </div>

      {/* Right side - login form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50/50 px-6 py-12">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-11 h-11 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <Ticket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-gray-900 text-lg font-bold tracking-tight">VoucherHub</h2>
              <p className="text-gray-400 text-[11px] font-medium">Management System</p>
            </div>
          </div>

          {/* Welcome text */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1.5">Welcome back</h1>
            <p className="text-sm text-gray-400">
              Sign in to your account to continue
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-5">
            {/* Email field */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div
                className={`relative flex items-center rounded-xl border transition-all duration-200 ${
                  focused === "email"
                    ? "border-purple-400 ring-[3px] ring-purple-100 bg-white"
                    : "border-gray-200 bg-gray-50/80 hover:border-gray-300"
                }`}
              >
                <div className="pl-4 pr-1">
                  <Mail
                    size={16}
                    className={`transition-colors duration-200 ${
                      focused === "email" ? "text-purple-500" : "text-gray-300"
                    }`}
                  />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                  placeholder="you@example.com"
                  required
                  className="flex-1 bg-transparent px-3 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Password
              </label>
              <div
                className={`relative flex items-center rounded-xl border transition-all duration-200 ${
                  focused === "password"
                    ? "border-purple-400 ring-[3px] ring-purple-100 bg-white"
                    : "border-gray-200 bg-gray-50/80 hover:border-gray-300"
                }`}
              >
                <div className="pl-4 pr-1">
                  <Lock
                    size={16}
                    className={`transition-colors duration-200 ${
                      focused === "password" ? "text-purple-500" : "text-gray-300"
                    }`}
                  />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  placeholder="Enter your password"
                  required
                  className="flex-1 bg-transparent px-3 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="pr-4 pl-1 text-gray-300 hover:text-gray-500 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {err && (
              <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                <p className="text-sm text-red-600 font-medium">{err}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] group"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight
                    size={16}
                    className="group-hover:translate-x-0.5 transition-transform"
                  />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-xs text-gray-300 mt-8">
            Voucher Management System v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
