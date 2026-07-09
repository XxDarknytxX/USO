import { useState } from 'react';
import { FaTicketAlt, FaTimes, FaWifi } from 'react-icons/fa';

// Manual voucher login. A customer who already holds a voucher code — e.g. one
// reissued by support after a "paid but auth failed" (session-timeout) case —
// enters it here and is authenticated against their CURRENT captive-portal
// session. Reuses the same POST /api/auth/voucher path as the auto-auth and
// finalizes by visiting Ruijie's logonUrl.
//
// The whole point of this flow is that it uses a FRESH sessionId (from the
// reconnected device), not the dead one that caused the original failure.

// Prefer a sessionId in the CURRENT url — a genuine WiFi reconnect re-opens the
// portal with a brand-new one — over a possibly-stale sessionStorage value.
function freshSessionId() {
  const p = new URLSearchParams(window.location.search);
  return p.get('sessionId') || sessionStorage.getItem('wifiSessionId') || '';
}

const RECONNECT_MSG =
  'Your WiFi session expired. Disconnect and reconnect to the Vodafone WiFi, then reopen this page and enter your code again.';

export default function ManualVoucherLogin({ open, onClose }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reconnect, setReconnect] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const voucherCode = code.trim();
    if (!voucherCode || busy) return;
    setError(null);
    setReconnect(false);

    const sessionId = freshSessionId();
    if (!sessionId) {
      setReconnect(true);
      setError('Connect to the Vodafone WiFi first, then reopen this page and try again.');
      return;
    }

    setBusy(true);
    try {
      const r = await fetch('/api/auth/voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voucherCode, sessionId, source: 'manual' }),
      });
      const d = await r.json().catch(() => ({}));

      if (r.ok && d.ok) {
        // Visiting the Ruijie logonUrl is what actually opens the gateway.
        if (d.logonUrl) {
          window.location.replace(d.logonUrl);
          return;
        }
        window.location.assign(`/status/${encodeURIComponent(voucherCode)}`);
        return;
      }

      const msg = String(d.error || d.message || '').toLowerCase();
      if (/session|timed?\s*out|request limited|expired/.test(msg)) {
        setReconnect(true);
        setError(RECONNECT_MSG);
      } else {
        setError(d.error || "That voucher code didn't work. Check the code and try again.");
      }
    } catch (err) {
      setError("Network error — make sure you're on the Vodafone WiFi, then try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 font-sans" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-card border border-edge rounded-2xl p-6 sm:p-7 animate-enter">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-5 hover:text-ink-3 transition-colors"
          aria-label="Close"
        >
          <FaTimes />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-vf/10 border border-vf/15 flex items-center justify-center mb-4">
          <FaTicketAlt className="text-xl text-vf" />
        </div>
        <h2 className="text-[20px] font-bold text-ink tracking-tight mb-1">Log in with a voucher</h2>
        <p className="text-[13px] text-ink-3 leading-relaxed mb-5">
          Already have a voucher code? Enter it to get online — no payment needed.
        </p>

        <form onSubmit={submit}>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Voucher code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-page/60 border border-edge text-ink text-[15px] tracking-widest font-mono placeholder:text-ink-5 placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:border-vf transition-colors"
            autoFocus
          />

          {error && (
            <p className={`mt-3 text-[12.5px] leading-relaxed ${reconnect ? 'text-amber-400' : 'text-vf'}`}>
              {reconnect && <FaWifi className="inline mr-1.5 -mt-0.5" />}
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-5 w-full py-3 rounded-xl bg-vf hover:bg-vf-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-[15px] transition-colors flex items-center justify-center gap-2"
          >
            {busy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
