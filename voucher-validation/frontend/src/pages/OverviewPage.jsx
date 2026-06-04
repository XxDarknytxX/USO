// src/pages/OverviewPage.jsx
// All-villages network overview (NOC-style): live status + uptime % + usage,
// served from the background collector snapshots. Auto-refreshes every 30s.

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Globe, RefreshCw, Users, Activity, CheckCircle2, XCircle } from "lucide-react";
import { networkApi } from "../services/api";

const fmtBytes = (b) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const timeAgo = (ts) => {
  if (!ts) return "never";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export default function OverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const timer = useRef(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await networkApi.overview({ uptimeHours: 24 });
      setData(res);
    } catch (e) {
      if (!isRefresh) toast.error("Failed to load overview: " + e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  const s = data?.summary;
  const sites = data?.sites || [];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark"><Globe size={15} /></span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Network</span>
            <h1 className="page-title">Overview</h1>
            <p className="page-subtitle">
              Every village at a glance{data?.lastCollected ? ` · updated ${timeAgo(data.lastCollected)}` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat icon={CheckCircle2} label="Villages up" value={s ? `${s.villagesUp}/${s.villagesTotal}` : "—"} tone="ok" />
        <Stat icon={XCircle} label="Villages down" value={s ? s.villagesDown : "—"} tone={s?.villagesDown ? "bad" : "muted"} />
        <Stat icon={Users} label="Clients online" value={s ? s.clients : "—"} />
        <Stat icon={Activity} label="Usage today" value={s ? fmtBytes(s.usageBytes) : "—"} />
      </div>

      {/* Villages table */}
      <div className="rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)] shadow-[var(--elev-1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                <Th>Village</Th><Th>Status</Th><Th>Internet</Th><Th>Gateway</Th>
                <Th>APs</Th><Th>Clients</Th><Th>Usage</Th><Th>Uptime 24h</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--text-tertiary)]">Loading…</td></tr>
              ) : sites.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--text-tertiary)]">No villages yet — add sites under Network.</td></tr>
              ) : sites.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => navigate("/network")}
                  className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-sunken)] cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text-primary)]">{v.name}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">{v.hostname || `group ${v.groupId || "—"}`}</div>
                  </td>
                  <td className="px-4 py-3"><Dot state={v.online} up="Online" down="Down" /></td>
                  <td className="px-4 py-3"><Dot state={v.internetUp} up="Up" down="Down" /></td>
                  <td className="px-4 py-3"><Dot state={v.gatewayOnline} up="Online" down="Offline" /></td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{v.apsTotal ? `${v.apsOnline}/${v.apsTotal}` : "—"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{v.clients ?? 0}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{fmtBytes(v.usageBytes)}</td>
                  <td className="px-4 py-3"><Uptime pct={v.uptimePct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && sites.some((v) => v.uptimePct == null) && (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Uptime fills in as the background monitor collects samples (every ~5 min) — give it a little while after the first deploy.
        </p>
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide">{children}</th>;
}

function Stat({ icon: Icon, label, value, tone }) {
  const toneCls = tone === "ok" ? "text-emerald-500" : tone === "bad" ? "text-red-500" : "text-[var(--text-tertiary)]";
  return (
    <div className="rounded-lg p-4 bg-[var(--surface-raised)] border border-[var(--border-default)] shadow-[var(--elev-1)]">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)] text-xs mb-2">
        <Icon size={14} className={toneCls} /> {label}
      </div>
      <div className="text-2xl font-semibold text-[var(--text-primary)] tabular-nums">{value}</div>
    </div>
  );
}

function Dot({ state, up = "Up", down = "Down" }) {
  if (state == null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] opacity-50" />—
      </span>
    );
  }
  return state ? (
    <span className="inline-flex items-center gap-1.5 text-emerald-500">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />{up}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-red-500">
      <span className="h-2 w-2 rounded-full bg-red-500" />{down}
    </span>
  );
}

function Uptime({ pct }) {
  if (pct == null) return <span className="text-[var(--text-tertiary)] text-xs">collecting…</span>;
  const cls = pct >= 99 ? "text-emerald-500" : pct >= 90 ? "text-amber-500" : "text-red-500";
  return <span className={`font-medium tabular-nums ${cls}`}>{pct}%</span>;
}
