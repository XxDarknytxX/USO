/**
 * Main WiFi portal — elegant dark pricing: 3 category cards → plans modal → pay
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheck, FaArrowRight, FaTimes, FaWifi, FaStar, FaLock, FaBolt,
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

// Plan `data` is stored raw — e.g. "8192 / 10080s" means 8192 MB of data and
// 10080 min of validity. Customers should just see the data figure ("8 GB");
// the validity is already conveyed by "Valid for a <period>". These helpers
// normalise whatever's in the field (bare MB number, "8 GB", "Unlimited", …).
const dataToGB = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/unlimited/i.test(s)) return Infinity;
  const m = s.match(/\d+(?:\.\d+)?/); // first number = the data quota
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!isFinite(n) || n <= 0) return null;
  if (/tb/i.test(s)) return n * 1024;
  if (/gb/i.test(s)) return n;
  return n / 1024; // a bare number is megabytes
};
const gbLabel = (g) =>
  g === Infinity ? 'Unlimited data'
    : g >= 1 ? `${Number.isInteger(g) ? g : g.toFixed(1)} GB`
    : `${Math.round(g * 1024)} MB`;
const formatData = (raw) => {
  const g = dataToGB(raw);
  return g == null ? null : gbLabel(g);
};
// A single line summarising the data span across a category's plans.
const dataRangeLabel = (ps = []) => {
  const gbs = ps.map((p) => dataToGB(p.data)).filter((n) => n != null && n !== Infinity);
  if (ps.some((p) => dataToGB(p.data) === Infinity) && !gbs.length) return 'Unlimited high-speed data';
  if (!gbs.length) return 'High-speed data included';
  const lo = Math.min(...gbs), hi = Math.max(...gbs);
  const num = (g) => (Number.isInteger(g) ? `${g}` : g.toFixed(1));
  return lo === hi
    ? `${gbLabel(hi)} of high-speed data`
    : `${num(lo)}–${num(hi)} GB of high-speed data`;
};

export default function MainPage() {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState(null);
  const [notification, setNotification] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [handledPayment, setHandledPayment] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState(null);

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
          dataRangeLabel(ps),
          `Valid for a ${periodOf(c)}`,
          'Instant activation, no contracts',
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

    // Hand off to M-PAiSA. On iOS — especially inside the WiFi captive
    // pop-up (Captive Network Assistant) — a redirect issued AFTER an `await`
    // is no longer tied to the original tap, so the browser blocks it and the
    // screen just freezes. We show a hand-off screen whose main button is a
    // real <a> link (a direct user gesture iOS allows). Desktop/Android, which
    // don't enforce this, navigate automatically.
    setRedirectUrl(p.paymentUrl);
    const ua = navigator.userAgent || '';
    const isAppleMobile = /iPad|iPhone|iPod/.test(ua)
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!isAppleMobile) {
      setTimeout(() => { try { window.location.assign(p.paymentUrl); } catch { /* manual link */ } }, 60);
    }
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

      {redirectUrl && <PaymentHandoff url={redirectUrl} onCancel={() => setRedirectUrl(null)} />}
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

  // Modal hugs its content so it stays symmetric no matter the plan count.
  const widthClass = plans.length >= 3 ? 'sm:max-w-4xl'
    : plans.length === 2 ? 'sm:max-w-3xl'
    : 'sm:max-w-md';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" onClick={close}>
      <div className={`absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`} />

      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${widthClass} max-h-[92vh] max-h-[92dvh] flex flex-col overflow-hidden
                    rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl transition-all duration-300
                    ${show ? 'opacity-100 translate-y-0 sm:scale-100' : 'opacity-0 translate-y-10 sm:translate-y-3 sm:scale-[0.98]'}`}
        style={{ background: 'linear-gradient(180deg, #140b0d 0%, #0c0709 100%)' }}
      >
        {/* glow */}
        <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full blur-[90px] opacity-50"
          style={{ background: 'radial-gradient(circle, rgba(230,0,0,0.20), transparent 70%)' }} />

        {/* Header */}
        <div className="relative flex items-start justify-between gap-4 px-5 sm:px-8 pt-5 pb-4 sm:pt-7 sm:pb-6 border-b border-white/[0.06] shrink-0">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-vf/15 border border-vf/25 text-vf text-[11px] font-semibold mb-2.5">
              <FaWifi className="text-[9px]" /> {category.count} {category.count === 1 ? 'plan' : 'plans'} available
            </span>
            <h2 className="text-[23px] sm:text-[28px] font-extrabold text-ink capitalize leading-[1.1] tracking-tight">
              {category.name} plans
            </h2>
            <p className="text-ink-4 text-[12.5px] sm:text-[13.5px] mt-1.5 leading-relaxed max-w-md">
              {category.desc}
            </p>
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
          <div className={`grid gap-4 sm:gap-5 items-stretch
            ${plans.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3'
              : plans.length === 2 ? 'sm:grid-cols-2'
              : 'grid-cols-1 max-w-sm mx-auto'}`}>
            {plans.map((plan) => (
              <ModalPlanCard key={plan.id} plan={plan} popular={Boolean(plan.popular)} onBuy={onBuy} onError={onError} />
            ))}
          </div>
        </div>

        {/* Trust footer */}
        <div className="relative shrink-0 px-5 sm:px-8 py-3.5 border-t border-white/[0.06] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-ink-5 text-[11.5px]">
          <FaLock className="text-[9px] text-ink-4" />
          <span>Secured by M-PAiSA</span>
          <span className="text-ink-5/50">·</span>
          <span>Instant activation</span>
          <span className="text-ink-5/50">·</span>
          <span>No setup fees</span>
        </div>
      </div>
    </div>
  );
}

/* ── A single plan card inside the modal ── */
function ModalPlanCard({ plan, popular, onBuy, onError }) {
  const [busy, setBusy] = useState(false);
  const period = periodOf(plan.category);
  const dataLabel = formatData(plan.data);

  // These are prepaid data plans — never advertise calls/texts, even if a stale
  // feature snuck into the DB. Prefer real admin-set features, then sensible,
  // accurate defaults; de-dupe and cap the list.
  const adminFeatures = (Array.isArray(plan.features) ? plan.features : [])
    .filter((f) => f && !/unlimited\s*(calls?|texts?|sms|minutes?|talk)/i.test(f));
  const features = [...new Set([
    ...adminFeatures,
    `Valid for one ${period}`,
    'Instant activation',
    'No contracts or setup fees',
  ])].slice(0, 4);

  const buy = async () => {
    setBusy(true);
    try { await onBuy(plan); }
    catch (e) { onError?.(e.message || 'Purchase failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1
      ${popular
        ? 'border border-vf/50 bg-gradient-to-b from-vf/[0.15] via-vf/[0.03] to-transparent shadow-[0_30px_70px_-32px_rgba(230,0,0,0.65)]'
        : 'border border-edge bg-white/[0.02] hover:bg-white/[0.04] hover:border-edge-hover'}`}>

      {/* Popular ribbon */}
      {popular && (
        <div className="flex items-center justify-center gap-1.5 h-8 bg-vf text-white text-[10.5px] font-bold uppercase tracking-[0.14em] shrink-0">
          <FaStar className="text-[9px]" /> Most popular
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 sm:p-7">
        {/* Name + blurb */}
        <h3 className="text-[20px] font-bold text-ink tracking-tight">{plan.name}</h3>
        <p className="text-ink-4 text-[12.5px] leading-relaxed mt-1 mb-5 line-clamp-2 min-h-[34px]">
          {plan.description || `Stay connected for a full ${period}.`}
        </p>

        {/* Data hero — the headline for a data plan */}
        {dataLabel && (
          <div className="mb-5 flex items-center gap-3.5 rounded-2xl border border-vf/20 bg-gradient-to-br from-vf/[0.12] to-white/[0.015] px-4 py-3.5">
            <span className="w-10 h-10 rounded-xl bg-vf/20 border border-vf/30 flex items-center justify-center shrink-0">
              <FaBolt className="text-vf text-[15px]" />
            </span>
            <div className="leading-none">
              <div className="text-ink font-extrabold text-[26px] tracking-tight">{dataLabel}</div>
              <div className="text-ink-4 text-[11.5px] mt-1.5">high-speed data included</div>
            </div>
          </div>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5 mb-5">
          <span className="text-[34px] font-extrabold text-vf leading-none tracking-tight">{plan.price}</span>
          <span className="text-ink-4 text-[13px]">/ {period}</span>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.07] mb-5" />

        {/* Features */}
        <ul className="space-y-2.5 flex-1 mb-6">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] text-ink-2">
              <span className="mt-[1px] w-[18px] h-[18px] rounded-full bg-vf/15 flex items-center justify-center shrink-0">
                <FaCheck className="text-vf text-[8px]" />
              </span>
              <span className="leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={buy}
          disabled={busy}
          className={`w-full flex items-center justify-center gap-2 rounded-xl text-sm font-semibold py-3.5 transition-all duration-200 outline-none
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
            <>Get this plan <FaArrowRight className="text-[10px] transition-transform duration-200 group-hover:translate-x-0.5" /></>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Full-screen hand-off to M-PAiSA ── */
function PaymentHandoff({ url, onCancel }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);
  let host = '';
  try { host = new URL(url).host; } catch { /* ignore */ }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center bg-page/95 backdrop-blur-md animate-fade-in">
      <div className="w-12 h-12 border-[3px] border-white/15 border-t-vf rounded-full animate-spin mb-7" />
      <h2 className="text-ink text-[20px] font-bold mb-2 tracking-tight">Opening secure payment…</h2>
      <p className="text-ink-4 text-[13.5px] leading-relaxed max-w-xs mb-6">
        Tap below to continue to M-PAiSA and complete your purchase.
      </p>
      <a
        href={url}
        rel="external"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-vf hover:bg-vf-hover text-white text-sm font-semibold px-8 py-3.5 shadow-lg shadow-vf/25 active:scale-[0.98] transition-all"
      >
        Continue to M-PAiSA <FaArrowRight className="text-[10px]" />
      </a>
      {slow && (
        <p className="mt-6 text-ink-5 text-[12px] leading-relaxed max-w-[17rem]">
          Still not opening? Your device may not be able to reach{' '}
          <span className="text-ink-3 break-all">{host || 'the payment site'}</span>{' '}
          on this WiFi yet. Try again, or open the portal in your phone&apos;s main browser.
        </p>
      )}
      <button onClick={onCancel} className="mt-5 text-ink-5 text-[13px] hover:text-ink-3 transition-colors">
        Cancel
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
