// src/components/TwoFactorVerifyModal.jsx
//
// The sign-in challenge, as a dialog over the login screen rather than a second
// page. The account is already identified by this point — replacing the whole
// screen implies you have left the sign-in and started something else, when in
// fact you are halfway through one attempt. A modal keeps that attempt visibly
// in progress, and dismissing it lands you back where you were.
//
// The temp token lives in the parent's state and is passed in, never stored:
// it is a half-finished login, and anything written to localStorage outlives
// the attempt it belongs to.

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, KeyRound, ArrowRight, RotateCw } from "lucide-react";
import { api } from "../services/api";
import { Modal, Button, CodeInput, Field, Input } from "./ui";

/** Seconds until the current 30-second TOTP step rolls over. */
function secondsLeftInStep() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export default function TwoFactorVerifyModal({
  open,
  tempToken,
  email,
  onSuccess,
  onCancel,
}) {
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttl, setTtl] = useState(secondsLeftInStep);
  const backupRef = useRef(null);

  // Reset on close so a reopened dialog never shows the previous attempt's
  // digits or its error.
  useEffect(() => {
    if (open) return;
    setCode("");
    setBackupCode("");
    setUseBackup(false);
    setErr("");
  }, [open]);

  useEffect(() => {
    if (!open || useBackup) return;
    const t = setInterval(() => setTtl(secondsLeftInStep()), 1000);
    return () => clearInterval(t);
  }, [open, useBackup]);

  useEffect(() => {
    if (useBackup) backupRef.current?.focus();
  }, [useBackup]);

  async function submit(valueOverride) {
    const entered = (valueOverride ?? (useBackup ? backupCode : code))
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!entered) return;
    setErr("");
    setLoading(true);
    try {
      const r = await api("/2fa/login-verify", {
        method: "POST",
        body: { tempToken, code: entered },
      });
      onSuccess?.(r);
    } catch (e) {
      setErr(e.message);
      // Clearing the slots is the difference between "try again" and "edit the
      // thing that just failed" — the code has rotated anyway.
      if (!useBackup) setCode("");
    } finally {
      setLoading(false);
    }
  }

  const ready = useBackup ? backupCode.trim().length >= 6 : code.length === 6;

  return (
    <Modal open={open} onClose={loading ? undefined : onCancel} width="sm" closeOnBackdrop={false}>
      <Modal.Header
        icon={ShieldCheck}
        eyebrow="Two-step verification"
        title={useBackup ? "Enter a backup code" : "Enter your code"}
        subtitle={
          useBackup
            ? "One of the ten single-use codes you saved when you set this up."
            : email
              ? `From the authenticator app on the phone you set up for ${email}.`
              : "From the authenticator app you set up for this account."
        }
        onClose={loading ? undefined : onCancel}
      />

      <Modal.Body className="!py-7">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex flex-col gap-5"
        >
          {useBackup ? (
            <Field label="Backup code" required>
              <div className="relative">
                <KeyRound
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none"
                />
                <Input
                  ref={backupRef}
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                  placeholder="A1B2C3D4"
                  autoComplete="off"
                  spellCheck={false}
                  className="pl-10 h-12 font-mono text-[15px] tracking-[0.22em] uppercase"
                />
              </div>
            </Field>
          ) : (
            <>
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={(v) => submit(v)}
                disabled={loading}
                // Red while the slots are empty says "that was rejected";
                // red over freshly typed digits would accuse the new code.
                invalid={Boolean(err) && code.length === 0}
                autoFocus={open}
              />
              <div className="flex items-center gap-2 text-[11.5px] text-[var(--fg-muted)]">
                <RotateCw size={12} className="shrink-0" />
                <span>
                  Your app shows a new code in{" "}
                  <span className="font-mono tabular-nums text-[var(--fg-secondary)]">{ttl}s</span>
                  {" "}— either one will work.
                </span>
              </div>
            </>
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

          <button
            type="button"
            onClick={() => { setUseBackup((v) => !v); setErr(""); }}
            className="self-start text-[12.5px] font-medium text-[var(--brand-fg-on-soft)] hover:underline pointer-coarse:-my-2 pointer-coarse:min-h-9"
          >
            {useBackup ? "Use my authenticator app instead" : "I can't reach my authenticator app"}
          </button>

          {/* Submits the form on Enter without adding a second visible button */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          Back to sign in
        </Button>
        <Button
          onClick={() => submit()}
          loading={loading}
          disabled={!ready}
          iconRight={!loading && <ArrowRight size={15} />}
        >
          Verify
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
