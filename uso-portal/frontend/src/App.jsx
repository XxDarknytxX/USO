// src/App.jsx
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { FaWifi } from 'react-icons/fa';
import AuthHandler from './components/auth-handler';
import MainPage from './pages/main-page';
import PaymentResult from './pages/payment-result';
import VoucherStatus from './pages/voucher-status';

/* ================================================================ */
/*  PortalGate — controls access to the purchase page (/)           */
/*                                                                    */
/*  1. No sessionId → "Connect to WiFi" page                         */
/*  2. Has clientMac with active voucher → re-auth & redirect         */
/*  3. Otherwise → show MainPage normally                             */
/* ================================================================ */

// Module-level guard: prevents duplicate Ruijie auth calls from
// React StrictMode double-mount or rapid re-renders which trigger
// Ruijie's "request limited" rate-limiter.
let _reAuthInFlight = null; // Promise | null

function PortalGate() {
  const [searchParams] = useSearchParams();
  const [gate, setGate] = useState('loading'); // 'loading' | 'allowed' | 'no-session' | 'redirect'
  const [redirectCode, setRedirectCode] = useState(null);
  const [logonUrl, setLogonUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // Read from URL params first, fall back to sessionStorage
    const urlMac = searchParams.get('clientMac') || searchParams.get('usermac') || searchParams.get('mac');
    const urlSession = searchParams.get('sessionId');

    // Persist to sessionStorage if present in URL
    if (urlSession) sessionStorage.setItem('wifiSessionId', urlSession);
    if (urlMac) sessionStorage.setItem('deviceMac', urlMac);

    const sessionId = urlSession || sessionStorage.getItem('wifiSessionId');
    const clientMac = urlMac || sessionStorage.getItem('deviceMac');

    // Helper: check if a voucher code is still active AND has usable data/time.
    // Returns false for expired, disabled (admin-deactivated), or fully-consumed
    // vouchers so the gate falls through to the purchase page instead of
    // reconnecting + bouncing to the status page.
    const isVoucherActive = async (code) => {
      try {
        const r = await fetch(`/api/voucher-status/${encodeURIComponent(code)}`);
        if (r.ok) {
          const d = await r.json();
          if (!d.ok || !d.isActive || d.isExpired || d.disabled) return false;
          if (String(d.status) === '3') return false; // expired status code
          // Also check remaining data and time — if fully consumed, not usable
          if (d.remainingQuota !== undefined && d.remainingQuota <= 0 && d.quota > 0) return false;
          if (d.remainingTime !== undefined && d.remainingTime <= 0 && d.timePeriod > 0) return false;
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    };

    // Helper: re-authenticate a voucher with the current (possibly new) sessionId.
    // Reuses the existing POST /api/auth/voucher endpoint which talks to Ruijie.
    // Uses a module-level guard so concurrent calls (e.g. React StrictMode
    // double-mount) share a single in-flight request instead of hitting
    // Ruijie twice and triggering "request limited".
    const reAuthWithRuijie = async (voucherCode, sid) => {
      // If a request is already in-flight, piggyback on it
      if (_reAuthInFlight) return _reAuthInFlight;

      const doAuth = async () => {
        try {
          const r = await fetch('/api/auth/voucher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voucherCode, sessionId: sid }),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.ok) return { success: true, logonUrl: d.logonUrl || null };
          }
          return { success: false };
        } catch (e) {
          return { success: false };
        } finally {
          _reAuthInFlight = null;
        }
      };

      _reAuthInFlight = doAuth();
      return _reAuthInFlight;
    };

    const check = async () => {
      // Gate 0: No session at all → must connect to WiFi first
      // Check this BEFORE voucher lookups — even if the user has an active
      // voucher, they can't use the internet without being on the WiFi network.
      if (!sessionId) {
        if (!cancelled) setGate('no-session');
        return;
      }

      // Track codes we've already checked to avoid redundant API calls
      const checkedCodes = new Set();

      // Gate 1: Has MAC → check for existing active voucher via backend
      if (clientMac) {
        try {
          const macRes = await fetch(`/api/voucher-by-mac/${encodeURIComponent(clientMac)}`);
          if (macRes.ok) {
            const macData = await macRes.json();
            if (macData.ok && macData.voucherCode) {
              checkedCodes.add(macData.voucherCode);
              if (await isVoucherActive(macData.voucherCode)) {
                // Re-authenticate the voucher with the current (possibly new) sessionId
                // so Ruijie grants internet access for this captive portal session
                const authResult = await reAuthWithRuijie(macData.voucherCode, sessionId);
                if (!cancelled) {
                  if (authResult.success) {
                    if (authResult.logonUrl) setLogonUrl(authResult.logonUrl);
                    setRedirectCode(macData.voucherCode);
                    setGate('redirect');
                  } else {
                    // Re-auth failed — voucher may be expired on Ruijie side
                    // Clear cache and fall through to show purchase page
                    localStorage.removeItem('uso_voucher_code');
                  }
                }
                if (authResult.success) return;
                // Auth failed — fall through to Gate 2 / Gate 3
              }
              // Voucher found by MAC but no longer active — clear it from localStorage too
              const cached = localStorage.getItem('uso_voucher_code');
              if (cached === macData.voucherCode) {
                localStorage.removeItem('uso_voucher_code');
              }
            }
          }
        } catch (e) { /* MAC lookup failed, fall through */ }
      }

      // Gate 2: Check localStorage for a previously purchased voucher
      // (covers the case where device revisits without MAC in URL)
      const cachedCode = localStorage.getItem('uso_voucher_code');
      if (cachedCode && !checkedCodes.has(cachedCode)) {
        if (await isVoucherActive(cachedCode)) {
          // Re-authenticate the cached voucher with the current sessionId
          const authResult = await reAuthWithRuijie(cachedCode, sessionId);
          if (!cancelled) {
            if (authResult.success) {
              if (authResult.logonUrl) setLogonUrl(authResult.logonUrl);
              setRedirectCode(cachedCode);
              setGate('redirect');
            } else {
              // Re-auth failed — clear cache and fall through to purchase page
              localStorage.removeItem('uso_voucher_code');
            }
          }
          if (authResult.success) return;
          // Auth failed — fall through to Gate 3
        } else {
          // Voucher expired/inactive — clear stale cache
          localStorage.removeItem('uso_voucher_code');
        }
      } else if (cachedCode && checkedCodes.has(cachedCode)) {
        // Already checked this code via MAC — it's inactive, clear it
        localStorage.removeItem('uso_voucher_code');
      }

      // Gate 3: Session exists, no active voucher → allow purchase
      if (!cancelled) setGate('allowed');
    };

    check();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading state
  if (gate === 'loading') {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
        <div className="flex flex-col items-center gap-4 animate-enter">
          <div className="w-10 h-10 border-[3px] border-edge border-t-vf rounded-full animate-spin" />
          <p className="text-ink-3 text-sm">Checking your connection...</p>
        </div>
      </div>
    );
  }

  // No session → "Connect to WiFi" page
  if (gate === 'no-session') {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-5 font-sans">
        <div className="w-full max-w-sm text-center animate-enter">
          <div className="flex justify-center mb-7">
            <img
              src="/images/logo.png"
              alt="Vodafone"
              className="h-8 w-auto opacity-80"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
            />
            <div className="hidden items-center gap-1.5 text-vf font-extrabold text-lg">
              <FaWifi className="text-base" /> vodafone
            </div>
          </div>
          <div className="bg-card/70 backdrop-blur-sm border border-edge rounded-2xl p-7 sm:p-8">
            <div className="w-16 h-16 rounded-2xl bg-vf/10 border border-vf/15 flex items-center justify-center mx-auto mb-5">
              <FaWifi className="text-2xl text-vf" />
            </div>
            <h1 className="text-[22px] sm:text-[24px] font-bold text-ink tracking-tight mb-2">Connect to WiFi</h1>
            <p className="text-[13.5px] sm:text-sm text-ink-3 leading-relaxed">
              Join the <span className="text-vf font-semibold">Vodafone WiFi</span> network to browse and buy data plans.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Active voucher found → redirect (via Ruijie logonUrl if available, else status page)
  if (gate === 'redirect' && redirectCode) {
    if (logonUrl) {
      // Redirect to Ruijie's logon URL to finalize internet access.
      // Ruijie will then redirect the device to the configured post_url (/status).
      window.location.replace(logonUrl);
      return (
        <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
          <div className="flex flex-col items-center gap-4 animate-enter">
            <div className="w-10 h-10 border-[3px] border-edge border-t-vf rounded-full animate-spin" />
            <p className="text-ink-3 text-sm">Reconnecting you to the internet...</p>
          </div>
        </div>
      );
    }
    return <Navigate to={`/status/${redirectCode}`} replace />;
  }

  // Allowed → show the normal purchase page
  return <MainPage />;
}

/* ================================================================ */
/*  StatusRedirect — /status → /status/<code>                        */
/*                                                                    */
/*  Strategy (waterfall — first match wins):                          */
/*    1. clientMac in URL → GET /api/voucher-by-mac/:mac              */
/*    2. localStorage 'uso_voucher_code'                              */
/*    3. Fallback: GET /api/latest-voucher                            */
/* ================================================================ */
function StatusRedirect() {
  const [searchParams] = useSearchParams();
  const clientMac = searchParams.get('clientMac') || searchParams.get('usermac') || searchParams.get('mac');
  const cached = localStorage.getItem('uso_voucher_code');

  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      // 1. MAC-based lookup (highest priority — unique to the device)
      if (clientMac) {
        try {
          const r = await fetch(`/api/voucher-by-mac/${encodeURIComponent(clientMac)}`);
          if (r.ok) {
            const d = await r.json();
            if (d.ok && d.voucherCode) {
              localStorage.setItem('uso_voucher_code', d.voucherCode);
              if (!cancelled) { setCode(d.voucherCode); setLoading(false); }
              return;
            }
          }
        } catch (e) { /* fall through */ }
      }

      // 2. localStorage instant check
      if (cached) {
        if (!cancelled) { setCode(cached); setLoading(false); }
        return;
      }

      // 3. Fallback: latest authenticated voucher from DB
      try {
        const r = await fetch('/api/latest-voucher');
        if (r.ok) {
          const d = await r.json();
          if (d.ok && d.voucherCode) {
            localStorage.setItem('uso_voucher_code', d.voucherCode);
            if (!cancelled) { setCode(d.voucherCode); setLoading(false); }
            return;
          }
        }
      } catch (e) { /* fall through */ }

      // Nothing found
      if (!cancelled) setLoading(false);
    };

    resolve();
    return () => { cancelled = true; };
  }, [clientMac, cached]);

  if (code) {
    return <Navigate to={`/status/${code}`} replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
        <div className="flex flex-col items-center gap-4 animate-enter">
          <div className="w-8 h-8 border-[2.5px] border-edge border-t-ink-3 rounded-full animate-spin" />
          <p className="text-ink-4 text-sm">Finding your voucher...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
      <div className="text-center animate-enter">
        <h1 className="text-2xl font-bold text-ink mb-2">No Voucher Found</h1>
        <p className="text-sm text-ink-3">Scan your QR code or enter your voucher URL to check usage.</p>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  App — Root router                                                */
/* ================================================================ */
function App() {
  return (
    <Router>
      <AuthHandler>
        <Routes>
          <Route path="/" element={<PortalGate />} />
          <Route path="/payment-result" element={<PaymentResult />} />
          <Route path="/status" element={<StatusRedirect />} />
          <Route path="/status/:voucherCode" element={<VoucherStatus />} />
        </Routes>
      </AuthHandler>
    </Router>
  );
}

export default App;
