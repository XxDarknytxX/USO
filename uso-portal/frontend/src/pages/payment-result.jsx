/**
 * Payment result page — fetches transaction from backend, shows outcome
 */
import { useEffect, useState } from 'react';
import {
  FaCheckCircle,
  FaTimesCircle,
  FaSpinner,
  FaExclamationTriangle,
  FaArrowLeft,
  FaHeadset,
  FaWifi,
  FaTicketAlt,
  FaEnvelope,
} from 'react-icons/fa';

export default function PaymentResult() {
  const [status, setStatus] = useState({ text: 'Loading...', type: 'loading', success: false, description: '' });
  const [txn, setTxn] = useState(null);
  const [assist, setAssist] = useState(null);
  const [loading, setLoading] = useState(true);
  // Surfaced so a customer whose device did NOT auto-connect still leaves this
  // page holding the code they paid for.
  const [code, setCode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qp = new URLSearchParams(window.location.search || '');
        const hp = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
        const g = (k) => qp.get(k) ?? hp.get(k);
        const tID = g('tID'), rCode = g('rCode');

        // Cancelled
        if (rCode === '111') {
          setStatus({ text: 'Payment Cancelled', type: 'cancelled', success: false, description: 'No charges were applied.' });
          setLoading(false);
          setTimeout(() => (window.location.href = '/'), 1500);
          return;
        }

        if (!tID) {
          setStatus({ text: 'Transaction Not Found', type: 'error', success: false, description: 'No transaction ID in the URL.' });
          setLoading(false);
          return;
        }

        // ── Step 1: Trigger the payment callback if rCode is present ──
        // This is the critical step that claims the voucher and authenticates
        // with Ruijie. Previously handled by MainPage, but PortalGate now
        // blocks MainPage from rendering on payment return.
        let callbackData = null;
        if (rCode) {
          try {
            // Build callback params from URL (same as main-page.jsx did)
            const cp = new URLSearchParams(window.location.search || '');
            // Attach stored sessionId if not already in URL
            const sid = sessionStorage.getItem('wifiSessionId');
            if (sid && !cp.get('clientSessionId')) cp.set('clientSessionId', sid);

            const cbRes = await fetch(`/api/mpaisa/callback?${cp}`);
            const cbData = await cbRes.json();
            if (cbRes.ok && cbData.ok) {
              callbackData = cbData;
            } else {
              console.warn('[PaymentResult] Callback returned error:', cbData.error);
            }
          } catch (cbErr) {
            console.error('[PaymentResult] Callback failed:', cbErr.message);
          }

          // Clean up URL params after triggering callback
          window.history.replaceState({}, document.title, '/payment-result');
        }

        // ── Step 2: Fetch full transaction for display ──
        const res = await fetch(`/api/mpaisa/transaction/${tID}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.ok || !data.transaction) throw new Error('Not found');
        const t = data.transaction;
        if (cancelled) return; // page navigated away while loading

        // DB says cancelled
        if (t.status === 'payment_failed' && t.mpaisa_response_code === '111') {
          setStatus({ text: 'Payment Cancelled', type: 'cancelled', success: false, description: 'No charges were applied.' });
          setLoading(false);
          setTimeout(() => (window.location.href = '/'), 1500);
          return;
        }

        setTxn({
          id: t.id,
          amount: t.amount,
          plan: t.plan_id,
          phone: t.customer_phone_number,
          date: new Date(t.payment_completed_at || t.created_at).toLocaleString(),
        });

        // ── Step 3: Handle auth success redirect ──
        // Check callback response first, then fall back to transaction record
        const authSuccess = callbackData?.autoAuth?.success || (t.auth_success);
        const voucherCode = callbackData?.autoAuth?.voucherCode || t.voucher_code;
        const logonUrl = callbackData?.autoAuth?.logonUrl || t.auth_logon_url;
        if (voucherCode) setCode(voucherCode);

        if (voucherCode && authSuccess) {
          try { localStorage.setItem('uso_voucher_code', voucherCode); } catch (e) { /* */ }
          // Redirect after a short delay:
          // - If logonUrl exists, hit it first — this opens the Ruijie gateway
          //   and gives the device actual internet access. Ruijie then redirects
          //   to the configured post_url (/status).
          // - Otherwise fall back to the status page directly.
          setTimeout(() => {
            if (logonUrl) {
              window.location.replace(logonUrl);
            } else {
              window.location.href = `/status/${encodeURIComponent(voucherCode)}`;
            }
          }, 2500);
        }

        // ── Step 4: Determine display status ──
        // If callback gave us a clear result, use it; otherwise use transaction
        let info;
        if (callbackData) {
          // Use callback response for more accurate status
          if (callbackData.autoAuth?.success) {
            info = { text: 'You\'re Connected', type: 'success', success: true, description: 'Payment processed and plan activated. Redirecting to your data dashboard...', logonUrl };
          } else if (callbackData.manualAssistance?.required) {
            info = { text: 'Support Required', type: 'support', success: false, description: callbackData.manualAssistance.message || 'Payment processed but plan activation failed. Support will contact you.' };
          } else if (callbackData.paymentStatus === 'failed') {
            info = { text: 'Payment Failed', type: 'error', success: false, description: 'Check your details and try again.' };
          } else if (callbackData.autoAuth && !callbackData.autoAuth.success) {
            info = { text: 'Activation Issue', type: 'support', success: false, description: `Payment successful but: ${callbackData.autoAuth.error || 'activation failed'}. Contact support if needed.` };
          } else {
            info = resolve(t);
          }
        } else {
          info = resolve(t);
        }

        // Manual assistance check (for cases without callback data)
        if (!callbackData && t.status === 'payment_success' && t.auth_attempted && !t.auth_success) {
          try {
            const cr = await fetch(`/api/mpaisa/urgent-cases?transactionId=${tID}`);
            if (cr.ok) {
              const cd = await cr.json();
              if (cancelled) return;
              const ac = cd.cases?.find((c) => c.transaction_id === tID);
              if (ac) {
                setAssist({ id: ac.id, status: ac.status, error: ac.ruijie_error_message, wait: ac.minutes_waiting });
                info = {
                  text: 'Support Required',
                  type: 'support',
                  success: false,
                  description: `Payment processed but plan activation failed. Support will contact you at ${t.customer_phone_number || 'your number'} within 30 minutes.`,
                };
              }
            }
          } catch {}
        }

        if (!cancelled) setStatus(info);
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus({ text: 'Error', type: 'error', success: false, description: 'Unable to load transaction. Try refreshing or contact support.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resolve = (t) => {
    if (t.status === 'payment_failed' || t.mpaisa_response_code === '111')
      return { text: t.mpaisa_response_code === '111' ? 'Cancelled' : 'Payment Failed', type: 'error', success: false, description: t.mpaisa_response_code === '111' ? 'No charges applied.' : 'Check your details and try again.' };
    if (t.status === 'payment_success' && t.auth_success && t.auth_logon_url)
      return { text: 'You\'re Connected', type: 'success', success: true, description: 'Payment processed and plan activated. Redirecting to your data dashboard...', logonUrl: t.auth_logon_url };
    if (t.status === 'payment_success' && t.auth_success)
      return { text: 'You\'re Connected', type: 'success', success: true, description: 'Payment processed and plan activated. Redirecting to your data dashboard...' };
    if (t.status === 'payment_success' && !t.auth_attempted)
      return { text: 'Activating Plan', type: 'processing', success: false, description: 'Payment successful. Setting up your connection...' };
    if (['payment_initiated', 'initiated'].includes(t.status) || t.mpaisa_response_code === '100')
      return { text: 'Processing', type: 'pending', success: false, description: 'Confirming your payment...' };
    if (['handshake_failed', 'handshake_error'].includes(t.status))
      return { text: 'Service Error', type: 'error', success: false, description: 'Technical issue. Please try again.' };
    return { text: 'Unknown', type: 'error', success: false, description: `Status: ${t.status}` };
  };

  /* ── Visual config per status ──────────── */
  const cfg = {
    success:    { Icon: FaCheckCircle,         iconCls: 'text-emerald-400', ringCls: 'bg-emerald-500/10 border-emerald-500/20', barCls: 'bg-emerald-500' },
    processing: { Icon: FaSpinner,             iconCls: 'text-blue-400 animate-spin', ringCls: 'bg-blue-500/10 border-blue-500/20', barCls: 'bg-blue-500' },
    pending:    { Icon: FaSpinner,             iconCls: 'text-amber-400 animate-spin', ringCls: 'bg-amber-500/10 border-amber-500/20', barCls: 'bg-amber-500' },
    support:    { Icon: FaHeadset,             iconCls: 'text-amber-400', ringCls: 'bg-amber-500/10 border-amber-500/20', barCls: 'bg-amber-500' },
    cancelled:  { Icon: FaTimesCircle,         iconCls: 'text-ink-4', ringCls: 'bg-white/5 border-edge', barCls: 'bg-ink-4' },
    error:      { Icon: FaExclamationTriangle, iconCls: 'text-red-400', ringCls: 'bg-red-500/10 border-red-500/20', barCls: 'bg-red-500' },
    loading:    { Icon: FaSpinner,             iconCls: 'text-ink-4 animate-spin', ringCls: 'bg-white/5 border-edge', barCls: 'bg-ink-4' },
  };

  const c = cfg[status.type] || cfg.error;
  const showProgress = ['processing', 'pending', 'cancelled'].includes(status.type);

  /* ── Loading state ─────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center px-4 font-sans">
        <div className="flex flex-col items-center gap-4 animate-enter">
          <div className="w-8 h-8 border-[2.5px] border-edge border-t-ink-3 rounded-full animate-spin" />
          <p className="text-ink-4 text-sm">Loading transaction...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4 sm:px-6 py-10 font-sans">
      <div className="w-full max-w-md animate-enter">

        {/* ── Logo ──────────────────────────── */}
        <div className="flex justify-center mb-8">
          <img
            src="/images/logo.png"
            alt="Vodafone"
            className="h-10 w-auto opacity-60"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
          />
          <div className="hidden items-center gap-1.5 text-vf/60 font-bold text-lg">
            <FaWifi className="text-sm" /> vodafone
          </div>
        </div>

        {/* ── Status card ──────────────────── */}
        <div className="bg-card border border-edge rounded-2xl p-6 sm:p-8 mb-4">
          {/* Icon */}
          <div className="flex justify-center mb-5">
            <div className={`w-16 h-16 rounded-2xl border-2 flex items-center justify-center ${c.ringCls}`}>
              <c.Icon className={`text-2xl ${c.iconCls}`} />
            </div>
          </div>

          {/* Title / description */}
          <h1 className="text-2xl sm:text-[26px] font-bold text-ink text-center mb-2">{status.text}</h1>
          <p className="text-sm text-ink-3 text-center leading-relaxed max-w-xs mx-auto">{status.description}</p>

          {/* Progress bar */}
          {showProgress && (
            <div className="w-28 h-1 bg-edge rounded-full overflow-hidden mx-auto mt-6">
              <div className={`h-full rounded-full ${c.barCls}`} style={{ animation: 'progress 1.8s ease-in-out infinite' }} />
            </div>
          )}
        </div>

        {/* ── Voucher code ───────────────────
             Shown whenever a voucher was claimed, including when activation
             failed: that is exactly when the customer needs to enter it by
             hand, and this page is otherwise the last place they see it. */}
        {code && (
          <div className="bg-card border border-edge rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <FaTicketAlt className="text-vf text-xs" />
              <h3 className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Your voucher code</h3>
            </div>
            <div className="font-mono text-xl sm:text-2xl font-bold text-ink tracking-[0.12em] text-center break-all bg-white/[0.04] border border-edge rounded-xl py-3 px-2 mb-3">
              {code}
            </div>
            <p className="text-xs text-ink-4 leading-relaxed">
              Keep this code. If you are not connected automatically, reconnect to the Wi-Fi, then
              <span className="text-ink-3 font-medium"> scroll to the bottom of the portal page</span> and enter it to get online.
            </p>
            <p className="flex items-start gap-2 mt-2.5 text-[11.5px] text-ink-5 leading-relaxed">
              <FaEnvelope className="text-[10px] mt-[3px] shrink-0" />
              <span>If your M-PAiSA number has an email registered, a copy has been emailed to you.</span>
            </p>
          </div>
        )}

        {/* ── Transaction details ────────────── */}
        {txn && (
          <div className="bg-card border border-edge rounded-2xl p-5 mb-4">
            <h3 className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-3">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-4">
              {[
                ['Transaction ID', txn.id, true],
                ['Amount', `$${txn.amount}`],
                ['Plan', txn.plan],
                ['Date', txn.date],
              ].map(([label, val, mono]) => (
                <div key={label}>
                  <div className="text-xs text-ink-4 mb-0.5">{label}</div>
                  <div className={`text-sm text-ink font-medium ${mono ? 'font-mono text-xs' : ''}`}>{val || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Support case ───────────────────── */}
        {assist && (
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <FaHeadset className="text-amber-400 text-sm" />
              <span className="text-sm font-semibold text-amber-400">Support Case #{assist.id}</span>
            </div>
            <div className="space-y-2">
              {[
                ['Status', assist.status],
                ['Issue', assist.error],
                ['Estimated Wait', `${assist.wait} minutes`],
              ].map(([label, val]) => (
                <div key={label} className="flex items-baseline gap-2 text-sm">
                  <span className="text-ink-4 shrink-0">{label}:</span>
                  <span className="text-ink-3">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action ─────────────────────────── */}
        {status.type === 'error' && (
          <button
            onClick={() => (window.location.href = '/')}
            className="w-full flex items-center justify-center gap-2.5 bg-vf hover:bg-vf-hover
                       text-white text-sm font-semibold py-3.5 rounded-xl
                       transition-all duration-200 active:scale-[0.97]"
          >
            <FaArrowLeft className="text-[10px]" />
            Back to plans
          </button>
        )}
      </div>
    </div>
  );
}
