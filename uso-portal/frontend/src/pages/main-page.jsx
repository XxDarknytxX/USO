/**
 * Main WiFi portal — elegant dark pricing: 3 category cards → plans modal → pay
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheck, FaArrowRight, FaTimes, FaWifi, FaStar, FaLock,
  FaCheckCircle, FaExclamationCircle,
} from 'react-icons/fa';

const CAT_ORDER = ['daily', 'weekly', 'monthly', 'custom'];
const CAT_PERIOD = { daily: 'day', weekly: 'week', monthly: 'month' };
const CAT_DESC = {
  daily: 'Quick connectivity for when you need it most.',
  weekly: 'Reliable data to keep you online all week.',
  monthly: 'Best value for always-on, everyday internet.',
  custom: 'Tailored plans to suit your needs.',
};
const periodOf = (cat) => CAT_PERIOD[cat] || 'plan';
const titleCase = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
const priceNum = (p) => parseFloat(String(p).replace(/[^0-9.]/g, '')) || 0;

export default function MainPage() {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState(null);
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

  // Aggregate plans into category cards (name, from-price, count, points, plans).
  const categories = useMemo(() => {
    const groups = {};
    for (const p of plans) (groups[p.category] ||= []).push(p);
    const order = [
      ...CAT_ORDER.filter((c) => groups[c]),
      ...Object.keys(groups).filter((c) => !CAT_ORDER.includes(c)),
    ];
    return order.map((c) => {
      const ps = groups[c];
      const min = Math.min(...ps.map((p) => priceNum(p.price)));
      return {
        id: c,
        name: titleCase(c),
        desc: CAT_DESC[c] || 'Flexible plans to suit your needs.',
        fromPrice: `$${min.toFixed(2)}`,
        period: periodOf(c),
        count: ps.length,
        hasPopular: ps.some((p) => p.popular),
        points: [
          `${ps.length} plan${ps.length > 1 ? 's' : ''} to choose from`,
          `Valid for a ${periodOf(c)}`,
          'Unlimited calls & texts',
        ],
        plans: ps,
      };
    });
  }, [plans]);

  // Feature the category that holds a "popular" plan, else the middle one.
  const featuredId = useMemo(() => {
    const pop = categories.find((c) => c.hasPopular);
    if (pop) return pop.id;
    return categories[Math.floor(categories.length / 2)]?.id ?? null;
  }, [categories]);

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
    <div className="relative min-h-screen min-h-[100dvh] font-sans flex flex-col overflow-hidden text-ink">
      {/* soft top glow */}
      <div className="pointer-events-none absolute -top-44 left-1/2 -translate-x-1/2 w-[min(760px,120vw)] h-[520px] rounded-full blur-[150px] opacity-35"
        style={{ background: 'radial-gradient(circle, rgba(230,0,0,0.28), transparent 70%)' }} />

      <main className="relative flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-[clamp(24px,5vh,60px)] pb-12">
        {/* Logo */}
        <div className="flex justify-center mb-[clamp(20px,4vh,44px)] animate-enter">
          <img
            src="/images/logo.png"
            alt="Vodafone"
            className="h-[clamp(44px,7.5vw,68px)] w-auto"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
          />
          <div className="hidden items-center gap-2.5 text-vf font-extrabold text-[clamp(26px,5vw,38px)]">
            <FaWifi className="text-[0.85em]" /> vodafone
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-[clamp(28px,6vh,64px)]">
          <p className="text-ink-4 text-[clamp(12.5px,1.6vw,15px)] mb-3 animate-enter">Stay connected on Vodafone WiFi</p>
          <h1 className="text-[clamp(27px,5.2vw,50px)] font-extrabold text-ink tracking-[-0.03em] leading-[1.05] animate-enter px-2"
            style={{ animationDelay: '60ms' }}>
            Choose the plan that&apos;s <span className="text-vf">right for you</span>
          </h1>
        </div>

        {/* Category cards */}
        {plansLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-7 xl:gap-8 max-w-6xl mx-auto">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[440px] rounded-3xl bg-white/[0.03] border border-edge animate-pulse" />
            ))}
          </div>
        ) : categories.length > 0 ? (
          <div className={`grid gap-5 lg:gap-7 xl:gap-8 items-stretch mx-auto
            ${categories.length >= 3 ? 'grid-cols-1 md:grid-cols-3 max-w-6xl'
              : categories.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-4xl'
              : 'grid-cols-1 max-w-md'}`}>
            {categories.map((cat, i) => (
              <CategoryCard
                key={cat.id}
                cat={cat}
                featured={cat.id === featuredId}
                index={i}
                onOpen={() => setSelectedCat(cat)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-edge flex items-center justify-center mx-auto mb-3">
              <FaWifi className="text-ink-5 text-lg" />
            </div>
            <p className="text-ink-4 mb-3 text-sm">No plans available right now</p>
            <button onClick={loadPlans} className="text-sm font-semibold text-vf hover:text-vf-hover transition-colors">
              Try again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative w-full px-5 pb-9 pt-2">
        <div className="flex items-center justify-center gap-2 text-ink-5 text-[12.5px]">
          <FaLock className="text-[10px] text-ink-4" />
          <span>Secured by M-PAiSA</span>
          <span className="text-ink-5/60">·</span>
          <span>Instant activation</span>
          <span className="text-ink-5/60">·</span>
          <span>No setup fees</span>
        </div>
      </footer>

      {/* Modal */}
      {selectedCat && (
        <PlansModal
          category={selectedCat}
          featured={selectedCat.id === featuredId}
          onClose={() => setSelectedCat(null)}
          onBuy={handleBuy}
          onError={showError}
        />
      )}

      {notification && <Toast type={notification.type} message={notification.message} exit={notification.exit} />}
    </div>
  );
}

/* ── Category card (elegant, glass for the featured one) ── */
function CategoryCard({ cat, featured, index = 0, onOpen }) {
  return (
    <div className={`relative pt-3 ${featured ? 'md:-my-6 md:z-10' : ''}`}>
      {featured && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-vf flex items-center justify-center shadow-[0_12px_30px_-6px_rgba(230,0,0,0.7)] ring-[6px] ring-page">
          <FaStar className="text-white text-[15px]" />
        </div>
      )}
      <button
        onClick={onOpen}
        className={`group w-full h-full text-left rounded-3xl p-6 sm:p-7 lg:p-8 xl:p-10 flex flex-col animate-enter transition-all duration-300
          ${featured
            ? 'bg-white/[0.07] backdrop-blur-md border border-white/15 shadow-[0_36px_90px_-30px_rgba(0,0,0,0.85)]'
            : 'bg-white/[0.02] border border-edge hover:bg-white/[0.045] hover:border-edge-hover'}`}
        style={{ animationDelay: `${index * 90}ms` }}
      >
        <h2 className="text-[23px] lg:text-[26px] xl:text-[29px] font-bold text-ink mb-2 capitalize tracking-tight">{cat.name}</h2>
        <p className="text-ink-4 text-[13.5px] lg:text-[14px] leading-relaxed mb-6 lg:mb-8 md:min-h-[44px]">{cat.desc}</p>

        {/* From price */}
        <div className="flex items-baseline gap-1.5 mb-6 lg:mb-8">
          <span className="text-ink-4 text-[12.5px] mr-0.5">from</span>
          <span className="text-[42px] lg:text-[46px] xl:text-[52px] font-extrabold text-vf leading-none tracking-tight">{cat.fromPrice}</span>
          <span className="text-ink-4 text-[14px]">/ {cat.period}</span>
        </div>

        {/* What you get */}
        <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-ink-3 mb-4">What you get</div>
        <ul className="space-y-3 lg:space-y-3.5 mb-7 lg:mb-9 flex-1">
          {cat.points.map((p, i) => (
            <li key={i} className="flex items-start gap-3 text-[13.5px] lg:text-[14px] text-ink-2">
              <FaCheck className="text-vf text-[11px] mt-[3px] shrink-0" />
              <span className="leading-snug">{p}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <span className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-3.5 lg:py-4 text-[14.5px] lg:text-[15px] font-semibold transition-all duration-200
          ${featured
            ? 'bg-vf text-white group-hover:bg-vf-hover shadow-lg shadow-vf/25'
            : 'bg-white/[0.05] text-ink border border-edge group-hover:bg-white/[0.1] group-hover:border-edge-hover'}`}>
          View {cat.count} plan{cat.count !== 1 ? 's' : ''}
          <FaArrowRight className="text-[10px] transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </button>
    </div>
  );
}

/* ── Plans modal ── */
function PlansModal({ category, featured, onClose, onBuy, onError }) {
  const [show, setShow] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => setShow(true));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line
  }, []);

  const close = () => { setShow(false); closeTimer.current = setTimeout(onClose, 250); };
  const plans = category.plans || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" onClick={close}>
      <div className={`absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`} />

      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full sm:max-w-4xl max-h-[92vh] max-h-[92dvh] flex flex-col overflow-hidden
                    rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl transition-all duration-300
                    ${show ? 'opacity-100 translate-y-0 sm:scale-100' : 'opacity-0 translate-y-10 sm:translate-y-3 sm:scale-[0.98]'}`}
        style={{ background: 'linear-gradient(180deg, #140b0d 0%, #0c0709 100%)' }}
      >
        {/* glow */}
        <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full blur-[90px] opacity-50"
          style={{ background: 'radial-gradient(circle, rgba(230,0,0,0.20), transparent 70%)' }} />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 sm:px-7 py-4 sm:py-5 border-b border-white/[0.06] shrink-0">
          <div>
            <p className="text-ink-4 text-[12px] mb-0.5">{category.count} plan{category.count !== 1 ? 's' : ''} available</p>
            <h2 className="text-[22px] sm:text-[26px] font-extrabold text-ink capitalize leading-tight tracking-tight">
              {category.name} plans
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-white/5 border border-edge flex items-center justify-center text-ink-4 hover:text-ink hover:bg-white/10 hover:border-edge-hover transition-all shrink-0"
          >
            <FaTimes />
          </button>
        </div>

        {/* Body */}
        <div className="relative p-4 sm:p-6 lg:p-7 overflow-y-auto">
          <div className={`grid gap-4 sm:gap-5
            ${plans.length >= 3 ? 'md:grid-cols-3'
              : plans.length === 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto'
              : 'max-w-sm mx-auto'}`}>
            {plans.map((plan) => (
              <ModalPlanCard key={plan.id} plan={plan} popular={Boolean(plan.popular)} onBuy={onBuy} onError={onError} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── A single plan card inside the modal ── */
function ModalPlanCard({ plan, popular, onBuy, onError }) {
  const [busy, setBusy] = useState(false);
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
    <div className={`relative flex flex-col rounded-2xl p-6 transition-all duration-300
      ${popular
        ? 'bg-white/[0.06] border border-vf/40 shadow-[0_0_40px_-16px_rgba(230,0,0,0.4)]'
        : 'bg-white/[0.02] border border-edge'}`}>
      {popular && (
        <span className="absolute top-4 right-4 px-2 py-0.5 rounded-full bg-vf/15 text-vf text-[10px] font-bold uppercase tracking-wide border border-vf/25">
          Popular
        </span>
      )}

      <h3 className="text-[19px] font-bold text-ink mb-1 tracking-tight">{plan.name}</h3>
      {plan.description && (
        <p className="text-ink-4 text-[12.5px] leading-relaxed mb-5 line-clamp-2">{plan.description}</p>
      )}
      {!plan.description && <div className="mb-5" />}

      <div className="flex items-baseline gap-1.5 mb-6">
        <span className="text-[34px] font-extrabold text-vf leading-none tracking-tight">{plan.price}</span>
        <span className="text-ink-4 text-[13px]">/ {period}</span>
      </div>

      <ul className="space-y-2.5 flex-1 mb-6">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <FaCheck className="text-vf text-[9px] mt-[3px] shrink-0" />
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={buy}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-2 rounded-xl text-sm font-semibold py-3 transition-all duration-200 outline-none
          ${busy
            ? 'bg-white/5 text-ink-5 cursor-not-allowed'
            : popular
              ? 'bg-vf hover:bg-vf-hover text-white shadow-lg shadow-vf/25 active:scale-[0.98]'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-ink border border-edge active:scale-[0.98]'}`}
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
