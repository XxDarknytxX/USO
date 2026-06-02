// src/components/plan-card.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FaTimes,
  FaCalendarDay,
  FaCalendarWeek,
  FaCalendarAlt,
  FaMobileAlt,
  FaArrowRight,
  FaWifi,
  FaStar,
} from 'react-icons/fa';

const getIconComponent = (iconString) => {
  const map = {
    'fas fa-calendar-day': FaCalendarDay,
    'fas fa-calendar-week': FaCalendarWeek,
    'fas fa-calendar-alt': FaCalendarAlt,
    'fas fa-mobile-alt': FaMobileAlt,
  };
  return map[iconString] || FaMobileAlt;
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

/* ================================================================ */
/*  Plans Modal — themed to category color                           */
/* ================================================================ */
function PlansModal({ selectedCategory, categoryPlans, loading, onClose, onBuy, theme }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const t = theme || defaultTheme;

  useEffect(() => {
    if (selectedCategory) {
      // Lock body scroll when modal opens
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${window.scrollY}px`;
      requestAnimationFrame(() => setVisible(true));
    } else {
      // Restore body scroll when modal closes
      const scrollY = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY || '0', 10) * -1);
      setVisible(false);
      setClosing(false);
    }
    return () => {
      const scrollY = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY || '0', 10) * -1);
    };
  }, [selectedCategory]);

  const closeTimer = useRef(null);
  const handleClose = useCallback(() => {
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setClosing(false);
      setVisible(false);
      onClose();
    }, 280);
  }, [onClose]);

  // Clear a pending close-animation timer if the modal unmounts mid-close,
  // so onClose()/setState never fire on an unmounted component.
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  if (!selectedCategory) return null;

  const show = visible && !closing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onClick={handleClose}
    >
      {/* Backdrop — dark dim, no brightening */}
      <div
        className="absolute inset-0 transition-all duration-[400ms] ease-out"
        style={{
          background: show ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0)',
          backdropFilter: show ? 'blur(16px)' : 'blur(0px)',
          WebkitBackdropFilter: show ? 'blur(16px)' : 'blur(0px)',
          opacity: show ? 1 : 0,
        }}
      />

      {/* Panel — centered card on all sizes */}
      <div
        className="relative w-full sm:max-w-5xl max-h-[92vh] max-h-[92dvh]
                   overflow-hidden
                   transition-all duration-[400ms] ease-out"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.97)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="rounded-2xl overflow-hidden
                     shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85)]"
          style={{
            background: t.modalBg || 'rgba(20,20,23,0.98)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: t.modalBorder || 'rgba(255,255,255,0.08)',
          }}
        >
          {/* Themed accent bar at top */}
          <div className={`h-[2px] bg-gradient-to-r ${t.accentBar}`} />

          {/* Single soft ambient glow at the top — refined, not heavy */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-[420px] h-[220px] rounded-full blur-[90px] pointer-events-none opacity-50"
            style={{ background: t.glowRaw || t.raw }}
          />

          {/* Header */}
          <div className="relative flex items-center justify-between px-5 sm:px-8 py-5 sm:py-7">
            <div>
              <div className="flex items-center gap-3 mb-1 sm:mb-2">
                <h2 className="text-lg sm:text-2xl font-bold text-ink">{selectedCategory.name} Plans</h2>
                <span className={`text-[10px] font-bold ${t.badgeText} ${t.badgeBg} border px-2.5 py-0.5 rounded-full`}>
                  {categoryPlans.length} available
                </span>
              </div>
              <p className="text-xs sm:text-sm text-ink-4">Choose a plan that fits your needs</p>
            </div>
            <button
              onClick={handleClose}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/5 border border-edge flex items-center justify-center
                         text-ink-4 text-sm transition-all duration-200 shrink-0
                         hover:bg-white/10 hover:text-ink hover:border-edge-hover hover:rotate-90"
            >
              <FaTimes />
            </button>
          </div>

          {/* Divider — themed with subtle gradient */}
          <div className="mx-5 sm:mx-8 h-px"
            style={{
              background: `linear-gradient(to right, ${t.modalBorder || 'rgba(255,255,255,0.08)'}, rgba(255,255,255,0.06), transparent)`,
            }}
          />

          {/* Body */}
          <div className="relative p-4 sm:p-8 overflow-y-auto
                          max-h-[calc(92vh-110px)] max-h-[calc(92dvh-110px)]"
               style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <div className={`w-10 h-10 border-[2.5px] border-edge rounded-full animate-spin`}
                  style={{ borderTopColor: (t.glowRaw || t.raw).replace(/[\d.]+\)$/, '0.8)') }}
                />
                <p className="text-ink-4 text-sm">Loading plans...</p>
              </div>
            ) : categoryPlans.length > 0 ? (
              <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {categoryPlans.map((plan, idx) => (
                  <PlanCard key={plan.id} plan={plan} onBuy={onBuy} index={idx} isModal theme={t} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center">
                  <FaWifi className="text-ink-5 text-xl" />
                </div>
                <p className="text-ink-4 text-sm">No plans available in this category</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  Plan Card — themed to category color                             */
/* ================================================================ */
export default function PlanCard({ plan, onBuy, index = 0, isModal = false, theme }) {
  const [busy, setBusy] = useState(false);
  const Icon = getIconComponent(plan.icon);
  const t = theme || defaultTheme;

  // try/finally so the button never gets stuck on "Processing…" if onBuy throws.
  const buy = async () => {
    setBusy(true);
    try {
      await onBuy(plan);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="group relative flex flex-col overflow-hidden bg-card/70 backdrop-blur-sm border border-edge rounded-2xl
                 transition-all duration-300 hover:border-vf/35 hover:bg-card hover:-translate-y-0.5
                 animate-enter"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* Subtle gradient tint on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `linear-gradient(to bottom, ${(t.glowRaw || t.raw).replace(/[\d.]+\)$/, '0.06)')}, transparent 50%)` }}
      />

      {/* Popular badge — themed. Boolean() guards against a MySQL tinyint 0
          rendering a literal "0" in the card. */}
      {Boolean(plan.popular) && (
        <div className={`absolute top-5 right-5 z-10 text-[10px] font-bold uppercase tracking-wider
                        ${t.badgeText} ${t.badgeBg} border px-2.5 py-1 rounded-full flex items-center gap-1`}>
          <FaStar className="text-[8px]" />
          Popular
        </div>
      )}

      {/* Content */}
      <div className="relative p-6 flex flex-col h-full">

        {/* Icon */}
        <div className={`w-11 h-11 rounded-xl ${t.iconBg} border
                        flex items-center justify-center shrink-0 mb-5
                        transition-transform duration-300 group-hover:scale-105`}>
          <Icon className={`${t.iconText} text-lg`} />
        </div>

        {/* Name */}
        <h3 className="text-[18px] font-bold text-ink mb-2">{plan.name}</h3>

        {/* Description */}
        {plan.description && (
          <p className="text-[13px] text-ink-4 leading-relaxed mb-5 line-clamp-3 flex-1">{plan.description}</p>
        )}
        {!plan.description && <div className="flex-1 mb-5" />}

        {/* Price */}
        <div className="mb-5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[28px] font-extrabold text-ink tracking-tight">{plan.price}</span>
            <span className="text-sm text-ink-5 font-medium">/ {plan.duration || 'day'}</span>
          </div>
        </div>

        {/* CTA Button — themed */}
        <button
          onClick={buy}
          disabled={busy}
          className={`w-full flex items-center justify-center gap-2.5 rounded-xl text-sm font-semibold
                      py-3 transition-all duration-200 outline-none cursor-pointer
            ${busy
              ? 'bg-white/5 text-ink-5 cursor-not-allowed'
              : `${t.btnBg} text-white active:scale-[0.97]`
            }`}
        >
          {busy ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              Get this plan
              <FaArrowRight className="text-[10px]" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export { PlansModal };
