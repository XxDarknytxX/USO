// src/pages/SetPassword.jsx
//
// Where an invite link lands. The person has an account but has never had a
// password, so there is nothing to sign in with — the token in the URL is the
// credential, and it is spent the moment a password is chosen.
//
// Built on the same two-panel frame as the sign-in screen deliberately: this
// is the first thing a new account holder ever sees of the console, and a page
// that looks nothing like the one they are about to use reads like a phishing
// page — which is exactly the instinct you do not want to dull.
//
// The token is checked before the form is shown. An expired or spent link
// should say so while someone can still ask for another, not after they have
// picked a password and typed it twice.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Eye, EyeOff, ArrowRight, ShieldCheck, Check, X, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";

import { inviteApi } from "../services/api";
import { Button } from "../components/ui";
import VodafoneLogo from "../components/ui/VodafoneLogo";

/* Rules stated up front and ticked off live, rather than a length error after
   the fact. Someone inventing a password should be able to see when they are
   done without pressing anything. */
const RULES = [
  { key: "len", label: "At least 8 characters", test: (v) => v.length >= 8 },
  { key: "case", label: "Upper and lower case", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { key: "num", label: "A number or symbol", test: (v) => /[^A-Za-z]/.test(v) },
];

function Rule({ ok, label }) {
  return (
    <li className="flex items-center gap-2 text-[12.5px]">
      <span
        className={
          "grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors " +
          (ok ? "bg-[var(--success-fg)] text-white" : "bg-[var(--surface-pressed)] text-transparent")
        }
      >
        <Check size={10} strokeWidth={3.5} />
      </span>
      <span className={ok ? "text-[var(--fg-secondary)]" : "text-[var(--fg-muted)]"}>{label}</span>
    </li>
  );
}

/**
 * Takes the token off the URL, once, and removes it from the address bar.
 *
 * Links carry it in the FRAGMENT (#token=…). A fragment is never sent to the
 * server: it is not in the request line nginx writes to its access log, and it
 * is not in the Referer header of anything the page loads. In the query string
 * (?token=…) the credential was written to the server's access log on every
 * link opened — readable by anyone with that file, for as long as the link
 * lived. The query form is still accepted so links mailed before this change
 * keep working until they expire.
 *
 * Captured at module evaluation of the first render and then replaced out of
 * history, so the token does not survive in the back button, in a copied URL,
 * or in the referrer of anything loaded afterwards.
 */
function takeTokenFromUrl() {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  const fromQuery = new URLSearchParams(window.location.search).get("token");
  const token = fromHash || fromQuery || "";
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

export default function SetPassword() {
  // useState's initialiser runs once, so the URL is read — and cleaned — once,
  // and a re-render after replaceState cannot see an empty URL and lose it.
  const [token] = useState(takeTokenFromUrl);
  const navigate = useNavigate();

  const [state, setState] = useState("checking"); // checking | ready | dead | unreachable
  const [account, setAccount] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const check = useCallback(async () => {
    if (!token) { setErr("This link is missing its code."); setState("dead"); return; }
    setState("checking");
    try {
      const r = await inviteApi.check(token);
      setAccount(r);
      setState("ready");
    } catch (e) {
      // Only a 400 means the LINK is bad. Anything else — a 5xx, a timeout, no
      // network — says nothing about the link, and telling someone it expired
      // sends them off to ask for a new one they did not need.
      if (e.status === 400) {
        setErr("");
        setState("dead");
      } else {
        setErr(e.message);
        setState("unreachable");
      }
    }
  }, [token]);

  useEffect(() => { check(); }, [check]);

  const isReset = account?.purpose === "reset";
  const passed = RULES.filter((r) => r.test(password)).length;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = passed === RULES.length && password === confirm && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setErr("");
    setBusy(true);
    try {
      await inviteApi.accept(token, password);
      // Sent to sign in rather than straight through: the sign-in is what
      // proves the password works, and it is the route that already knows what
      // to do about two-factor.
      toast.success(isReset ? "Password changed — sign in with your new one" : "Password set — sign in to finish", { duration: 6000 });
      navigate("/login", { replace: true });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    // dvh below lg: a phone's 100vh includes the browser bar.
    <div className="min-h-screen max-lg:min-h-dvh grid lg:grid-cols-[1.05fr_1fr] bg-[var(--bg-base)] text-[var(--fg-primary)]">
      {/* Brand panel — same frame as sign-in, so this reads as the console and
          not as a page that merely mentions it. */}
      <aside className="relative hidden overflow-hidden lg:flex flex-col justify-between p-12 xl:p-16 text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(150deg, #7A0A0A 0%, #C20000 34%, #E60000 58%, #FF4D4D 100%)" }}
        />
        <div
          aria-hidden
          className="absolute -right-24 -bottom-32 h-[560px] w-[560px] rounded-full opacity-[0.18]"
          style={{ background: "radial-gradient(circle at 30% 30%, #fff 0%, transparent 62%)" }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/15 backdrop-blur-sm">
            <VodafoneLogo size={26} />
          </span>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-extrabold tracking-tight">Voucher Manager</p>
            <p className="text-[11.5px] text-white/70">Vodafone Fiji · USO</p>
          </div>
        </div>
        <div className="relative max-w-[440px]">
          <h2 className="font-display text-[40px] xl:text-[46px] font-extrabold leading-[1.08] tracking-[-0.03em]">
            One password. Yours alone.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            Nobody at Vodafone Fiji chose this password and nobody can read it back — not your
            administrator, not us. Pick something only you would.
          </p>
        </div>
        <p className="relative text-[11.5px] text-white/60">
          © {new Date().getFullYear()} Vodafone Fiji · Universal Service Obligation
        </p>
      </aside>

      {/* justify-start, not justify-center: the block below centres itself with
          auto margins, which give way when the content is taller than the
          screen (the keyboard is open) instead of clipping its top. The
          uneven phone padding is the optical bias — a little above centre. */}
      <main className="relative flex flex-col justify-center px-6 py-12 max-sm:justify-start max-sm:px-5 max-sm:pt-8 max-sm:pb-12 sm:px-10 lg:px-14 xl:px-20">
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

        {/* On a phone the whole block — lockup, heading, form, footer — is
            centred as ONE thing. Stretching it to fill the screen and pinning
            the footer to the bottom edge only moved the empty space: it opened
            a blank third of a screen between the Set password button and the
            footer. */}
        <div className="relative mx-auto w-full max-w-[404px] max-sm:my-auto">
          <div className="mb-10 flex items-center gap-3 lg:hidden max-sm:mb-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[var(--brand-soft)]">
              <VodafoneLogo size={26} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-tight">Voucher Manager</p>
              <p className="text-[11.5px] text-[var(--fg-muted)]">Vodafone Fiji · USO</p>
            </div>
          </div>

          {state === "checking" && (
            <div className="flex flex-col gap-4">
              <div className="h-6 w-40 animate-pulse rounded bg-[var(--surface-pressed)]" />
              <div className="h-[104px] animate-pulse rounded-2xl bg-[var(--surface-pressed)]" />
            </div>
          )}

          {state === "dead" && (
            <div className="flex flex-col items-start gap-5">
              <span className="grid h-12 w-12 place-items-center rounded-[15px] border border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-fg)]">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.025em]">
                  This link has expired
                </h1>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--fg-secondary)]">
                  It may already have been used, or be older than the few hours these links last — they
                  are short on purpose. Ask your administrator to send another; it takes them a moment.
                </p>
              </div>
              <Button variant="secondary" onClick={() => navigate("/login")} className="max-sm:w-full">
                Go to sign in
              </Button>
            </div>
          )}

          {state === "unreachable" && (
            <div className="flex flex-col items-start gap-5">
              <span className="grid h-12 w-12 place-items-center rounded-[15px] border border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-fg)]">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.025em]">
                  Could not check your link
                </h1>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--fg-secondary)]">
                  The console did not answer, so this says nothing about whether your link is still good.
                  Try again in a moment.
                </p>
                {err && <p className="mt-2 font-mono text-[11.5px] text-[var(--fg-muted)]">{err}</p>}
              </div>
              {/* The token was already taken off the URL, so reloading the page
                  would lose it. Retry re-runs the check with the one in memory. */}
              <Button variant="primary" onClick={check} className="max-sm:w-full">Try again</Button>
            </div>
          )}

          {state === "ready" && (
            <>
              <div className="mb-7">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-[2.5px] w-7 rounded-full bg-[var(--brand)]" />
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                    {isReset ? "Password reset" : "Finish setting up"}
                  </span>
                </div>
                {/* A reset and a first-time setup are different moments. Someone
                    recovering an account wants to know their old password is gone
                    and why; "Welcome" is the wrong thing to say to them. */}
                <h1 className="font-display text-[28px] font-extrabold leading-[1.1] tracking-[-0.028em] sm:text-[32px] max-sm:[overflow-wrap:anywhere]">
                  {isReset
                    ? "Choose a new password"
                    : account?.name ? `Welcome, ${account.name.split(" ")[0]}` : "Choose a password"}
                </h1>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--fg-secondary)]">
                  {isReset ? "An administrator reset the password for " : "Setting the password for "}
                  <span className="font-medium text-[var(--fg-primary)] max-sm:[overflow-wrap:anywhere]">{account?.email}</span>.
                  {isReset && " The old one no longer works."}
                </p>
              </div>

              <form onSubmit={submit} className="flex flex-col gap-4">
                <div
                  className={
                    "overflow-hidden rounded-2xl border bg-[var(--surface)] transition-shadow duration-150 " +
                    (mismatch
                      ? "border-[var(--danger-border)]"
                      : "border-[var(--input-border)] shadow-[var(--shadow-sm)]")
                  }
                >
                  <div className="flex items-stretch">
                    <span className="flex w-[52px] shrink-0 items-center justify-center border-r border-[var(--border-default)] text-[var(--fg-subtle)]">
                      <KeyRound size={16} strokeWidth={1.9} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2.5">
                      <span className="mb-1.5 text-[9.5px] font-bold uppercase leading-none tracking-[0.14em] text-[var(--fg-muted)]">
                        New password
                      </span>
                      <input
                        type={show ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        autoFocus
                        required
                        className="w-full border-0 bg-transparent p-0 text-[14.5px] leading-[1.35] text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-subtle)]"
                        placeholder="Something only you would pick"
                      />
                    </span>
                    <span className="flex items-center pr-3 pointer-coarse:pr-1.5">
                      <button
                        type="button"
                        onClick={() => setShow((v) => !v)}
                        tabIndex={-1}
                        aria-label={show ? "Hide password" : "Show password"}
                        className="rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] pointer-coarse:grid pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:place-items-center pointer-coarse:p-0"
                      >
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </div>

                  <div className="h-px bg-[var(--border-default)]" />

                  <div className="flex items-stretch">
                    <span className="flex w-[52px] shrink-0 items-center justify-center border-r border-[var(--border-default)] text-[var(--fg-subtle)]">
                      {mismatch ? (
                        <X size={16} className="text-[var(--danger-fg)]" />
                      ) : (
                        <Check size={16} strokeWidth={1.9} className={confirm && !mismatch ? "text-[var(--success-fg)]" : ""} />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2.5">
                      <span className="mb-1.5 text-[9.5px] font-bold uppercase leading-none tracking-[0.14em] text-[var(--fg-muted)]">
                        Confirm
                      </span>
                      <input
                        type={show ? "text" : "password"}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        required
                        className="w-full border-0 bg-transparent p-0 text-[14.5px] leading-[1.35] text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-subtle)]"
                        placeholder="Type it again"
                      />
                    </span>
                  </div>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {RULES.map((r) => (
                    <Rule key={r.key} ok={r.test(password)} label={r.label} />
                  ))}
                </ul>

                {mismatch && (
                  <p className="text-[12.5px] font-medium text-[var(--danger-fg)]">
                    The two passwords do not match.
                  </p>
                )}

                {err && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-3"
                  >
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger-fg)]" />
                    <p className="text-[12.5px] font-medium leading-relaxed text-[var(--danger-fg)]">{err}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={busy}
                  disabled={!ready}
                  iconRight={!busy && <ArrowRight size={15} />}
                  className="mt-1 w-full"
                >
                  {busy ? "Setting your password…" : "Set password"}
                </Button>
              </form>

              <div className="mt-8 flex items-center justify-center gap-2 border-t border-[var(--border-subtle)] pt-6 text-[11.5px] text-[var(--fg-muted)] max-sm:mt-7 max-sm:pt-5">
                <ShieldCheck size={13} />
                <span>This link works once and then stops working</span>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
