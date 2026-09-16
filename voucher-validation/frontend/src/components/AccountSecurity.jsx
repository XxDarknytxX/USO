// src/components/AccountSecurity.jsx
//
// The signed-in person's own security controls: their password, and their
// second factor.
//
// This exists because the estate policy defaults to OFF. Without a voluntary
// path, the only way anyone could ever get a second factor would be for an
// administrator to switch enforcement on for everybody first — which is exactly
// the order you do not want, since the administrator doing the switching should
// be enrolled before they lock anyone else in.
//
// Everything destructive here is behind a dialog that asks for the password.
// Turning off a second factor with a session cookie alone is a gift to whoever
// is sitting at an unlocked laptop.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  ShieldCheck, ShieldOff, KeyRound, Lock, Eye, EyeOff, AlertTriangle, Check, Copy,
} from "lucide-react";

import { twoFactorApi } from "../services/api";
import { Panel, Button, Modal, Field, Input, StatusPill, Skeleton } from "./ui";
import { TwoFactorEnrolModal } from "./TwoFactorEnrol";

/* ───────────────────────── change password ───────────────────────── */

function PasswordModal({ open, forced, onClose, onDone }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) return;
    setCurrent(""); setNext(""); setConfirm(""); setErr(""); setShow(false);
  }, [open]);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = next.length >= 8 && next === confirm && (forced || current.length > 0);

  async function submit(e) {
    e?.preventDefault();
    if (!ready) return;
    setErr("");
    setBusy(true);
    try {
      // On a forced change the server does not ask for the current password —
      // the person just signed in with the temporary one from the email, and
      // making them re-type it proves nothing.
      await twoFactorApi.changePassword(forced ? undefined : current, next);
      toast.success("Password changed");
      onDone?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy || forced ? undefined : onClose} width="sm" closeOnBackdrop={!forced}>
      <Modal.Header
        icon={KeyRound}
        eyebrow={forced ? "Required" : "Your account"}
        title={forced ? "Choose a new password" : "Change your password"}
        subtitle={
          forced
            ? "You signed in with a temporary password. Pick your own before you carry on."
            : "At least eight characters. You stay signed in on this device."
        }
        onClose={busy || forced ? undefined : onClose}
      />
      <Modal.Body>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!forced && (
            <Field label="Current password" required>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
                <Input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="pl-10 h-11"
                  autoFocus
                />
              </div>
            </Field>
          )}

          <Field
            label="New password"
            required
            error={tooShort ? "At least eight characters" : undefined}
          >
            <div className="relative">
              <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
              <Input
                type={show ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                className="pl-10 pr-11 h-11"
                autoFocus={forced}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          <Field label="Confirm new password" required error={mismatch ? "These do not match" : undefined}>
            <div className="relative">
              <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
              <Input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="pl-10 h-11"
              />
            </div>
          </Field>

          {err && (
            <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--danger-fg)]">
              {err}
            </p>
          )}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal.Body>
      <Modal.Footer>
        {!forced && (
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        )}
        <Button onClick={submit} loading={busy} disabled={!ready}>
          Change password
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/* ───────────────────────── turn 2FA off ───────────────────────── */

function DisableModal({ open, required, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) { setPassword(""); setErr(""); }
  }, [open]);

  async function submit(e) {
    e?.preventDefault();
    if (!password) return;
    setErr("");
    setBusy(true);
    try {
      await twoFactorApi.disable(password);
      toast.success("Two-factor is off for your account");
      onDone?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="sm">
      <Modal.Header
        icon={ShieldOff}
        eyebrow="Your account"
        title="Turn off two-factor"
        subtitle="Your password alone will get into this account afterwards."
        onClose={busy ? undefined : onClose}
      />
      <Modal.Body>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {required && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3.5 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
              <p className="text-[12.5px] leading-relaxed text-[var(--warning-fg)]">
                Two-factor is required across this console. You will be asked to set it up again the
                next time you sign in, with a new secret and a new set of backup codes.
              </p>
            </div>
          )}
          <Field label="Confirm with your password" required>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pl-10 h-11"
                autoFocus
              />
            </div>
          </Field>
          {err && (
            <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--danger-fg)]">
              {err}
            </p>
          )}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it on</Button>
        <Button variant="danger" onClick={submit} loading={busy} disabled={!password}>
          Turn it off
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/* ──────────────────── replace the backup codes ──────────────────── */

function BackupCodesModal({ open, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) return;
    setPassword(""); setCodes(null); setSaved(false); setErr("");
  }, [open]);

  async function submit(e) {
    e?.preventDefault();
    if (!password) return;
    setErr("");
    setBusy(true);
    try {
      const r = await twoFactorApi.regenerateBackupCodes(password);
      setCodes(r.backupCodes || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const text = (codes || []).join("\n");

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="sm" closeOnBackdrop={!codes}>
      <Modal.Header
        icon={codes ? Check : KeyRound}
        eyebrow="Your account"
        title={codes ? "Your new backup codes" : "Replace your backup codes"}
        subtitle={
          codes
            ? "The old ones stopped working the moment these were made. Your authenticator app is unchanged."
            : "Ten fresh codes, and every code you have now stops working. Your authenticator app is not affected."
        }
        onClose={busy ? undefined : onClose}
      />
      <Modal.Body>
        {codes ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3">
              <p className="text-[13px] font-semibold text-[var(--warning-fg)]">
                Save these now — they are not shown again
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--warning-fg)] opacity-90">
                Only hashes are kept on the server, so nobody can show them to you later.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              {codes.map((c, i) => (
                <div key={c} className="flex items-baseline gap-2.5">
                  <span className="w-4 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[var(--fg-subtle)]">
                    {i + 1}
                  </span>
                  <code className="font-mono text-[13.5px] tracking-[0.08em] text-[var(--fg-primary)]">{c}</code>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Copy size={14} />}
                onClick={() =>
                  navigator.clipboard?.writeText(text).then(
                    () => toast.success("Backup codes copied"),
                    () => toast.error("Could not copy — select and copy them by hand")
                  )
                }
              >
                Copy
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
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Confirm with your password" required>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pl-10 h-11"
                  autoFocus
                />
              </div>
            </Field>
            {err && (
              <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--danger-fg)]">
                {err}
              </p>
            )}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
          </form>
        )}
      </Modal.Body>
      <Modal.Footer>
        {codes ? (
          <Button disabled={!saved} onClick={() => { onDone?.(); onClose?.(); }}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={!password}>
              Replace them
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}

/* ───────────────────────── the panel ───────────────────────── */

export default function AccountSecurity({ forcePasswordChange = false, onPasswordChanged }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await twoFactorApi.status());
    } catch (e) {
      toast.error("Could not read your security settings: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (forcePasswordChange) setPwOpen(true); }, [forcePasswordChange]);

  const on = !!status?.enabled;
  const low = on && (status?.backupCodesRemaining ?? 10) <= 2;

  return (
    <>
      <Panel
        title="Security"
        subtitle="Your password and your second factor."
        icon={<ShieldCheck size={15} />}
        tone={on ? "green" : "slate"}
      >
        {loading ? (
          <Skeleton className="h-[120px] w-full rounded-xl" />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Two-factor */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-semibold text-[var(--fg-primary)]">
                    Two-factor authentication
                  </p>
                  <StatusPill tone={on ? "success" : "neutral"} dot={false}>
                    {on ? <Check size={11} /> : null}
                    {on ? "On" : "Off"}
                  </StatusPill>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
                  {on
                    ? `A code from your authenticator app is needed at every sign-in. ${
                        status?.backupCodesRemaining ?? 0
                      } backup code${status?.backupCodesRemaining === 1 ? "" : "s"} left.`
                    : status?.requiredEstateWide
                      ? "Required across this console — you will be asked to set it up at your next sign-in. Doing it now is easier."
                      : "A code from an authenticator app, in addition to your password."}
                </p>
                {low && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--warning-fg)]">
                    <AlertTriangle size={12} className="shrink-0" />
                    Running low — replace them below for a fresh set of ten.
                  </p>
                )}
              </div>
              {/* While the estate requires two-factor the server refuses to
                  turn it off, so the button is not offered — a control whose
                  only outcome is an error is worse than no control. */}
              {on && status?.requiredEstateWide ? (
                <span className="shrink-0 text-right text-[11.5px] leading-snug text-[var(--fg-muted)]">
                  Required for
                  <br />
                  every account
                </span>
              ) : (
                <Button
                  variant={on ? "secondary" : "primary"}
                  size="sm"
                  onClick={() => (on ? setDisableOpen(true) : setEnrolOpen(true))}
                  iconLeft={on ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                >
                  {on ? "Turn off" : "Turn on"}
                </Button>
              )}
            </div>

            {on && (
              <>
                <div className="h-px bg-[var(--border-subtle)]" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-[var(--fg-primary)]">Backup codes</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
                      {status?.backupCodesRemaining ?? 0} left of ten. Replacing them makes a fresh set and
                      stops the old ones working — your authenticator app is unaffected.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCodesOpen(true)}
                    iconLeft={<KeyRound size={14} />}
                  >
                    Replace
                  </Button>
                </div>
              </>
            )}

            <div className="h-px bg-[var(--border-subtle)]" />

            {/* Password */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-[var(--fg-primary)]">Password</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
                  Changing it here does not sign you out anywhere.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPwOpen(true)} iconLeft={<KeyRound size={14} />}>
                Change
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* Enrolment reuses the login dialog with no explicit token, so it runs
          on the stored session. */}
      <TwoFactorEnrolModal
        open={enrolOpen}
        token={undefined}
        intro={
          status?.requiredEstateWide
            ? "Required across this console — doing it now saves being stopped at your next sign-in."
            : "A code from an authenticator app, on top of your password. It takes a minute."
        }
        cancelLabel="Cancel"
        doneLabel="Done"
        onDone={() => { setEnrolOpen(false); load(); }}
        onCancel={() => setEnrolOpen(false)}
      />
      <DisableModal
        open={disableOpen}
        required={!!status?.requiredEstateWide}
        onClose={() => setDisableOpen(false)}
        onDone={() => { setDisableOpen(false); load(); }}
      />
      <BackupCodesModal
        open={codesOpen}
        onClose={() => setCodesOpen(false)}
        onDone={load}
      />
      <PasswordModal
        open={pwOpen}
        forced={forcePasswordChange}
        onClose={() => setPwOpen(false)}
        onDone={() => { setPwOpen(false); onPasswordChanged?.(); }}
      />
    </>
  );
}
