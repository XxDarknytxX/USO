/**
 * Main WiFi portal — category tiles → plan modal → payment
 */
import { useEffect, useRef, useState } from 'react';
import PlanCard, { PlansModal } from '../components/plan-card';
import {
  FaCalendarDay, FaCalendarWeek, FaCalendarAlt, FaMobileAlt,
  FaCheckCircle, FaExclamationCircle, FaWifi, FaBolt, FaShieldAlt,
} from 'react-icons/fa';

export default function MainPage() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryPlans, setCategoryPlans] = useState([]);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [handledPayment, setHandledPayment] = useState(false);

  // Track notification/redirect timers so they're cleared if the page unmounts.
  const timersRef = useRef([]);
  const track = (id) => { timersRef.current.push(id); return id; };
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  useEffect(() => {
    fetchCategories();
    const p = new URLSearchParams(window.location.search);
    const sid = p.get('sessionId');
    if (sid) { sessionStorage.setItem('wifiSessionId', sid); setSessionId(sid); }
    else { const s = sessionStorage.getItem('wifiSessionId'); if (s) setSessionId(s); }
    // Capture device MAC address from Ruijie captive portal redirect
    const mac = p.get('clientMac') || p.get('usermac') || p.get('mac');
    if (mac) { sessionStorage.setItem('deviceMac', mac); }
    if (p.get('tID') && p.get('rCode')) handlePaymentCallback(p);
  }, []); // eslint-disable-line

  const fetchCategories = async () => {
    setCategoriesLoading(true);
    try { const r = await fetch('/api/categories'); if (!r.ok) throw new Error(); setCategories(await r.json()); }
    catch { showError('Failed to load categories. Please refresh.'); }
    finally { setCategoriesLoading(false); }
  };

  const handleCategoryClick = async (cat) => {
    setLoading(true); setSelectedCategory(cat);
    try { const r = await fetch(`/api/plans/category/${cat.id}`); if (!r.ok) throw new Error(); setCategoryPlans(await r.json()); }
    catch { showError('Failed to load plans.'); }
    finally { setLoading(false); }
  };

  const closeModal = () => { setSelectedCategory(null); setCategoryPlans([]); };

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
    try {
      const res = await fetch('/api/mpaisa/initiate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: plan.price.replace('$', ''), planId: plan.id, sessionId: sid, clientMac: mac }) });
      const p = await res.json();
      if (!res.ok) throw new Error(p?.error || 'Failed');
      if (!p.paymentUrl) throw new Error('No payment URL');
      window.location.href = p.paymentUrl;
    } catch (err) { showError(err.message || 'Purchase failed.'); }
  };

  const showSuccess = (m) => { setNotification({ type: 'ok', message: m }); track(setTimeout(dismiss, 5000)); };
  const showError = (m) => { setNotification({ type: 'err', message: m }); track(setTimeout(dismiss, 6000)); };
  const dismiss = () => { setNotification(p => p ? { ...p, exit: true } : null); track(setTimeout(() => setNotification(null), 400)); };

  // ── Category metadata: icon + a short tagline. The palette is unified to
  //    the Vodafone red brand for a clean, modern, on-brand look. ──
  const CATEGORY_META = {
    daily:   { icon: FaCalendarDay,  tagline: 'Quick connectivity, pay as you go' },
    weekly:  { icon: FaCalendarWeek, tagline: 'Reliable data, all week' },
    monthly: { icon: FaCalendarAlt,  tagline: 'Best value — always on' },
  };
  const DEFAULT_META = { icon: FaMobileAlt, tagline: 'Explore all available plans' };

  // Single red theme handed to the plans modal.
  const MODAL_THEME = {
    accentBar: 'from-vf/60 via-vf/30 to-transparent',
    badgeText: 'text-vf',
    badgeBg: 'bg-vf/10 border-vf/20',
    iconBg: 'bg-vf/10 border-vf/15',
    iconText: 'text-vf',
    btnBg: 'bg-vf hover:bg-vf-hover',
    checkBg: 'bg-vf/10 border-vf/20',
    checkText: 'text-vf',
    raw: 'rgba(230,0,0,0.06)',
    modalBg: 'linear-gradient(165deg, rgba(230,0,0,0.10) 0%, rgba(150,0,0,0.05) 28%, rgba(20,20,23,0.98) 58%)',
    modalBorder: 'rgba(230,0,0,0.14)',
    glowRaw: 'rgba(230,0,0,0.10)',
  };

  return (
    <div className="min-h-screen min-h-[100dvh] font-sans flex flex-col">

      {/* ═══════ TOP BAR ═══════ */}
      <header className="w-full max-w-5xl mx-auto px-5 sm:px-8 pt-5 sm:pt-7 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 animate-enter">
          <img
            src="/images/logo.png"
            alt="Vodafone"
            className="h-7 sm:h-8 w-auto"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
          />
          <div className="hidden items-center gap-1.5 text-vf font-extrabold text-lg">
            <FaWifi className="text-base" /> vodafone
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium animate-enter">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          WiFi connected
        </span>
      </header>

      {/* ═══════ HERO + CATEGORIES ═══════ */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 flex flex-col justify-center py-8 sm:py-10">
        {/* Hero — intentionally compact */}
        <div className="text-center mb-7 sm:mb-9">
          <h1 className="text-[26px] sm:text-[34px] lg:text-[38px] font-bold text-ink tracking-[-0.02em] leading-[1.08] animate-enter">
            Choose your <span className="text-vf">plan</span>
          </h1>
          <p
            className="text-ink-3 text-[13.5px] sm:text-[15px] mt-2.5 animate-enter"
            style={{ animationDelay: '70ms' }}
          >
            Instant activation · No setup fees
          </p>
        </div>

        {/* Categories */}
        {categoriesLoading ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="w-6 h-6 border-[2.5px] border-edge border-t-vf rounded-full animate-spin" />
            <span className="text-ink-4 text-sm">Loading plans…</span>
          </div>
        ) : categories?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
            {categories.map((cat, i) => {
              const meta = CATEGORY_META[cat.id] || DEFAULT_META;
              const Icon = meta.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat)}
                  className="group relative text-left overflow-hidden rounded-2xl border border-edge bg-card/60 backdrop-blur-sm
                             p-5 sm:p-6 transition-all duration-300
                             hover:border-vf/40 hover:bg-card hover:-translate-y-0.5
                             focus-visible:border-vf/50 animate-enter"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  {/* top hairline highlight on hover */}
                  <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vf/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <div className="flex items-start justify-between mb-5 sm:mb-6">
                    <span className="w-11 h-11 rounded-xl bg-vf/10 border border-vf/15 flex items-center justify-center text-vf
                                     transition-transform duration-300 group-hover:scale-105">
                      <Icon className="text-lg" />
                    </span>
                    <span className="text-[11px] font-semibold text-ink-4 bg-white/[0.04] border border-edge px-2 py-0.5 rounded-full">
                      {cat.count} plan{cat.count !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <h2 className="text-[17px] sm:text-[18px] font-bold text-ink mb-1 capitalize">{cat.name}</h2>
                  <p className="text-ink-4 text-[12.5px] sm:text-[13px] leading-relaxed mb-4">{meta.tagline}</p>

                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-vf">
                    <span>View plans</span>
                    <svg className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-card border border-edge flex items-center justify-center mx-auto mb-3">
              <FaWifi className="text-ink-5 text-lg" />
            </div>
            <p className="text-ink-4 mb-3 text-sm">No plans available right now</p>
            <button onClick={fetchCategories} className="text-sm font-semibold text-vf hover:text-vf-hover transition-colors">
              Try again
            </button>
          </div>
        )}
      </main>

      {/* ═══════ TRUST STRIP ═══════ */}
      <footer className="border-t border-edge/70 shrink-0">
        <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-3.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5">
          {[
            { icon: FaBolt, label: 'Instant activation' },
            { icon: FaShieldAlt, label: 'Secure network' },
            { icon: FaWifi, label: 'Unlimited calls & texts' },
          ].map(({ icon: FIcon, label }) => (
            <span key={label} className="flex items-center gap-2 text-ink-4 text-[12px]">
              <FIcon className="text-vf/70 text-[11px]" />
              {label}
            </span>
          ))}
        </div>
      </footer>

      {/* ═══════ MODAL ═══════ */}
      <PlansModal
        selectedCategory={selectedCategory}
        categoryPlans={categoryPlans}
        loading={loading}
        onClose={closeModal}
        onBuy={handleBuy}
        theme={MODAL_THEME}
      />

      {/* ═══════ TOAST ═══════ */}
      {notification && <Toast type={notification.type} message={notification.message} exit={notification.exit} />}
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
