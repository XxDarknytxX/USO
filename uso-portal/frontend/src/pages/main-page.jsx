/**
 * Main WiFi portal — a proper pricing page: hero → category tabs → plan cards → pay
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCalendarDay, FaCalendarWeek, FaCalendarAlt, FaMobileAlt,
  FaCheckCircle, FaExclamationCircle, FaWifi, FaBolt, FaShieldAlt,
  FaCheck, FaArrowRight, FaInfinity,
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
const CAT_VALIDITY = { daily: 'day', weekly: 'week', monthly: 'month' };
const validityShort = (cat) => CAT_VALIDITY[cat] || 'plan';
const titleCase = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

export default function MainPage() {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(null);
  const [notification, setNotification] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [handledPayment, setHandledPayment] = useState(false);

  // Track notification/redirect timers so they're cleared if the page unmounts.
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

  // Derive ordered category tabs from the plans.
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
    <div className="min-h-screen min-h-[100dvh] font-sans flex flex-col">

      {/* ═══════ TOP BAR ═══════ */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-page/60 border-b border-edge/60">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/images/logo.png"
              alt="Vodafone"
              className="h-7 w-auto"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
            />
            <div className="hidden items-center gap-1.5 text-vf font-extrabold text-lg">
              <FaWifi className="text-base" /> vodafone
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            WiFi connected
          </span>
        </div>
      </header>

      <main className="flex-1">
        {/* ═══════ HERO ═══════ */}
        <section className="relative overflow-hidden">
          {/* decorative orbs */}
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[420px] rounded-full blur-[120px] opacity-50"
            style={{ background: 'radial-gradient(circle, rgba(230,0,0,0.28), transparent 70%)' }} />
          <div className="relative w-full max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-10 sm:pb-14 text-center">
            <span className="inline-block text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.22em] text-vf mb-4 animate-enter">
              Vodafone WiFi
            </span>
            <h1 className="text-[34px] sm:text-[52px] lg:text-[60px] font-extrabold text-ink tracking-[-0.03em] leading-[1.03] animate-enter"
              style={{ animationDelay: '60ms' }}>
              Get online in
              <br className="hidden sm:block" />{' '}
              <span className="bg-gradient-to-r from-vf via-[#ff3b3b] to-[#ff7a7a] bg-clip-text text-transparent">seconds.</span>
            </h1>
            <p className="text-ink-3 text-[15px] sm:text-[17px] leading-relaxed max-w-xl mx-auto mt-5 animate-enter"
              style={{ animationDelay: '130ms' }}>
              Pick a data plan, pay with M-PAiSA, and you're connected instantly.
              No contracts, no setup fees.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-7 text-[12.5px] text-ink-4 animate-enter"
              style={{ animationDelay: '200ms' }}>
              <span className="flex items-center gap-1.5"><FaBolt className="text-vf/80 text-[11px]" /> Instant activation</span>
              <span className="flex items-center gap-1.5"><FaShieldAlt className="text-vf/80 text-[11px]" /> Secure network</span>
              <span className="flex items-center gap-1.5"><FaWifi className="text-vf/80 text-[11px]" /> Calls &amp; texts included</span>
            </div>
          </div>
        </section>

        {/* ═══════ PRICING ═══════ */}
        <section id="plans" className="w-full max-w-6xl mx-auto px-5 sm:px-8 pb-14 sm:pb-20">
          {/* Section heading + tabs */}
          <div className="flex flex-col items-center text-center mb-8 sm:mb-10">
            <h2 className="text-[22px] sm:text-[28px] font-bold text-ink tracking-tight mb-5">Choose your plan</h2>
            {categories.length > 0 && (
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-card/70 border border-edge">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`px-4 sm:px-6 py-2 rounded-lg text-[13px] font-semibold capitalize transition-all duration-200
                      ${activeCat === c.id
                        ? 'bg-vf text-white shadow-md shadow-vf/20'
                        : 'text-ink-3 hover:text-ink'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Plan cards */}
          {plansLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-80 rounded-2xl bg-card/40 border border-edge animate-pulse" />
              ))}
            </div>
          ) : visiblePlans.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visiblePlans.map((plan, i) => (
                <PricingCard key={plan.id} plan={plan} index={i} onBuy={handleBuy} onError={showError} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-card border border-edge flex items-center justify-center mx-auto mb-3">
                <FaWifi className="text-ink-5 text-lg" />
              </div>
              <p className="text-ink-4 mb-3 text-sm">No plans available right now</p>
              <button onClick={loadPlans} className="text-sm font-semibold text-vf hover:text-vf-hover transition-colors">
                Try again
              </button>
            </div>
          )}
        </section>

        {/* ═══════ WHY VODAFONE ═══════ */}
        <section className="border-t border-edge/60 bg-card/20">
          <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
              {[
                { icon: FaBolt, title: 'Instant activation', desc: 'Pay with M-PAiSA and you’re online in seconds — no waiting, no setup.' },
                { icon: FaShieldAlt, title: 'Secure & reliable', desc: 'An enterprise-grade network with full coverage you can count on.' },
                { icon: FaWifi, title: 'Calls & texts included', desc: 'Every plan comes with unlimited calls and texts on Vodafone.' },
              ].map(({ icon: FIcon, title, desc }) => (
                <div key={title} className="text-center sm:text-left">
                  <span className="inline-flex w-11 h-11 rounded-xl bg-vf/10 border border-vf/15 items-center justify-center text-vf mb-4">
                    <FIcon className="text-lg" />
                  </span>
                  <h3 className="text-[15px] font-bold text-ink mb-1.5">{title}</h3>
                  <p className="text-[13px] text-ink-4 leading-relaxed max-w-xs mx-auto sm:mx-0">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-edge">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink-5 text-[12px]">
            <FaWifi className="text-vf/60 text-[11px]" />
            <span>Vodafone Fiji WiFi</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-ink-5 text-[12px]">
            <span>No setup fees</span>
            <span className="text-ink-5/50">•</span>
            <span>Secure payments</span>
            <span className="text-ink-5/50">•</span>
            <span>24/7 support</span>
          </div>
        </div>
      </footer>

      {/* ═══════ TOAST ═══════ */}
      {notification && <Toast type={notification.type} message={notification.message} exit={notification.exit} />}
    </div>
  );
}

/* ── Pricing card ── */
function PricingCard({ plan, index = 0, onBuy, onError }) {
  const [busy, setBusy] = useState(false);
  const Icon = iconFor(plan.icon);
  const popular = Boolean(plan.popular);
  const features = Array.isArray(plan.features) ? plan.features : [];

  const buy = async () => {
    setBusy(true);
    try { await onBuy(plan); }
    catch (e) { onError?.(e.message || 'Purchase failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div
      className={`group relative flex flex-col rounded-2xl p-6 sm:p-7 animate-enter transition-all duration-300
        ${popular
          ? 'border border-vf/45 bg-gradient-to-b from-vf/[0.13] to-card shadow-[0_0_44px_-14px_rgba(230,0,0,0.45)] lg:scale-[1.04] z-10'
          : 'border border-edge bg-card/60 backdrop-blur-sm hover:border-vf/30 hover:-translate-y-1'}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-vf text-white text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-vf/30 whitespace-nowrap">
          Most popular
        </div>
      )}

      {/* Icon + data allowance */}
      <div className="flex items-center justify-between mb-5">
        <span className="w-11 h-11 rounded-xl bg-vf/10 border border-vf/15 flex items-center justify-center text-vf">
          <Icon className="text-lg" />
        </span>
        {plan.data && (
          <span className="text-[12px] font-bold text-ink-2 bg-white/[0.05] border border-edge px-2.5 py-1 rounded-lg">
            {plan.data}
          </span>
        )}
      </div>

      {/* Name + description */}
      <h3 className="text-[19px] font-bold text-ink mb-1">{plan.name}</h3>
      {plan.description && (
        <p className="text-[13px] text-ink-4 leading-relaxed mb-5 line-clamp-2">{plan.description}</p>
      )}
      {!plan.description && <div className="mb-5" />}

      {/* Price */}
      <div className="flex items-baseline gap-1.5 mb-6">
        <span className="text-[34px] font-extrabold text-ink tracking-tight leading-none">{plan.price}</span>
        <span className="text-[13px] text-ink-5 font-medium">/ {validityShort(plan.category)}</span>
      </div>

      {/* Features */}
      {features.length > 0 ? (
        <ul className="space-y-2.5 mb-6 flex-1">
          {features.slice(0, 5).map((f, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] text-ink-3">
              <FaCheck className="text-vf text-[10px] mt-[3px] shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      {/* CTA */}
      <button
        onClick={buy}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-2 rounded-xl text-sm font-semibold py-3 transition-all duration-200 outline-none
          ${busy
            ? 'bg-white/5 text-ink-5 cursor-not-allowed'
            : popular
              ? 'bg-vf hover:bg-vf-hover text-white active:scale-[0.98] shadow-lg shadow-vf/25'
              : 'bg-white/[0.06] hover:bg-white/[0.11] text-ink border border-edge active:scale-[0.98]'}`}
      >
        {busy ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Processing…
          </>
        ) : (
          <>Get this plan <FaArrowRight className="text-[10px]" /></>
        )}
      </button>
    </div>
  );
}

function Toast({ type, message, exit }) {
  const ok = type === 'ok';
  return (
    <div className={`fixed top-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all duration-300
      ${ok ? 'bg-emerald-950/95 border-emerald-800/40 text-emerald-200' : 'bg-red-950/95 border-red-800/40 text-red-200'}
      ${exit ? 'opacity-0 translate-y-[-20px] scale-95' : 'opacity-100 translate-y-0 scale-100 animate-pop'}`}
    >
      {ok ? <FaCheckCircle className="text-emerald-400 shrink-0" /> : <FaExclamationCircle className="text-red-400 shrink-0" />}
      <span className="flex-1">{message}</span>
    </div>
  );
}
