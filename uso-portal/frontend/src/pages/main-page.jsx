/**
 * Main WiFi portal — light, modern pricing page: centered logo → tabs → plan cards → pay
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCalendarDay, FaCalendarWeek, FaCalendarAlt, FaMobileAlt,
  FaCheckCircle, FaExclamationCircle, FaWifi, FaBolt, FaShieldAlt,
  FaCheck, FaInfinity, FaArrowRight,
} from 'react-icons/fa';

const ICON_MAP = {
  'fas fa-calendar-day': FaCalendarDay,
  'fas fa-calendar-week': FaCalendarWeek,
  'fas fa-calendar-alt': FaCalendarAlt,
  'fas fa-mobile-alt': FaMobileAlt,
  'fas fa-bolt': FaBolt,
  'fas fa-wifi': FaWifi,
  'fas fa-infinity': FaInfinity,
};
const iconFor = (s) => ICON_MAP[s] || FaWifi;

const CAT_ORDER = ['daily', 'weekly', 'monthly', 'custom'];
const CAT_PERIOD = { daily: 'day', weekly: 'week', monthly: 'month' };
const periodOf = (cat) => CAT_PERIOD[cat] || 'plan';
const titleCase = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

export default function MainPage() {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(null);
  const [notification, setNotification] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [handledPayment, setHandledPayment] = useState(false);

  const timersRef = useRef([]);
  const track = (id) => { timersRef.current.push(id); return id; };
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  useEffect(() => {
    loadPlans();
    const p = new URLSearchParams(window.location.search);
    const sid = p.get('sessionId');
    if (sid) { sessionStorage.setItem('wifiSessionId', sid); setSessionId(sid); }
    else { const s = sessionStorage.getItem('wifiSessionId'); if (s) setSessionId(s); }
    const mac = p.get('clientMac') || p.get('usermac') || p.get('mac');
    if (mac) { sessionStorage.setItem('deviceMac', mac); }
    if (p.get('tID') && p.get('rCode')) handlePaymentCallback(p);
  }, []); // eslint-disable-line

  const loadPlans = async () => {
    setPlansLoading(true);
    try {
      const r = await fetch('/api/plans');
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPlans(Array.isArray(data) ? data : []);
    } catch {
      showError('Failed to load plans. Please refresh.');
    } finally {
      setPlansLoading(false);
    }
  };

  const categories = useMemo(() => {
    const groups = {};
    for (const p of plans) (groups[p.category] ||= []).push(p);
    const known = CAT_ORDER.filter((c) => groups[c]);
    const extra = Object.keys(groups).filter((c) => !CAT_ORDER.includes(c));
    return [...known, ...extra].map((c) => ({ id: c, name: titleCase(c), count: groups[c].length }));
  }, [plans]);

  useEffect(() => {
    if (!activeCat && categories.length) setActiveCat(categories[0].id);
  }, [categories, activeCat]);

  const visiblePlans = useMemo(
    () => (activeCat ? plans.filter((p) => p.category === activeCat) : plans),
    [plans, activeCat]
  );

  const handlePaymentCallback = async (urlParams) => {
    if (handledPayment) return;
    const tID = urlParams.get('tID'), rCode = urlParams.get('rCode');
    if (!tID) { showError('Invalid payment response.'); return; }
    setHandledPayment(true); showSuccess('Processing payment...');
    try {
      const cp = new URLSearchParams(urlParams.toString());
      const sid = sessionStorage.getItem('wifiSessionId');
      if (sid && !cp.get('clientSessionId')) cp.set('clientSessionId', sid);
      const res = await fetch(`/api/mpaisa/callback?${cp}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Processing failed');
      if (rCode === '101') {
        if (d.autoAuth?.success) {
          showSuccess('Connected! Redirecting...');
          if (d.autoAuth.logonUrl) track(setTimeout(() => window.location.replace(d.autoAuth.logonUrl), 2500));
          else showSuccess('You now have network access.');
        } else if (d.manualAssistance?.required) showError(d.manualAssistance.message || 'Activation needs assistance.');
        else showError(`Payment OK but ${d.autoAuth?.error || 'auth failed'}. Contact support.`);
      } else showError(`${d.paymentStatus === 'failed' ? 'Payment failed' : 'Cancelled'}. Try again.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) { console.error(e); showError('Unable to process. Contact support if charged.'); window.history.replaceState({}, document.title, window.location.pathname); }
  };

  const handleBuy = async (plan) => {
    const sid = sessionStorage.getItem('wifiSessionId');
    if (!sid) { showError('Session expired. Refresh and try again.'); return; }
    const mac = sessionStorage.getItem('deviceMac') || null;
    const res = await fetch('/api/mpaisa/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: String(plan.price).replace('$', ''), planId: plan.id, sessionId: sid, clientMac: mac }),
    });
    const p = await res.json();
    if (!res.ok) throw new Error(p?.error || 'Failed to start payment');
    if (!p.paymentUrl) throw new Error('No payment URL');
    window.location.href = p.paymentUrl;
  };

  const showSuccess = (m) => { setNotification({ type: 'ok', message: m }); track(setTimeout(dismiss, 5000)); };
  const showError = (m) => { setNotification({ type: 'err', message: m }); track(setTimeout(dismiss, 6000)); };
  const dismiss = () => { setNotification(p => p ? { ...p, exit: true } : null); track(setTimeout(() => setNotification(null), 400)); };

  return (
    <div className="relative min-h-screen min-h-[100dvh] font-sans overflow-hidden text-slate-900
                    bg-[linear-gradient(135deg,#ffe4e6_0%,#fdf2f8_28%,#f5f3ff_55%,#ffe4e6_100%)]">
      {/* soft pastel orbs for depth */}
      <div className="pointer-events-none absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full blur-[120px] opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(230,0,0,0.16), transparent 70%)' }} />
      <div className="pointer-events-none absolute top-1/3 -right-32 w-[460px] h-[460px] rounded-full blur-[130px] opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.14), transparent 70%)' }} />

      <div className="relative flex flex-col min-h-screen min-h-[100dvh]">
        {/* ═══════ HEADER — centered logo ═══════ */}
        <header className="w-full px-5 pt-9 sm:pt-12 flex flex-col items-center">
          <img
            src="/images/logo.png"
            alt="Vodafone"
            className="h-9 sm:h-11 w-auto animate-enter"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
          />
          <div className="hidden items-center gap-2 text-vf font-extrabold text-2xl animate-enter">
            <FaWifi className="text-xl" /> vodafone
          </div>
          <span className="mt-4 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-white/70 backdrop-blur border border-emerald-200 text-emerald-600 text-[11px] font-semibold shadow-sm animate-enter">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Connected to Vodafone WiFi
          </span>
        </header>

        {/* ═══════ HERO ═══════ */}
        <div className="text-center px-5 pt-8 sm:pt-10 pb-7">
          <h1 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.025em] leading-[1.05] text-slate-900 animate-enter"
            style={{ animationDelay: '60ms' }}>
            Choose your <span className="text-vf">data plan</span>
          </h1>
          <p className="text-slate-500 text-[14px] sm:text-[16px] mt-3 max-w-md mx-auto animate-enter" style={{ animationDelay: '120ms' }}>
            Pick a plan, pay with M-PAiSA, and you’re online in seconds.
          </p>
        </div>

        {/* ═══════ TABS ═══════ */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 pb-14">
          {categories.length > 0 && (
            <div className="flex justify-center mb-9 sm:mb-11">
              <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/70 backdrop-blur border border-white shadow-sm">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`px-5 sm:px-7 py-2 rounded-full text-[13px] font-bold capitalize transition-all duration-200
                      ${activeCat === c.id
                        ? 'bg-vf text-white shadow-md shadow-vf/25'
                        : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══════ PLAN CARDS ═══════ */}
          {plansLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 max-w-6xl mx-auto">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[420px] rounded-3xl bg-white/60 border border-white animate-pulse" />
              ))}
            </div>
          ) : visiblePlans.length > 0 ? (
            <div className={`grid gap-6 mx-auto items-stretch
              ${visiblePlans.length >= 4 ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 max-w-6xl'
                : visiblePlans.length === 3 ? 'grid-cols-1 sm:grid-cols-3 max-w-5xl'
                : visiblePlans.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl'
                : 'grid-cols-1 max-w-sm'}`}>
              {visiblePlans.map((plan, i) => (
                <PricingCard key={plan.id} plan={plan} index={i} onBuy={handleBuy} onError={showError} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center mx-auto mb-3">
                <FaWifi className="text-slate-300 text-lg" />
              </div>
              <p className="text-slate-500 mb-3 text-sm">No plans available right now</p>
              <button onClick={loadPlans} className="text-sm font-bold text-vf hover:text-vf-hover transition-colors">
                Try again
              </button>
            </div>
          )}
        </main>

        {/* ═══════ FOOTER ═══════ */}
        <footer className="w-full px-5 pb-8 pt-2">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-slate-400 text-[12px]">
            <span className="flex items-center gap-1.5"><FaBolt className="text-vf/70 text-[11px]" /> Instant activation</span>
            <span className="text-slate-300">•</span>
            <span className="flex items-center gap-1.5"><FaShieldAlt className="text-vf/70 text-[11px]" /> Secure payments</span>
            <span className="text-slate-300">•</span>
            <span className="flex items-center gap-1.5"><FaWifi className="text-vf/70 text-[11px]" /> Calls &amp; texts included</span>
          </div>
        </footer>
      </div>

      {notification && <Toast type={notification.type} message={notification.message} exit={notification.exit} />}
    </div>
  );
}

/* ── Pricing card (light, ribbon-style) ── */
function PricingCard({ plan, index = 0, onBuy, onError }) {
  const [busy, setBusy] = useState(false);
  const Icon = iconFor(plan.icon);
  const popular = Boolean(plan.popular);
  const period = periodOf(plan.category);

  const features = [
    plan.data ? `${plan.data} data` : null,
    ...(Array.isArray(plan.features) ? plan.features : []),
    'Unlimited calls & texts',
  ].filter(Boolean).slice(0, 6);

  const buy = async () => {
    setBusy(true);
    try { await onBuy(plan); }
    catch (e) { onError?.(e.message || 'Purchase failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div
      className={`relative flex flex-col rounded-3xl bg-white px-7 pt-8 pb-7 transition-all duration-300 animate-enter
        ${popular
          ? 'ring-2 ring-vf shadow-[0_30px_60px_-18px_rgba(230,0,0,0.35)] xl:scale-[1.04] z-10'
          : 'border border-white shadow-[0_24px_50px_-24px_rgba(15,23,42,0.30)] hover:-translate-y-1.5 hover:shadow-[0_34px_64px_-24px_rgba(15,23,42,0.38)]'}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-vf text-white text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-vf/30 whitespace-nowrap">
          Most popular
        </div>
      )}

      {/* Title */}
      <div className="text-center">
        <span className="inline-flex w-12 h-12 rounded-2xl bg-vf/10 items-center justify-center text-vf mb-3">
          <Icon className="text-xl" />
        </span>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-400">{plan.name}</h3>
      </div>

      {/* Price ribbon (left-attached banner) */}
      <div className="mt-5 mb-6">
        <div className="inline-flex flex-col items-start text-white rounded-r-2xl rounded-bl-2xl -ml-7 pl-7 pr-7 py-3.5 bg-gradient-to-r from-vf to-[#ff3b3b] shadow-lg shadow-vf/25">
          <span className="text-[28px] font-extrabold leading-none tracking-tight">{plan.price}</span>
          <span className="text-[11px] font-medium text-white/85 mt-1">per {period}</span>
        </div>
      </div>

      {/* Features */}
      <ul className="space-y-3 flex-1 mb-7">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-600">
            <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
              <FaCheck className="text-emerald-500 text-[8px]" />
            </span>
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={buy}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-2 rounded-xl text-sm font-bold py-3.5 transition-all duration-200 outline-none
          ${busy
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : popular
              ? 'bg-vf hover:bg-vf-hover text-white shadow-lg shadow-vf/30 active:scale-[0.98]'
              : 'bg-slate-900 hover:bg-vf text-white active:scale-[0.98]'}`}
      >
        {busy ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Processing…
          </>
        ) : (
          <>Subscribe <FaArrowRight className="text-[10px]" /></>
        )}
      </button>
    </div>
  );
}

function Toast({ type, message, exit }) {
  const ok = type === 'ok';
  return (
    <div className={`fixed top-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all duration-300
      ${ok ? 'bg-white border-emerald-200 text-emerald-700' : 'bg-white border-red-200 text-red-700'}
      ${exit ? 'opacity-0 translate-y-[-20px] scale-95' : 'opacity-100 translate-y-0 scale-100 animate-pop'}`}
    >
      {ok ? <FaCheckCircle className="text-emerald-500 shrink-0" /> : <FaExclamationCircle className="text-red-500 shrink-0" />}
      <span className="flex-1">{message}</span>
    </div>
  );
}
