import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  FaWifi,
  FaDatabase,
  FaClock,
  FaSyncAlt,
  FaTimesCircle,
  FaArrowDown,
  FaArrowUp,
} from 'react-icons/fa';

const REFRESH_INTERVAL = 30000;

/* ── Helpers ── */
function formatData(mb) {
  if (mb == null || mb === 0) return '0 MB';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function formatTime(minutes) {
  if (minutes == null || minutes <= 0) return '0m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

function formatSpeed(kbps) {
  if (!kbps || kbps === 0) return 'Unlimited';
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} Mbps`;
  return `${kbps} Kbps`;
}

/* ── Progress Ring ── */
function ProgressRing({ percent, size = 140, stroke = 12, color = '#e60000', children }) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
          fill="none"
        />
        {/* Glow behind the arc */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color}
          strokeWidth={stroke + 6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          opacity={0.15}
          className="transition-all duration-1000 ease-out"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/* ── Usage Bar (linear) ── */
function UsageBar({ percent, color, label, used, total }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-ink-3">{label}</span>
        <span className="text-xs text-ink-4">{used} / {total}</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${Math.min(percent, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}


export default function VoucherStatus() {
  const { voucherCode } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Use a ref for "has data" check to avoid dependency cycle
  const dataRef = useRef(data);
  dataRef.current = data;

  // Guards async state writes so an in-flight poll that resolves after the
  // page unmounts (navigation) can't setState on an unmounted component.
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/voucher-status/${encodeURIComponent(voucherCode)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Voucher not found');
        throw new Error(`Service error (${res.status})`);
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Unknown error');
      if (!mountedRef.current) return;
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      // Only set error if we have no existing data to show
      if (mountedRef.current && !dataRef.current) setError(e.message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [voucherCode]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    const interval = setInterval(() => fetchStatus(true), REFRESH_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  // Tick every second so the time-remaining countdown updates live (it's derived
  // from the server-provided expiresAt, not from the 30s poll).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // NOTE: we deliberately do NOT auto-redirect an expired device to "/". A new
  // plan can only be purchased with a FRESH Ruijie sessionId, which is issued by
  // the gateway's captive-portal redirect (customHtmlnew → portal?sessionId=…) —
  // not something the portal can mint, and the previous session is dead once the
  // plan lapses. Bouncing to "/" just lands on a portal that can't complete a
  // purchase, so instead we keep the customer on the status page and tell them to
  // reconnect to the Wi-Fi (which re-triggers the captive cycle).

  const statusUrl = `${window.location.origin}/status/${voucherCode}`;

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
        <div className="flex flex-col items-center gap-4 animate-enter">
          <div className="w-10 h-10 border-[3px] border-edge border-t-vf rounded-full animate-spin" />
          <p className="text-ink-3 text-sm">Loading your connection status...</p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 font-sans">
        <div className="w-full max-w-lg animate-enter">
          <div className="flex justify-center mb-8">
            <Logo />
          </div>
          <div className="bg-card/80 backdrop-blur-sm border border-edge rounded-3xl p-8 sm:p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
              <FaTimesCircle className="text-3xl text-red-400" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-3">Voucher Not Found</h1>
            <p className="text-sm sm:text-base text-ink-3 leading-relaxed mb-4">{error}</p>
            <p className="text-xs text-ink-5 font-mono bg-white/[0.04] inline-block px-3 py-1 rounded-lg">ID: {voucherCode}</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Calculations ── */
  const dataPercent = data.quota > 0 ? ((data.usedQuota || 0) / data.quota) * 100 : 0;

  // Time remaining counts down live from the server-computed expiry (activation +
  // plan period), so it's correct without waiting for a voucher sync. Falls back
  // to the synced remaining/used minutes when there's no expiry (e.g. an
  // unlimited-time plan, or a voucher not yet activated).
  const hasLiveExpiry = data.expiresAt && data.timePeriod > 0;
  const remainingMin = hasLiveExpiry
    ? Math.max(0, (data.expiresAt - now) / 60000)
    : (data.remainingTime || 0);
  const usedMin = hasLiveExpiry
    ? Math.min(data.timePeriod, Math.max(0, data.timePeriod - remainingMin))
    : (data.usedTime || 0);
  const timePercent = data.timePeriod > 0 ? (usedMin / data.timePeriod) * 100 : 0;
  const dataColor = dataPercent > 85 ? '#ef4444' : dataPercent > 60 ? '#f59e0b' : '#10b981';
  const timeColor = timePercent > 85 ? '#ef4444' : timePercent > 60 ? '#f59e0b' : '#3b82f6';

  // Effective state, kept consistent with the live countdown. TIME expiry comes
  // from the activation-based timer (not the synced status/used_time, which lags
  // and was showing "Expired" while time + data clearly remained); data-exhaustion
  // and admin-disable still come from the mirror.
  const dataExhausted = data.quota > 0 && ((data.remainingQuota ?? 0) <= 0);
  const timeUp = hasLiveExpiry ? remainingMin <= 0 : !!data.isExpired;
  const isActive = !data.disabled && !dataExhausted && !timeUp;

  return (
    <div className="min-h-screen min-h-[100dvh] font-sans flex flex-col">

      {/* ═══════ HEADER ═══════ */}
      <header className="w-full max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-6 sm:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-enter">
          <div className="flex items-center gap-4">
            <Logo />
            <div className="hidden sm:block h-8 w-px bg-edge" />
            <h1 className="hidden sm:block text-lg font-semibold text-ink-3">Connection Status</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Status pill */}
            {isActive ? (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                <FaTimesCircle className="text-xs" />
                {data.isExpired ? 'Expired' : 'Disconnected'}
              </span>
            )}
            {/* Refresh button */}
            <button
              onClick={() => fetchStatus(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                         text-ink-3 bg-white/[0.04] border border-edge hover:border-edge-hover
                         hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              <FaSyncAlt className={`text-[10px] ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      {/* ═══════ MAIN CONTENT ═══════ */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 pb-8">

        {/* ── Row 1: Usage — single container, Data + Time side by side ── */}
        <div className="relative overflow-hidden bg-card/80 backdrop-blur-sm border border-edge rounded-3xl p-6 sm:p-8 animate-enter" style={{ animationDelay: '80ms' }}>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: isActive
                ? 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, transparent 50%, rgba(59,130,246,0.04) 100%)'
                : 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, transparent 60%)',
            }}
          />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[50%] h-[80px] rounded-full blur-[80px] pointer-events-none"
            style={{ background: isActive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.06)' }}
          />

          <div className="relative">
            <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-6">Your Usage</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-0">
              {/* Data side */}
              <div className="flex flex-col items-center sm:pr-8 lg:pr-10">
                <ProgressRing percent={dataPercent} color={dataColor} size={156} stroke={13}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-0.5"
                       style={{ background: `${dataColor}15` }}>
                    <FaDatabase className="text-xs" style={{ color: dataColor }} />
                  </div>
                  <span className="text-xl font-bold text-ink leading-tight">{formatData(data.remainingQuota)}</span>
                  <span className="text-[10px] text-ink-4 mt-0.5">remaining</span>
                </ProgressRing>

                <div className="text-center mt-3 mb-4">
                  <span className="text-sm font-semibold text-ink">Data</span>
                  <span className="text-xs text-ink-4 ml-2">{Math.round(dataPercent)}% used</span>
                </div>

                <div className="w-full space-y-2.5">
                  <UsageBar percent={dataPercent} color={dataColor} label="Data Usage" used={formatData(data.usedQuota)} total={formatData(data.quota)} />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Used</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatData(data.usedQuota)}</div>
                    </div>
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Left</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatData(data.remainingQuota)}</div>
                    </div>
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Total</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatData(data.quota)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Time side */}
              <div className="flex flex-col items-center sm:border-l sm:border-edge sm:pl-8 lg:pl-10">
                <ProgressRing percent={timePercent} color={timeColor} size={156} stroke={13}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-0.5"
                       style={{ background: `${timeColor}15` }}>
                    <FaClock className="text-xs" style={{ color: timeColor }} />
                  </div>
                  <span className="text-xl font-bold text-ink leading-tight">{formatTime(remainingMin)}</span>
                  <span className="text-[10px] text-ink-4 mt-0.5">remaining</span>
                </ProgressRing>

                <div className="text-center mt-3 mb-4">
                  <span className="text-sm font-semibold text-ink">Time</span>
                  <span className="text-xs text-ink-4 ml-2">{Math.round(timePercent)}% used</span>
                </div>

                <div className="w-full space-y-2.5">
                  <UsageBar percent={timePercent} color={timeColor} label="Time Usage" used={formatTime(usedMin)} total={formatTime(data.timePeriod)} />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Used</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatTime(usedMin)}</div>
                    </div>
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Left</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatTime(remainingMin)}</div>
                    </div>
                    <div className="bg-white/[0.03] border border-edge rounded-lg py-1.5 px-1 text-center">
                      <div className="text-[9px] text-ink-5 uppercase tracking-wider">Total</div>
                      <div className="text-[11px] font-bold text-ink mt-0.5">{formatTime(data.timePeriod)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Expired / Disconnected CTA ── */}
        {!isActive && (
          <div className="relative overflow-hidden bg-card/80 backdrop-blur-sm border border-red-500/20 rounded-3xl p-6 sm:p-8 mt-5 sm:mt-6 animate-enter" style={{ animationDelay: '120ms' }}>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, transparent 50%, rgba(230,0,0,0.04) 100%)',
              }}
            />
            <div className="relative text-center">
              <h2 className="text-lg sm:text-xl font-bold text-ink mb-2">
                {data.disabled
                  ? 'Plan Deactivated'
                  : timeUp
                    ? 'Your Plan Has Expired'
                    : 'Plan Used Up'}
              </h2>
              <p className="text-sm text-ink-3 mb-5 max-w-md mx-auto">
                {data.disabled
                  ? 'This plan has been deactivated. Reconnect to the Wi-Fi to purchase a new plan.'
                  : timeUp
                    ? 'Your plan time has run out. Reconnect to the Wi-Fi to purchase a new plan.'
                    : 'You’ve used all your data. Reconnect to the Wi-Fi to purchase a new plan.'}
              </p>
              <div className="inline-flex items-start gap-3 text-left max-w-md mx-auto px-5 py-4 rounded-xl bg-white/[0.03] border border-edge">
                <FaWifi className="text-vf mt-1 shrink-0" />
                <div className="text-sm text-ink-3 leading-relaxed">
                  <span className="font-semibold text-ink">Reconnect to the Wi-Fi</span> to buy a new plan.
                  Your device will re-open the sign-in page automatically, where you can purchase and get
                  back online. A new plan can’t be started from this page — it needs a fresh Wi-Fi sign-in.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Row 2: Plan Details + QR Code — matched height ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 mt-5 sm:mt-6 animate-enter" style={{ animationDelay: '160ms' }}>

          {/* ── Plan Details Card ── */}
          <div className="relative overflow-hidden bg-card/80 backdrop-blur-sm border border-edge rounded-3xl p-6 sm:p-8 flex flex-col">
            <div className="absolute inset-0 bg-gradient-to-b from-vf/[0.06] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-vf/40 to-transparent" />

            <div className="relative flex flex-col flex-1">
              <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-5">Plan Details</h2>

              {/* Plan + ID row */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] text-ink-5 uppercase tracking-wider mb-0.5">Plan</div>
                  <div className="text-base font-bold text-ink">{data.packageName || data.userGroupName || '\u2014'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-ink-5 uppercase tracking-wider mb-0.5">Voucher ID</div>
                  <div className="text-xs font-mono font-semibold text-ink bg-white/[0.04] px-2 py-0.5 rounded-md">{data.voucherCode}</div>
                </div>
              </div>

              <div className="h-px bg-edge mb-4" />

              {/* Speed row */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white/[0.03] border border-edge rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <FaArrowDown className="text-[9px] text-emerald-400" />
                    <span className="text-[10px] text-ink-5 uppercase tracking-wider">Download</span>
                  </div>
                  <div className="text-sm font-bold text-ink">{formatSpeed(data.downloadRateLimit)}</div>
                </div>
                <div className="bg-white/[0.03] border border-edge rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <FaArrowUp className="text-[9px] text-blue-400" />
                    <span className="text-[10px] text-ink-5 uppercase tracking-wider">Upload</span>
                  </div>
                  <div className="text-sm font-bold text-ink">{formatSpeed(data.uploadRateLimit)}</div>
                </div>
              </div>

              {/* Activated */}
              <div className="mt-auto">
                <div className="text-[10px] text-ink-5 uppercase tracking-wider mb-0.5">Activated</div>
                <div className="text-sm font-medium text-ink">
                  {(data.activatedAt || data.loginTime)
                    ? new Date(Number(data.activatedAt || data.loginTime)).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : 'Not yet activated'}
                </div>
              </div>
            </div>
          </div>

          {/* ── QR Code Card ── */}
          <div className="relative overflow-hidden bg-card/80 backdrop-blur-sm border border-edge rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center">
            <div className="bg-white rounded-2xl p-3 shadow-xl shadow-black/20 mb-3">
              <QRCodeSVG
                value={statusUrl}
                size={120}
                level="M"
                bgColor="#ffffff"
                fgColor="#09090b"
              />
            </div>
            <p className="text-xs text-ink-4">Scan to check usage from any device</p>
          </div>
        </div>
      </main>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-edge mt-auto">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-ink-5 text-xs">
            <span>Vodafone WiFi</span>
            <span className="hidden sm:inline">&bull;</span>
            <span>Secure Network</span>
            <span className="hidden sm:inline">&bull;</span>
            <span>24/7 Support</span>
          </div>
          {lastUpdated && (
            <span className="text-[11px] text-ink-5">
              Last updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

/* ── Logo Component ── */
function Logo() {
  return (
    <>
      <img
        src="/images/logo.png"
        alt="Vodafone"
        className="h-10 sm:h-12 w-auto"
        onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
      />
      <div className="hidden items-center gap-2 text-vf font-extrabold text-xl">
        <FaWifi className="text-lg" /> vodafone
      </div>
    </>
  );
}
