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

  const categoryConfig = {
    daily: {
      icon: FaCalendarDay,
      desc: 'Short-term plans for quick connectivity when you need it most.',
      gradient: 'from-orange-600/20 via-orange-500/5 to-transparent',
      accent: 'text-orange-400',
      accentBg: 'bg-orange-500/15',
      accentBorder: 'border-orange-400/25',
      glowColor: 'rgba(249,115,22,0.08)',
      // Theme colors passed to modal
      theme: {
        accentBar: 'from-orange-500/60 via-orange-400/30 to-transparent',
        badgeText: 'text-orange-400',
        badgeBg: 'bg-orange-500/10 border-orange-400/20',
        iconBg: 'bg-orange-500/10 border-orange-400/15',
        iconText: 'text-orange-400',
        btnBg: 'bg-orange-500 hover:bg-orange-400',
        checkBg: 'bg-orange-500/10 border-orange-500/20',
        checkText: 'text-orange-400',
        raw: 'rgba(249,115,22,0.06)',
        // Modal background gradient
        modalBg: 'linear-gradient(165deg, rgba(249,115,22,0.12) 0%, rgba(234,88,12,0.06) 25%, rgba(24,24,27,0.98) 55%)',
        modalBorder: 'rgba(249,115,22,0.15)',
        glowRaw: 'rgba(249,115,22,0.10)',
      },
    },
    weekly: {
      icon: FaCalendarWeek,
      desc: 'Stay connected all week with reliable, consistent data access.',
      gradient: 'from-blue-600/20 via-blue-500/5 to-transparent',
      accent: 'text-blue-400',
      accentBg: 'bg-blue-500/15',
      accentBorder: 'border-blue-400/25',
      glowColor: 'rgba(59,130,246,0.08)',
      theme: {
        accentBar: 'from-blue-500/60 via-blue-400/30 to-transparent',
        badgeText: 'text-blue-400',
        badgeBg: 'bg-blue-500/10 border-blue-400/20',
        iconBg: 'bg-blue-500/10 border-blue-400/15',
        iconText: 'text-blue-400',
        btnBg: 'bg-blue-500 hover:bg-blue-400',
        checkBg: 'bg-blue-500/10 border-blue-500/20',
        checkText: 'text-blue-400',
        raw: 'rgba(59,130,246,0.06)',
        modalBg: 'linear-gradient(165deg, rgba(59,130,246,0.12) 0%, rgba(37,99,235,0.06) 25%, rgba(24,24,27,0.98) 55%)',
        modalBorder: 'rgba(59,130,246,0.15)',
        glowRaw: 'rgba(59,130,246,0.10)',
      },
    },
    monthly: {
      icon: FaCalendarAlt,
      desc: 'Maximum value for everyday users who need always-on internet.',
      gradient: 'from-purple-600/20 via-purple-500/5 to-transparent',
      accent: 'text-purple-400',
      accentBg: 'bg-purple-500/15',
      accentBorder: 'border-purple-400/25',
      glowColor: 'rgba(168,85,247,0.08)',
      theme: {
        accentBar: 'from-purple-500/60 via-purple-400/30 to-transparent',
        badgeText: 'text-purple-400',
        badgeBg: 'bg-purple-500/10 border-purple-400/20',
        iconBg: 'bg-purple-500/10 border-purple-400/15',
        iconText: 'text-purple-400',
        btnBg: 'bg-purple-500 hover:bg-purple-400',
        checkBg: 'bg-purple-500/10 border-purple-500/20',
        checkText: 'text-purple-400',
        raw: 'rgba(168,85,247,0.06)',
        modalBg: 'linear-gradient(165deg, rgba(168,85,247,0.12) 0%, rgba(147,51,234,0.06) 25%, rgba(24,24,27,0.98) 55%)',
        modalBorder: 'rgba(168,85,247,0.15)',
        glowRaw: 'rgba(168,85,247,0.10)',
      },
    },
  };

  const defaultTheme = {
    accentBar: 'from-vf/50 via-vf/25 to-transparent',
    badgeText: 'text-vf',
    badgeBg: 'bg-vf/10 border-vf/20',
    iconBg: 'bg-vf/10 border-vf/15',
    iconText: 'text-vf',
    btnBg: 'bg-vf hover:bg-vf-hover',
    checkBg: 'bg-emerald-500/10 border-emerald-500/20',
    checkText: 'text-emerald-400',
    raw: 'rgba(230,0,0,0.05)',
    modalBg: 'linear-gradient(165deg, rgba(230,0,0,0.10) 0%, rgba(180,0,0,0.05) 25%, rgba(24,24,27,0.98) 55%)',
    modalBorder: 'rgba(230,0,0,0.12)',
    glowRaw: 'rgba(230,0,0,0.08)',
  };

  const defaultCatConfig = {
    icon: FaMobileAlt,
    desc: 'Explore all available data plans.',
    gradient: 'from-emerald-600/20 via-emerald-500/5 to-transparent',
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-500/15',
    accentBorder: 'border-emerald-400/25',
    glowColor: 'rgba(16,185,129,0.08)',
    theme: defaultTheme,
  };

  return (
    <div className="min-h-screen lg:h-[100dvh] font-sans flex flex-col lg:overflow-hidden">

      {/* ═══════ MAIN CONTENT ═══════ */}
      <div className="flex-1 flex flex-col lg:min-h-0">

        {/* ═══════ HERO ═══════ */}
        <header className="w-full max-w-6xl mx-auto px-5 sm:px-8 pt-10 sm:pt-14 lg:pt-7 pb-8 sm:pb-12 lg:pb-5 text-center shrink-0">
          {/* Logo */}
          <div className="flex justify-center mb-6 sm:mb-8 lg:mb-4 animate-enter">
            <img
              src="/images/logo.png"
              alt="Vodafone"
              className="h-11 sm:h-16 lg:h-12 w-auto"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
            />
            <div className="hidden items-center gap-2 text-vf font-extrabold text-2xl">
              <FaWifi className="text-xl" /> vodafone
            </div>
          </div>

          {/* Heading */}
          <h1
            className="text-3xl sm:text-4xl lg:text-[2.5rem] font-extrabold text-ink tracking-tight leading-tight mb-3 lg:mb-2.5 animate-enter"
            style={{ animationDelay: '80ms' }}
          >
            Choose your <span className="text-vf">data plan</span>
          </h1>
          <p
            className="text-ink-3 text-sm sm:text-base leading-relaxed max-w-lg mx-auto animate-enter"
            style={{ animationDelay: '150ms' }}
          >
            Select a category and find the perfect package. Instant activation, no setup fees.
          </p>
        </header>

        {/* ═══════ CATEGORY TILES ═══════ */}
        <main className="w-full max-w-6xl mx-auto px-5 sm:px-8 pb-12 lg:pb-0 lg:flex-1 lg:min-h-0 flex flex-col justify-center">
          {categoriesLoading ? (
            <div className="flex flex-col items-center py-20 gap-3">
              <div className="w-7 h-7 border-[2.5px] border-edge border-t-ink-3 rounded-full animate-spin" />
              <span className="text-ink-4 text-sm">Loading plans...</span>
            </div>
          ) : categories?.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6 w-full max-w-5xl mx-auto">
              {categories.map((cat, i) => {
                const cfg = categoryConfig[cat.id] || defaultCatConfig;
                const Icon = cfg.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat)}
                    className="group text-left relative overflow-hidden bg-card/80 backdrop-blur-sm border border-edge rounded-3xl
                               min-h-[200px] sm:min-h-[230px]
                               transition-all duration-300 hover:border-edge-hover hover:bg-card
                               animate-enter"
                    style={{
                      animationDelay: `${i * 100}ms`,
                    }}
                  >
                    {/* Color gradient overlay on hover */}
                    <div className={`absolute inset-0 bg-gradient-to-b ${cfg.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                    {/* Bottom glow on hover */}
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[80%] h-[120px] rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{ background: cfg.glowColor }}
                    />

                    <div className="relative p-6 sm:p-7 flex flex-col h-full">
                      {/* Icon */}
                      <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl ${cfg.accentBg} border ${cfg.accentBorder}
                                      flex items-center justify-center shrink-0 mb-4
                                      transition-transform duration-300 group-hover:scale-110`}>
                        <Icon className={`${cfg.accent} text-lg sm:text-2xl`} />
                      </div>

                      {/* Name + badge */}
                      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                        <h2 className="text-xl sm:text-2xl font-bold text-ink">{cat.name}</h2>
                        <span className="text-[10px] font-bold text-vf bg-vf/10 border border-vf/15 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                          {cat.count} plan{cat.count !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Description */}
                      <p className="text-ink-4 text-sm leading-relaxed mb-5 flex-1">{cfg.desc}</p>

                      {/* CTA */}
                      <div className="flex items-center gap-2 text-sm font-semibold text-vf group-hover:gap-3 transition-all duration-300 mt-auto">
                        <span>View plans</span>
                        <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20">
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
      </div>

      {/* ═══════ FEATURES BAR ═══════ */}
      <section className="border-t border-edge bg-card/40 shrink-0">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-5 sm:py-7 lg:py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {[
              { icon: FaBolt, title: 'Instant Activation', desc: 'Connected in seconds after payment' },
              { icon: FaShieldAlt, title: 'Secure & Reliable', desc: 'Enterprise-grade WiFi network' },
              { icon: FaWifi, title: 'Full Coverage', desc: 'Unlimited calls & texts included' },
            ].map(({ icon: FIcon, title, desc }) => (
              <div key={title} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-vf/10 flex items-center justify-center shrink-0">
                  <FIcon className="text-vf text-xs" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{title}</h3>
                  <p className="text-xs text-ink-4">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-edge shrink-0">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-ink-5 text-xs">
          <span>No setup fees</span>
          <span>•</span>
          <span>Cancel anytime</span>
          <span>•</span>
          <span>24/7 Support</span>
        </div>
      </footer>

      {/* ═══════ MODAL ═══════ */}
      <PlansModal
        selectedCategory={selectedCategory}
        categoryPlans={categoryPlans}
        loading={loading}
        onClose={closeModal}
        onBuy={handleBuy}
        theme={selectedCategory ? (categoryConfig[selectedCategory.id] || defaultCatConfig).theme : defaultTheme}
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
