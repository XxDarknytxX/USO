// src/components/TwoFactorEnrol.jsx
// Enrolling an authenticator: scan, confirm, keep the backup codes.
//
// Used in two places that look different but are the same three steps — at
// login when the estate requires 2FA and this account has none, and from the
// profile page when someone turns it on themselves. It takes the token to use
// explicitly, because at login that is a short-lived setup token that has
// deliberately NOT been stored as the session.
//
// The backup codes are shown once and never again. That is not a UI choice: the
// server keeps only bcrypt hashes, so there is nothing to show a second time.
// The screen says so, and will not let someone leave until they confirm they
// have them.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, Copy, Download, KeyRound, ArrowRight } from "lucide-react";
import { api } from "../services/api";
import { Field, Input, Button } from "./ui";

export default function TwoFactorEnrol({ token, onDone, onCancel, compact = false }) {
  const [step, setStep] = useState("scan"); // scan → codes
  const [qr, setQr] = useState(null);
  const [manualKey, setManualKey] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState(null);
  const [newToken, setNewToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The token is passed in rather than read from storage: during login the
  // setup token is deliberately not the stored session.
  const call = useCallback(
    (path, body) =>
      api(path, {
        method: "POST",
        body,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        auth: !token,
      }),
    [token]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await call("/2fa/setup", {});
        if (cancelled) return;
        setQr(r.qrCode);
        setManualKey(r.manualEntryKey || r.secret || "");
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [call]);

  async function verify(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await call("/2fa/verify", { code: code.replace(/\s+/g, "") });
      setBackupCodes(r.backupCodes || []);
      setNewToken(r.token || "");
      setStep("codes");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const codesText = (backupCodes || []).join("\n");

  function copyCodes() {
    navigator.clipboard?.writeText(codesText).then(
      () => toast.success("Backup codes copied"),
      () => toast.error("Could not copy — select and copy them by hand")
    );
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        "Vodafone Fiji USO operations console — two-factor backup codes\n",
        "Each code works ONCE. Keep them somewhere only you can reach.\n\n",
        codesText,
        "\n",
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "uso-console-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ─────────────────────────── Step 2: the codes ─────────────────────────── */
  if (step === "codes") {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3">
          <p className="text-[13px] font-semibold text-[var(--warning-fg)]">
            Save these now — they are not shown again
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--warning-fg)] opacity-90">
            Each code works once, and gets you in if you lose your phone. Only hashes are kept on the
            server, so nobody can show them to you later — including an administrator.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          {(backupCodes || []).map((c) => (
            <code key={c} className="font-mono text-[13.5px] tracking-[0.08em] text-[var(--fg-primary)]">
              {c}
            </code>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={copyCodes} iconLeft={<Copy size={14} />}>
            Copy
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadCodes} iconLeft={<Download size={14} />}>
            Download
          </Button>
        </div>

        <label className="flex items-start gap-2.5 text-[13px] text-[var(--fg-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 accent-[var(--brand)] cursor-pointer"
          />
          <span>I have saved these backup codes somewhere safe.</span>
        </label>

        <Button
          disabled={!saved}
          onClick={() => onDone?.(newToken)}
          iconRight={<ArrowRight size={16} />}
        >
          Continue
        </Button>
      </div>
    );
  }

  /* ─────────────────────────── Step 1: the scan ─────────────────────────── */
  return (
    <form onSubmit={verify} className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
        <p className="text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
          Scan this with Google Authenticator, Microsoft Authenticator, or any app that takes a
          six-digit code, then enter the code it shows.
        </p>
      </div>

      {qr ? (
        <div className="flex flex-col items-center gap-3">
          {/* White plate regardless of theme: a QR inverted for dark mode is one
              many scanners will not read. */}
          <div className="rounded-xl bg-white p-3 border border-[var(--border-default)]">
            <img src={qr} alt="Two-factor setup QR code" width={196} height={196} />
          </div>
          {manualKey && (
            <details className="w-full">
              <summary className="text-[12px] text-[var(--fg-muted)] cursor-pointer hover:text-[var(--fg-primary)]">
                Can't scan it?
              </summary>
              <p className="mt-2 text-[12px] text-[var(--fg-secondary)]">
                Enter this key by hand in your authenticator app:
              </p>
              <code className="mt-1.5 block break-all rounded-lg bg-[var(--bg-surface)] px-3 py-2 font-mono text-[12.5px] tracking-[0.06em] text-[var(--fg-primary)]">
                {manualKey}
              </code>
            </details>
          )}
        </div>
      ) : (
        <div className="h-[220px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] animate-pulse" />
      )}

      <Field label="Code from your app" required>
        <div className="relative">
          <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            required
            autoComplete="one-time-code"
            className="pl-10 font-mono tracking-[0.2em]"
          />
        </div>
      </Field>

      {err && (
        <p className="text-[13px] text-[var(--danger-fg)] bg-[var(--danger-soft)] border border-[var(--danger-border)] rounded-lg px-3.5 py-2.5">
          {err}
        </p>
      )}

      <Button type="submit" loading={busy} disabled={!qr}>
        Turn on two-factor
      </Button>

      {onCancel && !compact && (
        <button
          type="button"
          onClick={onCancel}
          className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
        >
          Use a different account
        </button>
      )}
    </form>
  );
}
