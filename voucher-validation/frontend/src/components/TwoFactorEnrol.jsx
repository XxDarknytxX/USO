// src/components/TwoFactorEnrol.jsx
// Enrolling an authenticator: scan, confirm, keep the backup codes.
//
// Opened from two places — at login when the estate requires 2FA and this
// account has none, and from the profile page when someone turns it on
// themselves. It takes the token to use explicitly, because at login that is a
// short-lived setup token that has deliberately NOT been stored as the
// session, and reading one from storage would pick up the wrong thing.
//
// The backup codes are shown once and never again. That is not a UI choice: the
// server keeps only bcrypt hashes, so there is nothing to show a second time.
// The screen says so, and will not let someone leave until they confirm they
// have them.


import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, Copy, Download, ArrowRight, Check, Smartphone } from "lucide-react";
import { api } from "../services/api";
import { Button, CodeInput, Modal } from "./ui";

/* ═══════════════════════════ the flow ═══════════════════════════ */

function useEnrolment(token, active = true) {
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

  // Closing discards the attempt. Without this, a dialog opened a second time
  // would come back showing the FIRST enrolment's backup codes — which by then
  // are the wrong ones, since a fresh enrolment issues a new set.
  useEffect(() => {
    if (active) return;
    setStep("scan");
    setQr(null);
    setManualKey("");
    setCode("");
    setBackupCodes(null);
    setNewToken("");
    setSaved(false);
    setErr("");
  }, [active]);

  useEffect(() => {
    if (!active) return;
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
  }, [call, active]);

  const verify = useCallback(
    async (valueOverride) => {
      const entered = (valueOverride ?? code).replace(/\s+/g, "");
      if (entered.length < 6) return;
      setErr("");
      setBusy(true);
      try {
        const r = await call("/2fa/verify", { code: entered });
        setBackupCodes(r.backupCodes || []);
        setNewToken(r.token || "");
        setStep("codes");
      } catch (e) {
        setErr(e.message);
        setCode("");
      } finally {
        setBusy(false);
      }
    },
    [call, code]
  );

  const codesText = (backupCodes || []).join("\n");

  const copyCodes = useCallback(() => {
    navigator.clipboard?.writeText(codesText).then(
      () => toast.success("Backup codes copied"),
      () => toast.error("Could not copy — select and copy them by hand")
    );
  }, [codesText]);

  const downloadCodes = useCallback(() => {
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
  }, [codesText]);

  return {
    step, qr, manualKey, code, setCode, backupCodes, newToken,
    saved, setSaved, busy, err, verify, copyCodes, downloadCodes,
  };
}

/* ═══════════════════════════ pieces ═══════════════════════════ */

/** Scan the QR, or type the key. */
function ScanStep({ qr, manualKey, code, setCode, err, busy, onVerify }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
        <Smartphone size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
        <p className="text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
          Open Google Authenticator, Microsoft Authenticator, or any app that takes a six-digit
          code, scan this, then type the code it shows.
        </p>
      </div>

      {qr ? (
        <div className="flex flex-col items-center gap-3">
          {/* White plate regardless of theme: a QR inverted for dark mode is one
              many scanners will not read. */}
          <div className="rounded-2xl bg-white p-3.5 border border-[var(--border-default)] shadow-[var(--shadow-sm)]">
            <img src={qr} alt="Two-factor setup QR code" width={188} height={188} />
          </div>
          {manualKey && (
            <details className="w-full">
              <summary className="cursor-pointer text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]">
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
        <div className="h-[212px] animate-pulse rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]" />
      )}

      <div className="flex flex-col gap-2.5">
        <span className="text-[12px] font-medium tracking-tight text-[var(--fg-secondary)]">
          Code from your app
        </span>
        <CodeInput
          value={code}
          onChange={setCode}
          onComplete={(v) => onVerify(v)}
          disabled={busy || !qr}
          invalid={Boolean(err) && code.length === 0}
        />
      </div>

      {err && (
        <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--danger-fg)]">
          {err}
        </p>
      )}
    </div>
  );
}

/** The ten codes, shown once. */
function CodesStep({ backupCodes, saved, setSaved, copyCodes, downloadCodes }) {
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

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
        {(backupCodes || []).map((c, i) => (
          <div key={c} className="flex items-baseline gap-2.5">
            <span className="w-4 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[var(--fg-subtle)]">
              {i + 1}
            </span>
            <code className="font-mono text-[13.5px] tracking-[0.08em] text-[var(--fg-primary)]">
              {c}
            </code>
          </div>
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

      <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--fg-secondary)]">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 cursor-pointer accent-[var(--brand)]"
        />
        <span>I have saved these backup codes somewhere safe.</span>
      </label>
    </div>
  );
}

/* ═══════════════════════════ dialog (login) ═══════════════════════════ */

export function TwoFactorEnrolModal({
  open,
  token,
  onDone,
  onCancel,
  // The same dialog is opened mid-sign-in and from a signed-in profile page.
  // "Back to sign in" is a lie in the second case, and so is telling someone
  // the console requires this when they chose to turn it on themselves.
  intro = "This console requires a second factor. It takes a minute and only has to be done once.",
  cancelLabel = "Back to sign in",
  doneLabel = "Continue to the console",
}) {
  const f = useEnrolment(token, open);
  const onCodes = f.step === "codes";

  return (
    <Modal open={open} onClose={f.busy ? undefined : onCancel} width="sm" closeOnBackdrop={false}>
      <Modal.Header
        icon={onCodes ? Check : ShieldCheck}
        eyebrow={onCodes ? "Step 2 of 2" : "Step 1 of 2"}
        title={onCodes ? "Save your backup codes" : "Set up two-factor"}
        subtitle={
          onCodes
            ? "Two-factor is on. These get you in if your phone is lost or wiped."
            : intro
        }
        onClose={f.busy ? undefined : onCancel}
      />

      <Modal.Body className="!py-7">
        {onCodes ? <CodesStep {...f} /> : <ScanStep {...f} onVerify={f.verify} />}
      </Modal.Body>

      <Modal.Footer>
        {onCodes ? (
          <Button disabled={!f.saved} onClick={() => onDone?.(f.newToken)} iconRight={<ArrowRight size={15} />}>
            {doneLabel}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancel} disabled={f.busy}>
              {cancelLabel}
            </Button>
            <Button onClick={() => f.verify()} loading={f.busy} disabled={!f.qr || f.code.length < 6}>
              Turn on two-factor
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default TwoFactorEnrolModal;
