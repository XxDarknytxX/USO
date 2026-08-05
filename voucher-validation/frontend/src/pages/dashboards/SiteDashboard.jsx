// src/pages/dashboards/SiteDashboard.jsx
// Per-village dashboard — shown when a village is selected in the switcher.
// One village's live network health + voucher inventory, scoped by groupId.

import { useEffect, useState, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Gauge, ArrowLeft, RefreshCw, Wifi, WifiOff, Users, Radio, Activity,
  Ticket, Server, Cpu, Router as RouterIcon, DollarSign, TrendingUp,
} from "lucide-react";
import { useSite } from "../../hooks/useSite";
import { voucherApi, networkApi, portalConfigApi } from "../../services/api";
import PlanBreakdown from "../../components/PlanBreakdown";
import StarlinkPanel from "../../components/StarlinkPanel";
import MonthlyBreakdown from "../../components/MonthlyBreakdown";
import MonthPicker from "../../components/MonthPicker";
import { useMonthlyBreakdown } from "../../hooks/useMonthlyBreakdown";
import {
  PageHeader, Button, StatCard, Panel, Badge, EmptyState,
  SkeletonKpis, SkeletonCard,
  CHART_COLORS, ChartTooltip, ChartGradient, useChartTheme,
  ChartStat, LegendRow, axisX, axisY, gridProps, BAR_RADIUS, BAR_MAX_SIZE, BAR_CATEGORY_GAP,
} from "../../components/ui";

const fmtBytes = (b) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString());
const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hourLabel = (t) => {
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})/);
  return m ? `${m[4]}:00` : String(t).slice(5, 16);
};

const DEVICE_ICON = { gateway: RouterIcon, ap: Wifi, switch: Server, other: Cpu };

export default function SiteDashboard({ groupId, site }) {
  const { setActiveSiteId } = useSite();
  // One month drives every historical figure on this page.
  const mb = useMonthlyBreakdown(groupId);
  const ct = useChartTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      const [stats, overview, trend, health, revenue] = await Promise.allSettled([
        voucherApi.stats({ groupId }),
        networkApi.overview({ uptimeHours: 24 }),
        networkApi.trend({ hours: 24, groupId }),
        site?.id ? networkApi.health(site.id) : Promise.resolve(null),
        groupId ? portalConfigApi.revenue({ groupId }) : Promise.resolve(null),
      ]);
      setData({
        stats: stats.status === "fulfilled" ? stats.value : null,
        overview: overview.status === "fulfilled" ? overview.value : null,
        trend: trend.status === "fulfilled" ? trend.value : null,
        health: health.status === "fulfilled" ? health.value : null,
        revenue: revenue.status === "fulfilled" ? revenue.value : null,
      });
      setLoading(false);
      setRefreshing(false);
    },
    [groupId, site?.id]
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const overviewSite =
    data?.overview?.sites?.find((s) => String(s.groupId) === String(groupId)) || null;
  const pkg = data?.stats?.packageStats || [];
  const sum = (f) => pkg.reduce((a, p) => a + (Number(f(p)) || 0), 0);
  const vTotal = data?.stats?.totalVouchers ?? sum((p) => p.total);
  const vActive = sum((p) => p.active);
  const vUnused = sum((p) => p.unused);
  const vExpired = sum((p) => p.expired);
  const vInactive = sum((p) => p.inactive);
  const live = sum((p) => p.currently_in_use);
  const vSold = Math.max(0, vTotal - vUnused);            // claimed (active+expired+inactive)
  const vDataUsedMb = sum((p) => p.total_used_quota_mb);  // voucher data consumed (DB, reliable)
  const health = data?.health;
  const internetUp = health?.internet?.up ?? overviewSite?.internetUp ?? null;
  const clients = health?.summary?.clients ?? overviewSite?.clients ?? 0;
  const apOnline = health?.summary?.apOnline ?? overviewSite?.apsOnline ?? 0;
  const apTotal = health?.summary?.apTotal ?? overviewSite?.apsTotal ?? 0;
  const uptimePct = overviewSite?.uptimePct;
  const usageBytes = health?.usageBytes ?? overviewSite?.usageBytes;
  const devices = health?.devices || [];

  const revenue = data?.revenue;
  const revTrend = (revenue?.monthly || []).map((m) => ({
    label: m.label,
    revenue: Number(m.revenue || 0),
    count: Number(m.count || 0),
  }));
  const hasRevenue = revenue && (revenue.totalCount > 0 || revenue.total > 0);

  const statusData = [
    { name: "Active", value: vActive, color: CHART_COLORS.emerald },
    { name: "Unused", value: vUnused, color: CHART_COLORS.blue },
    { name: "Expired", value: vExpired, color: CHART_COLORS.amber },
    { name: "Inactive", value: vInactive, color: CHART_COLORS.slate },
  ].filter((d) => d.value > 0);
  // Stacked composition per plan — bar height = total; segments show the split.
  const pkgBar = pkg
    .map((p) => ({
      name: p.package_name,
      Active: Number(p.active || 0),
      Expired: Number(p.expired || 0),
      Left: Number(p.unused || 0),
    }))
    .slice(0, 8);
  const trendPts = (data?.trend?.points || []).map((p) => ({
    t: hourLabel(p.t),
    clients: p.clients,
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-up">
      <PageHeader
        eyebrow="Village"
        title={site?.name || "Village"}
        subtitle={site?.hostname || (groupId ? `Ruijie group ${groupId}` : "")}
        icon={<Gauge size={20} />}
        actions={
          <>
            <MonthPicker state={mb} />
            <Button variant="secondary" size="sm" iconLeft={<ArrowLeft size={14} />} onClick={() => setActiveSiteId(null)}>
              All villages
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
              onClick={() => load(true)}
              disabled={refreshing}
            >
              Refresh
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="mt-6 space-y-6">
          <SkeletonKpis count={4} />
          <SkeletonCard height="h-72" />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* KPI rail */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Internet"
              value={internetUp == null ? "Unknown" : internetUp ? "Online" : "Offline"}
              icon={internetUp ? <Wifi size={18} /> : <WifiOff size={18} />}
              color={internetUp == null ? "slate" : internetUp ? "emerald" : "rose"}
              sub={overviewSite?.publicIp || health?.internet?.publicIp || ""}
            />
            <StatCard label="Clients online" value={fmtNum(clients)} icon={<Users size={18} />} color="blue" />
            <StatCard label="Access points" value={apTotal ? `${apOnline}/${apTotal}` : "—"} icon={<Radio size={18} />} color="violet" sub="online" />
            <StatCard
              label="Uptime 24h"
              value={uptimePct == null ? "—" : `${uptimePct}%`}
              icon={<Activity size={18} />}
              color={uptimePct == null ? "slate" : uptimePct >= 99 ? "emerald" : uptimePct >= 90 ? "amber" : "rose"}
            />
          </div>

          {/* Voucher stock — current inventory, deliberately NOT month-scoped:
              "how many are left to sell" is a now question, not a July one. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Vouchers" value={fmtNum(vTotal)} icon={<Ticket size={18} />} color="accent" sub={`${fmtNum(vUnused)} left to sell`} />
            <StatCard label="Sold" value={fmtNum(vSold)} icon={<Ticket size={18} />} color="violet" sub={vTotal ? `${Math.round((vSold / vTotal) * 100)}% of pool · ${fmtNum(vActive)} active` : "—"} />
            <StatCard label="Live now" value={fmtNum(live)} icon={<Users size={18} />} color="amber" />
            <StatCard label="Data used" value={fmtBytes(vDataUsedMb * 1024 * 1024)} icon={<Activity size={18} />} color="cyan" sub="all time, this village" />
          </div>

          {/* Sales rail — scoped to the month chosen in the header. The
              labels say which month so a figure can never be mistaken for
              all-time, which is exactly what the old "total" card was. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={`Revenue · ${mb.label || "month"}`}
              value={fmtMoney(mb.totals.revenue)}
              icon={<DollarSign size={18} />}
              color="accent"
              sub={`${fmtNum(mb.totals.transactions || 0)} sale${mb.totals.transactions === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Vouchers sold"
              value={fmtNum(mb.totals.sold || 0)}
              icon={<TrendingUp size={18} />}
              color="emerald"
              sub={`${fmtNum(mb.totals.customers || 0)} customers`}
            />
            <StatCard
              label="Avg sale"
              value={fmtMoney(mb.totals.avgSale)}
              icon={<Activity size={18} />}
              color="violet"
            />
            <StatCard
              label="Got online"
              value={`${mb.totals.connectedPct ?? 0}%`}
              icon={<Wifi size={18} />}
              color={(mb.totals.connectedPct ?? 0) >= 95 ? "emerald" : (mb.totals.connectedPct ?? 0) >= 80 ? "amber" : "rose"}
              sub={`${fmtNum(mb.totals.connected || 0)} of ${fmtNum(mb.totals.transactions || 0)}`}
            />
          </div>

          {/* Starlink kit + data usage. Self-fetching and self-hiding: renders
              nothing at all when this village has no Starlink configured. */}
          {site?.id && <StarlinkPanel projectId={site.id} />}

          {/* Sales for a chosen month — replaces the old fixed 6-month
              revenue bar, which could only ever show one window. */}
          <MonthlyBreakdown state={mb} groupId={groupId} />

          {/* Trend */}
          <Panel title="Clients" subtitle="Last 24 hours" icon={<Activity size={15} />}>
            {trendPts.length === 0 ? (
              <EmptyState icon={Activity} title="No trend data yet" description="The monitor collects a sample every ~5 minutes." />
            ) : (
              <>
                <ChartStat
                  value={fmtNum(trendPts[trendPts.length - 1]?.clients ?? 0)}
                  unit="online now"
                  caption={`Peak ${fmtNum(Math.max(...trendPts.map((p) => p.clients || 0)))} in the last 24 hours`}
                />
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={trendPts} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <defs><ChartGradient id="siteClients" color={CHART_COLORS.accent} /></defs>
                    <CartesianGrid {...gridProps(ct)} />
                    <XAxis dataKey="t" {...axisX(ct, { minTickGap: 24 })} />
                    <YAxis {...axisY(ct, { width: 36 })} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: ct.axisLine }} />
                    <Area type="monotone" dataKey="clients" name="Clients" stroke={CHART_COLORS.accent} strokeWidth={2} fill="url(#siteClients)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            )}
          </Panel>

          {/* Vouchers + packages */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Vouchers by status" icon={<Ticket size={15} />}>
              {statusData.length === 0 ? (
                <EmptyState icon={Ticket} title="No vouchers" description="This village has no vouchers yet." />
              ) : (
                <div className="flex items-center gap-5">
                  {/* Donut with the total stated in the hole, so the chart
                      answers "how many" without reading the legend. */}
                  <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} cornerRadius={6} isAnimationActive={false} stroke="none">
                          {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip hideLabel />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-semibold text-[var(--fg-primary)] tabular-nums leading-none">
                        {fmtNum(statusData.reduce((a, d) => a + d.value, 0))}
                      </span>
                      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-muted)] mt-1">Vouchers</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2.5">
                    {statusData.map((d) => (
                      <LegendRow
                        key={d.name}
                        color={d.color}
                        label={d.name}
                        value={fmtNum(d.value)}
                        total={statusData.reduce((a, x) => a + x.value, 0)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="By package" icon={<Ticket size={15} />}>
              {pkgBar.length === 0 ? (
                <EmptyState icon={Ticket} title="No packages" />
              ) : (
                <ResponsiveContainer width="100%" height={216}>
                  <BarChart data={pkgBar} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
                    <CartesianGrid {...gridProps(ct)} />
                    <XAxis dataKey="name" {...axisX(ct, { tick: { fill: ct.axis, fontSize: 10 }, interval: 0, angle: -12, textAnchor: "end", height: 40 })} />
                    <YAxis {...axisY(ct, { width: 32 })} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: ct.cursor }} />
                    <Bar dataKey="Active" stackId="a" fill={CHART_COLORS.emerald} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                    <Bar dataKey="Expired" stackId="a" fill={CHART_COLORS.amber} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                    <Bar dataKey="Left" stackId="a" fill={CHART_COLORS.accent} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          {/* Full plan breakdown — total / sold / active / expired / left / data used, per plan */}
          <Panel title="Plan breakdown" subtitle="Sold · Active · Expired · Left · Data used — per voucher plan" icon={<Ticket size={15} />}>
            <PlanBreakdown packages={pkg} formatQuota={(mb) => fmtBytes(Number(mb || 0) * 1024 * 1024)} color={CHART_COLORS.accent} />
          </Panel>

          {/* Devices */}
          <Panel title="Network devices" subtitle={health ? `${devices.length} device${devices.length === 1 ? "" : "s"}` : "Live data unavailable"} icon={<Server size={15} />} padding={false}>
            {devices.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={Server} title={health ? "No devices reported" : "Couldn't reach Ruijie Cloud"} description={health ? "" : "The live device list is temporarily unavailable."} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-[var(--border-default)]">
                      <Th>Device</Th><Th>Type</Th><Th>Status</Th><Th>Clients</Th><Th>Model</Th><Th>IP</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-default)]">
                    {devices.map((d, i) => {
                      const Icon = DEVICE_ICON[d.type] || Cpu;
                      return (
                        <tr key={d.sn || i} className="hover:bg-[var(--bg-surface)]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[var(--fg-muted)]"><Icon size={15} /></span>
                              <span className="font-medium text-[var(--fg-primary)] truncate">{d.name || d.sn}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 capitalize text-[var(--fg-secondary)]">{d.type}</td>
                          <td className="px-4 py-3">
                            <Badge tone={d.online ? "success" : "danger"} dot>{d.online ? "Online" : "Offline"}</Badge>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-[var(--fg-secondary)]">{d.clientCount ?? "—"}</td>
                          <td className="px-4 py-3 text-[var(--fg-secondary)]">{d.model || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[var(--fg-muted)]">{d.mgmtIp || d.publicIp || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-4 py-2.5 text-label font-medium">{children}</th>;
}

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload || {};
  return (
    <div className="rounded-lg px-3 py-2 text-sm bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium text-[var(--fg-muted)] mb-1">{label}</p>
      <p className="font-semibold text-[var(--fg-primary)] tabular-nums">{fmtMoney(d.revenue)}</p>
      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
        {Number(d.count || 0).toLocaleString()} sale{Number(d.count) === 1 ? "" : "s"}
      </p>
    </div>
  );
}
