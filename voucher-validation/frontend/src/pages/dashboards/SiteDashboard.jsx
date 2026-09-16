// src/pages/dashboards/SiteDashboard.jsx
// Per-village dashboard — shown when a village is selected in the switcher.
// One village's live network health + voucher inventory, scoped by groupId.
//
// Deliberately the same page as the estate dashboard, minus the villages table
// and plus this village's own network detail: same header, same four headline
// KPIs, same revenue-trend-beside-plan-mix row, same analysis tabs. Switching
// scope in the sidebar should feel like the page re-scoping, not like landing
// on a different product — which is exactly how the two used to read.

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Gauge, ArrowLeft, RefreshCw, Wifi, WifiOff, Users, Radio, Activity,
  Ticket, Server, Cpu, Router as RouterIcon, DollarSign, TrendingUp,
  HardDrive, PackageOpen, Database,
} from "lucide-react";
import { useSite } from "../../hooks/useSite";
import { useAuth } from "../../hooks/useAuth";
import { voucherApi, networkApi, portalConfigApi } from "../../services/api";
import PlanBreakdown from "../../components/PlanBreakdown";
import StarlinkPanel from "../../components/StarlinkPanel";
import StarlinkTelemetry from "../../components/StarlinkTelemetry";
import MonthPicker from "../../components/MonthPicker";
import { useMonthlyBreakdown } from "../../hooks/useMonthlyBreakdown";
import {
  hasSalesHistory, BreakdownEmpty,
  RevenueTrendPanel, RevenuePlanMix, SalesTotals, RiskTotals,
  SalesByHourPanel, SoldByPlanPanel, OutcomesPanel, PlansPurchasedPanel,
} from "../../components/MonthlyBreakdown";
import {
  PageShell, PageHeader, KpiGrid, StatCard, Panel, Tabs, Button,
  DataTable, Th, Td, RecordCell, StatusPill, EmptyState,
  SkeletonKpis, SkeletonCard,
  CHART_COLORS, STATUS_COLORS, ChartTooltip, ChartGradient,
  useChartTheme, ChartStat, LegendRow, LegendRows, DONUT, DonutCenter,
  axisX, axisY, gridProps, BAR_RADIUS, BAR_MAX_SIZE, BAR_CATEGORY_GAP,
} from "../../components/ui";

const fmtBytes = (b) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString());
const fmtGb = (n) => {
  const v = Number(n || 0);
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
};
const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hourLabel = (t) => {
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})/);
  return m ? `${m[4]}:00` : String(t).slice(5, 16);
};

const DEVICE_ICON = { gateway: RouterIcon, ap: Wifi, switch: Server, other: Cpu };
const DEVICE_TONE = { gateway: "indigo", ap: "teal", switch: "violet", other: "slate" };

export default function SiteDashboard({ groupId, site }) {
  const { setActiveSiteId } = useSite();
  // The voucher list is an admin page; for anyone else these are not links.
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  // One window drives every historical figure on this page.
  const mb = useMonthlyBreakdown(groupId);
  const ct = useChartTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("sales");

  // Opens this village's vouchers for one plan. VouchersPage already scopes
  // itself to the village in the switcher, so only the plan has to travel —
  // and it arrives as a filter the operator can see and widen, rather than a
  // hidden query they cannot undo.
  // Carries the WINDOW as well as the plan, so the list shows the exact
  // vouchers the figure was summed from rather than every voucher that happens
  // to share the plan name. The server resolves which codes those are from the
  // audit log, because the vouchers table records when a voucher was generated,
  // not when it was bought.
  const openVouchers = useCallback(
    (plan) => {
      const q = new URLSearchParams();
      if (plan?.name) q.set("package", plan.name);
      if (mb.fromDate) q.set("soldFrom", mb.fromDate);
      if (mb.toDate) q.set("soldTo", mb.toDate);
      navigate(`/vouchers?${q.toString()}`);
    },
    [navigate, mb.fromDate, mb.toDate]
  );
  const openPlanVouchers = isAdmin ? openVouchers : undefined;

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
  // The village's OVERALL verdict, which is now Starlink-led and tri-state.
  //
  // This deliberately prefers `online` over the Ruijie `internet.up` reading it
  // used to take. Reading internetUp here while the Dashboard, Overview and the
  // sidebar all read `online` is how the same village ends up with a green dot
  // in the switcher and a red "no internet" banner on its own page — they would
  // be answering different questions and only one of them would say so.
  //
  // The Ruijie reading is still kept below, under its own name, because the
  // network tab genuinely describes the local gateway link.
  const internetUp =
    overviewSite?.online !== undefined
      ? overviewSite.online
      : (health?.internet?.up ?? overviewSite?.internetUp ?? null);
  const onlineSource = overviewSite?.onlineSource ?? null;
  const gatewayWanUp = health?.internet?.up ?? overviewSite?.internetUp ?? null;
  const starlink = overviewSite?.starlink ?? null;
  const clients = health?.summary?.clients ?? overviewSite?.clients ?? 0;
  const apOnline = health?.summary?.apOnline ?? overviewSite?.apsOnline ?? 0;
  const apTotal = health?.summary?.apTotal ?? overviewSite?.apsTotal ?? 0;
  const uptimePct = overviewSite?.uptimePct;
  const usageBytes = health?.usageBytes ?? overviewSite?.usageBytes;
  const publicIp = overviewSite?.publicIp || health?.internet?.publicIp || "";
  const devices = health?.devices || [];

  const revenue = data?.revenue;

  // Data this village's customers bought in the SELECTED WINDOW, from the same
  // transactions as the revenue above it. mb is already scoped to this village,
  // so summing its plans is the village total.
  const purchased = (mb.data?.byPlan || []).reduce(
    (a, p) => ({
      mb: a.mb + Number(p.purchasedMb || 0),
      used: a.used + Number(p.usedMb || 0),
      sales: a.sales + Number(p.count || 0),
    }),
    { mb: 0, used: 0, sales: 0 }
  );

  // Expired takes amber rather than STATUS_COLORS.expired: that token is slate,
  // which is also the only sensible colour for Inactive, and two identical
  // slices in one donut is not a chart.
  const statusData = [
    { name: "Active", value: vActive, color: STATUS_COLORS.active },
    { name: "Unused", value: vUnused, color: STATUS_COLORS.unused },
    { name: "Expired", value: vExpired, color: CHART_COLORS.amber },
    { name: "Inactive", value: vInactive, color: CHART_COLORS.slate },
  ].filter((d) => d.value > 0);
  const statusTotal = statusData.reduce((a, d) => a + d.value, 0);

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

  const headerActions = (
    <>
      <MonthPicker state={mb} compact />
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
  );

  if (loading) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Village"
          title={site?.name || "Village"}
          subtitle={site?.hostname || (groupId ? `Ruijie group ${groupId}` : "")}
          icon={<Gauge size={22} />}
          tone="navy"
          actions={headerActions}
        />
        <SkeletonKpis count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
          <SkeletonCard height="h-[400px]" />
          <SkeletonCard height="h-[400px]" />
        </div>
      </PageShell>
    );
  }

  const tabs = [
    { value: "sales", label: "Sales" },
    { value: "outcomes", label: "Outcomes" },
    { value: "plans", label: "Plans" },
    { value: "capacity", label: "Capacity" },
    { value: "network", label: "Network" },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Village"
        title={site?.name || "Village"}
        subtitle={site?.hostname || (groupId ? `Ruijie group ${groupId}` : "")}
        icon={<Gauge size={22} />}
        tone="navy"
        actions={headerActions}
      />

      {/* Only shown when the link is actually down — the Network KPI already
          says "Online" the rest of the time. */}
      {internetUp === false && (
        <div className="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl border bg-[var(--danger-soft)] border-[var(--danger-border)] text-[var(--danger-fg)]">
          <WifiOff size={17} className="shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold font-display">This village has no internet</span>
            <span className="block text-[12px] opacity-80">
              {onlineSource === "telemetry"
                ? `The Starlink dish has not reported${starlink?.ageSeconds ? ` for ${Math.round(starlink.ageSeconds / 3600)}h` : ""}. Customers cannot connect.`
                : "The last collector snapshot could not reach the gateway. Customers cannot connect."}
            </span>
          </span>
        </div>
      )}

      {/* The middle state. Silence for a while is not proof of an outage, and
          saying so plainly is better than a red banner that might be wrong or
          no banner at all, which would read as "fine". */}
      {internetUp === null && onlineSource === "telemetry" && (
        <div className="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl border bg-[var(--warning-soft)] border-[var(--warning-border)] text-[var(--warning-fg)]">
          <WifiOff size={17} className="shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold font-display">No recent word from this village</span>
            <span className="block text-[12px] opacity-80">
              The dish last reported{starlink?.ageSeconds ? ` ${Math.round(starlink.ageSeconds / 60)} minutes ago` : " a while ago"}.
              That may be a brief gap rather than an outage — check again shortly.
            </span>
          </span>
        </div>
      )}

      {/* Four headline KPIs, the same four as the estate dashboard. Every other
          figure lives in the tab it belongs to. */}
      <KpiGrid cols={5}>
        <StatCard
          label={`Revenue · ${mb.label || "month"}`}
          value={fmtMoney(mb.totals.revenue)}
          icon={<DollarSign size={18} />}
          color="accent"
          sub={`${fmtNum(mb.totals.transactions || 0)} sale${mb.totals.transactions === 1 ? "" : "s"} · ${fmtMoney(mb.totals.avgSale)} avg`}
        />
        <StatCard
          label="Vouchers sold"
          value={fmtNum(mb.totals.sold || 0)}
          icon={<TrendingUp size={18} />}
          color="violet"
          sub={`${fmtNum(mb.totals.customers || 0)} customers · ${mb.label || "month"}`}
        />
        <StatCard
          label="Live users"
          value={fmtNum(live)}
          icon={<Users size={18} />}
          color="blue"
          sub={`${fmtNum(clients)} client${clients === 1 ? "" : "s"} on Wi-Fi`}
        />
        <StatCard
          label="Network"
          value={internetUp == null ? "Unknown" : internetUp ? "Online" : "Offline"}
          icon={internetUp ? <Wifi size={18} /> : <WifiOff size={18} />}
          color={internetUp == null ? "slate" : internetUp ? "emerald" : "rose"}
          // "gateway uptime", not "uptime": this tile's VALUE is the Starlink
          // verdict and this figure is the Ruijie gateway's WAN history. Two
          // layers, two questions, and running them together unlabelled is how
          // "Unknown · 99.3% uptime" reads as a contradiction rather than as
          // the genuinely useful fact that the dish is quiet while the local
          // link has been solid.
          sub={uptimePct == null ? publicIp || "no uptime data" : `gateway uptime ${uptimePct}% · 24h`}
        />
        {/* What customers bought in this window, and the way into the vouchers
            behind it. Clickable because the figure on its own cannot answer the
            question it prompts — "which vouchers, and who has them". */}
        <StatCard
          label="Data purchased"
          value={purchased.mb ? `${fmtGb(purchased.mb / 1024)} GB` : "—"}
          icon={<HardDrive size={18} />}
          color="teal"
          sub={
            purchased.sales
              ? `${fmtNum(purchased.sales)} sale${purchased.sales === 1 ? "" : "s"} · ${mb.label || "this month"}`
              : `nothing sold · ${mb.label || "this month"}`
          }
          onClick={isAdmin ? () => openVouchers(null) : undefined}
        />
      </KpiGrid>

      {/* Same primary chart row as the estate dashboard. */}
      {hasSalesHistory(mb) ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
          <RevenueTrendPanel state={mb} />
          <RevenuePlanMix state={mb} />
        </div>
      ) : (
        <Panel title="Sales" icon={<DollarSign size={15} />} tone="red">
          <BreakdownEmpty />
        </Panel>
      )}

      {/* Sits in the main flow rather than behind the Plans tab: this is the
          way from a figure to the vouchers under it, and a drill-down nobody
          finds is not one. Reads in order after the revenue charts — what we
          earned, then what we sold to earn it. */}
      {hasSalesHistory(mb) && (
        <PlansPurchasedPanel state={mb} onOpenPlan={openPlanVouchers} />
      )}

      {/* The Starlink pair, deliberately adjacent: usage says how much this
          village consumed, link quality says what the connection was like while
          they consumed it. An operator holding a complaint needs both at once —
          "slow" and "used their whole allowance" are different problems with
          different answers, and either one alone invites the wrong one.

          Both are self-fetching and self-hiding, so a village with no kit
          recorded renders neither. */}
      {site?.id && (
        // Half and half, the way the Starlink console arranges the same pair:
        // how much the village consumed on one side, what the link was like
        // while they consumed it on the other, both in one view. Full width
        // each was a lot of scrolling to compare two things that only mean
        // something together.
        //
        // Stacks below xl. At 1280px and under, two half-width charts are
        // narrower than the data in them, and a cramped chart answers nothing.
        //
        // The two stretch to a common height (grid's default), and the usage
        // panel spends the slack on a taller plot rather than on empty space —
        // see its `compact` branch. Equal heights only read as deliberate when
        // both cards are actually full.
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <StarlinkPanel projectId={site.id} compact />
          <StarlinkTelemetry projectId={site.id} compact />
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} variant="underline" />

        {tab === "sales" && (
          <div className="flex flex-col gap-5">
            <SalesTotals state={mb} />
            <SalesByHourPanel state={mb} />
            {/* All-time figures, scoped to this village by groupId. */}
            {revenue && (
              <Panel title="All-time revenue" subtitle="Every month on record for this village" icon={<DollarSign size={15} />} tone="red">
                <ChartStat
                  value={fmtMoney(revenue.total)}
                  unit="since launch"
                  caption={`${fmtNum(revenue.totalCount || 0)} paid transactions across ${fmtNum((revenue.monthly || []).length)} month${(revenue.monthly || []).length === 1 ? "" : "s"}`}
                />
              </Panel>
            )}
          </div>
        )}

        {tab === "outcomes" && (
          <div className="flex flex-col gap-5">
            <RiskTotals state={mb} />
            <OutcomesPanel state={mb} />
          </div>
        )}

        {tab === "plans" && (
          <div className="flex flex-col gap-5">
            <SoldByPlanPanel state={mb} />
            <Panel
              title="Plan breakdown"
              subtitle="Sold · Active · Expired · Left · Data used — per voucher plan"
              icon={<Ticket size={15} />}
              tone="indigo"
              padding={false}
            >
              <PlanBreakdown packages={pkg} formatQuota={(q) => fmtBytes(Number(q || 0) * 1024 * 1024)} />
            </Panel>
          </div>
        )}

        {tab === "capacity" && (
          <div className="flex flex-col gap-5">
            {/* Voucher stock — current inventory, deliberately NOT window-scoped:
                "how many are left to sell" is a now question, not a July one. */}
            <KpiGrid cols={4}>
              <StatCard label="Vouchers" value={fmtNum(vTotal)} icon={<Database size={18} />} color="indigo" sub={`${fmtNum(vUnused)} left to sell`} />
              <StatCard label="Sold" value={fmtNum(vSold)} icon={<Ticket size={18} />} color="violet" sub={vTotal ? `${Math.round((vSold / vTotal) * 100)}% of pool · ${fmtNum(vActive)} active` : "—"} />
              <StatCard label="Live now" value={fmtNum(live)} icon={<Users size={18} />} color="amber" sub="vouchers in use" />
              <StatCard label="Data used" value={fmtBytes(vDataUsedMb * 1024 * 1024)} icon={<HardDrive size={18} />} color="cyan" sub="all time, this village" />
            </KpiGrid>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5">
              <Panel title="Vouchers by status" subtitle="The whole pool for this village" icon={<Ticket size={15} />} tone="blue">
                {statusData.length === 0 ? (
                  <EmptyState icon={Ticket} title="No vouchers" description="This village has no vouchers yet." />
                ) : (
                  <>
                    {/* Donut with the total stated in the hole, so the chart
                        answers "how many" without reading the legend. */}
                    <div className="relative mx-auto" style={{ width: 196, height: 196 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData} dataKey="value" nameKey="name" {...DONUT} isAnimationActive={false}>
                            {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip content={<ChartTooltip hideLabel valueFormatter={fmtNum} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <DonutCenter value={fmtNum(statusTotal)} label="Vouchers" />
                    </div>
                    <LegendRows>
                      {statusData.map((d) => (
                        <LegendRow key={d.name} color={d.color} label={d.name} value={fmtNum(d.value)} amount={d.value} total={statusTotal} />
                      ))}
                    </LegendRows>
                  </>
                )}
              </Panel>

              <Panel title="By package" subtitle="Active · Expired · Left, per plan" icon={<Ticket size={15} />} tone="teal">
                {pkgBar.length === 0 ? (
                  <EmptyState icon={PackageOpen} title="No packages" />
                ) : (
                  <>
                    <ChartStat
                      value={fmtNum(vTotal)}
                      unit="vouchers"
                      caption={`Across ${fmtNum(pkgBar.length)} plan${pkgBar.length === 1 ? "" : "s"}`}
                    />
                    <ResponsiveContainer width="100%" height={252}>
                      <BarChart data={pkgBar} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
                        <CartesianGrid {...gridProps(ct)} />
                        <XAxis dataKey="name" {...axisX(ct, { tick: { fill: ct.axis, fontSize: 10 }, interval: 0, angle: -12, textAnchor: "end", height: 46 })} />
                        <YAxis {...axisY(ct, { width: 32 })} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip valueFormatter={fmtNum} />} cursor={{ fill: ct.cursor }} />
                        <Bar dataKey="Active" stackId="a" fill={STATUS_COLORS.active} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                        <Bar dataKey="Expired" stackId="a" fill={CHART_COLORS.amber} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                        <Bar dataKey="Left" stackId="a" fill={STATUS_COLORS.unused} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                    <LegendRows>
                      <LegendRow color={STATUS_COLORS.active} label="Active" value={fmtNum(vActive)} amount={vActive} total={vTotal} />
                      <LegendRow color={CHART_COLORS.amber} label="Expired" value={fmtNum(vExpired)} amount={vExpired} total={vTotal} />
                      <LegendRow color={STATUS_COLORS.unused} label="Left to sell" value={fmtNum(vUnused)} amount={vUnused} total={vTotal} />
                    </LegendRows>
                  </>
                )}
              </Panel>
            </div>
          </div>
        )}

        {tab === "network" && (
          <div className="flex flex-col gap-5">
            <KpiGrid cols={4}>
              <StatCard
                label="Internet"
                value={internetUp == null ? "Unknown" : internetUp ? "Online" : "Offline"}
                icon={internetUp ? <Wifi size={18} /> : <WifiOff size={18} />}
                color={internetUp == null ? "slate" : internetUp ? "emerald" : "rose"}
                sub={publicIp}
              />
              <StatCard label="Clients online" value={fmtNum(clients)} icon={<Users size={18} />} color="blue" />
              <StatCard label="Access points" value={apTotal ? `${apOnline}/${apTotal}` : "—"} icon={<Radio size={18} />} color="violet" sub="online" />
              <StatCard
                label="Uptime 24h"
                value={uptimePct == null ? "—" : `${uptimePct}%`}
                icon={<Activity size={18} />}
                color={uptimePct == null ? "slate" : uptimePct >= 99 ? "emerald" : uptimePct >= 90 ? "amber" : "rose"}
                sub={usageBytes == null ? "" : `${fmtBytes(usageBytes)} through the gateway`}
              />
            </KpiGrid>

            <Panel title="Clients" subtitle="Last 24 hours" icon={<Activity size={15} />} tone="navy">
              {trendPts.length === 0 ? (
                <EmptyState icon={Activity} title="No trend data yet" description="The monitor collects a sample every ~5 minutes." />
              ) : (
                <>
                  <ChartStat
                    value={fmtNum(trendPts[trendPts.length - 1]?.clients ?? 0)}
                    unit="online now"
                    caption={`Peak ${fmtNum(Math.max(...trendPts.map((p) => p.clients || 0)))} in the last 24 hours`}
                  />
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trendPts} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs><ChartGradient id="siteClients" color={CHART_COLORS.blue} /></defs>
                      <CartesianGrid {...gridProps(ct)} />
                      <XAxis dataKey="t" {...axisX(ct, { minTickGap: 24 })} />
                      <YAxis {...axisY(ct, { width: 36 })} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip valueFormatter={fmtNum} />} cursor={{ stroke: ct.axisLine }} />
                      <Area type="monotone" dataKey="clients" name="Clients" stroke={CHART_COLORS.blue} strokeWidth={2} fill="url(#siteClients)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              )}
            </Panel>

            <Panel
              title="Network devices"
              subtitle={health ? `${devices.length} device${devices.length === 1 ? "" : "s"}` : "Live data unavailable"}
              icon={<Server size={15} />}
              tone="indigo"
              padding={false}
            >
              {devices.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={Server}
                    title={health ? "No devices reported" : "Couldn't reach Ruijie Cloud"}
                    description={health ? "" : "The live device list is temporarily unavailable."}
                  />
                </div>
              ) : (
                <DataTable>
                  <thead>
                    <tr>
                      <Th>Device</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th align="right">Clients</Th>
                      <Th>Model</Th>
                      <Th>IP</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d, i) => {
                      const Icon = DEVICE_ICON[d.type] || Cpu;
                      return (
                        <tr key={d.sn || i}>
                          <Td>
                            <RecordCell
                              tone={DEVICE_TONE[d.type] || "slate"}
                              icon={<Icon size={14} />}
                              title={d.name || d.sn}
                              subtitle={d.sn && d.name ? d.sn : undefined}
                              mono
                            />
                          </Td>
                          <Td className="capitalize">{d.type}</Td>
                          <Td>
                            <StatusPill tone={d.online ? "success" : "danger"}>{d.online ? "Online" : "Offline"}</StatusPill>
                          </Td>
                          <Td align="right" className="tabular-nums">{d.clientCount ?? "—"}</Td>
                          <Td>{d.model || "—"}</Td>
                          <Td mono muted>{d.mgmtIp || d.publicIp || "—"}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PageShell>
  );
}
