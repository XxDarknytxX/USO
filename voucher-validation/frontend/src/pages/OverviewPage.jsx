// src/pages/OverviewPage.jsx
// All-villages network overview (NOC-style): live status + uptime % + usage,
// served from the background collector snapshots. Auto-refreshes every 30s.

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Globe, RefreshCw, Users, Activity, CheckCircle2, XCircle } from "lucide-react";
import { networkApi } from "../services/api";
import { PageHeader, StatCard, Panel, Button } from "../components/ui";
import { useSite } from "../hooks/useSite";

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
  const { isInScope } = useSite();
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
    // Cheap poll: re-reads the stored snapshot only, no Ruijie calls.
    timer.current = setInterval(() => load(true), 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  // Refresh means COLLECT — go to Ruijie for every village and rewrite the
  // snapshots, then re-read. Without this the button only re-fetched the same
  // stored numbers, so a stale page stayed stale however often you pressed it.
  //
  // It is deliberately all-villages: the page compares villages side by side,
  // and refreshing one at a time would show them measured at different moments.
  // Takes the better part of a minute for ~30 villages (the Ruijie limiter
  // spaces every call), and is admin-only server-side.
  const [collecting, setCollecting] = useState(false);
  const collectAndReload = useCallback(async () => {
    setCollecting(true);
    const tid = toast.loading("Collecting every village from Ruijie… this takes a moment");
    try {
      const r = await networkApi.collectNow();
      toast.success(
        `${r.villagesUpdated ?? "?"}/${r.villagesTotal ?? "?"} villages refreshed` +
          (r.joinedExisting ? " (joined a run already in progress)" : ""),
        { id: tid, duration: 6000 }
      );
    } catch (e) {
      // Non-admins cannot collect; still give them the freshest stored numbers.
      toast.error(
        /403|forbidden|admin/i.test(e.message || "")
          ? "Only an admin can refresh from Ruijie — showing the last collected values."
          : `Collection failed: ${e.message}`,
        { id: tid, duration: 7000 }
      );
    } finally {
      await load(true);
      setCollecting(false);
    }
  }, [load]);

  // Follow the scope switcher: a single village → just that one; All Villages →
  // the configured scope set (Settings). Recompute the summary from the subset.
  const sites = (data?.sites || []).filter((v) => isInScope(v.id));
  const sum = (f) => sites.reduce((a, v) => a + (Number(f(v)) || 0), 0);
  const s = data
    ? {
        villagesTotal: sites.length,
        villagesUp: sites.filter((v) => v.online === true).length,
        villagesDown: sites.filter((v) => v.online === false).length,
        clients: sum((v) => v.clients),
        usageBytes: sum((v) => v.usageBytes),
      }
    : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Network"
        title="Overview"
        subtitle={`Every village at a glance${data?.lastCollected ? ` · updated ${timeAgo(data.lastCollected)}` : ""}`}
        icon={<Globe size={20} />}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={collectAndReload}
            disabled={collecting}
            iconLeft={<RefreshCw size={14} className={collecting || refreshing ? "animate-spin" : ""} />}
          >
            {collecting ? "Collecting…" : "Refresh all"}
          </Button>
        }
      />

      {/* Summary */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Villages up"
          value={s ? `${s.villagesUp}/${s.villagesTotal}` : "—"}
          color="emerald"
        />
        <StatCard
          icon={<XCircle size={18} />}
          label="Villages down"
          value={s ? s.villagesDown : "—"}
          color={s?.villagesDown ? "rose" : "slate"}
        />
        <StatCard icon={<Users size={18} />} label="Clients online" value={s ? s.clients : "—"} color="blue" />
        <StatCard icon={<Activity size={18} />} label="Usage today" value={s ? fmtBytes(s.usageBytes) : "—"} color="violet" />
      </div>

      {/* Villages table */}
      <div className="mt-5">
        <Panel padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--border-default)]">
                  <Th>Village</Th><Th>Status</Th><Th>Internet</Th><Th>Gateway</Th>
                  <Th>APs</Th><Th>Clients</Th><Th>Usage</Th><Th>Uptime 24h</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--fg-muted)]">Loading…</td></tr>
                ) : sites.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--fg-muted)]">{(data?.sites?.length ?? 0) > 0 ? "No villages in the current scope — adjust the All Villages scope in Settings." : "No villages yet — add sites under Network."}</td></tr>
                ) : sites.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate("/network")}
                    className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--fg-primary)]">{v.name}</div>
                      <div className="text-xs font-mono text-[var(--fg-muted)]">{v.hostname || `group ${v.groupId || "—"}`}</div>
                    </td>
                    <td className="px-4 py-3"><Dot state={v.online} up="Online" down="Down" /></td>
                    <td className="px-4 py-3"><Dot state={v.internetUp} up="Up" down="Down" /></td>
                    <td className="px-4 py-3"><Dot state={v.gatewayOnline} up="Online" down="Offline" /></td>
                    <td className="px-4 py-3 text-[var(--fg-secondary)] tabular-nums">{v.apsTotal ? `${v.apsOnline}/${v.apsTotal}` : "—"}</td>
                    <td className="px-4 py-3 text-[var(--fg-secondary)] tabular-nums">{v.clients ?? 0}</td>
                    <td className="px-4 py-3 text-[var(--fg-secondary)] tabular-nums">{fmtBytes(v.usageBytes)}</td>
                    <td className="px-4 py-3"><Uptime pct={v.uptimePct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {!loading && sites.some((v) => v.uptimePct == null) && (
        <p className="mt-3 text-xs text-[var(--fg-muted)]">
          Uptime fills in as the background monitor collects samples (every ~5 min) — give it a little while after the first deploy.
        </p>
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-4 py-2.5 text-label">{children}</th>;
}

function Dot({ state, up = "Up", down = "Down" }) {
  if (state == null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--fg-muted)]">
        <span className="h-2 w-2 rounded-full bg-[var(--fg-muted)] opacity-50" />—
      </span>
    );
  }
  return state ? (
    <span className="inline-flex items-center gap-1.5" style={{ color: "var(--success)" }}>
      <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />{up}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5" style={{ color: "var(--error)" }}>
      <span className="h-2 w-2 rounded-full" style={{ background: "var(--error)" }} />{down}
    </span>
  );
}

function Uptime({ pct }) {
  if (pct == null) return <span className="text-[var(--fg-muted)] text-xs">collecting…</span>;
  const color = pct >= 99 ? "var(--success)" : pct >= 90 ? "var(--warning)" : "var(--error)";
  return <span className="font-medium tabular-nums" style={{ color }}>{pct}%</span>;
}
