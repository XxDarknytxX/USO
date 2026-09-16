// src/pages/Dashboard.jsx
// The estate dashboard — every village, one window, one page.
//
// It used to be an endless scroll: eight KPI tiles, thirty-one village cards,
// then ten stacked chart panels, with revenue/sold/average sale printed twice
// on the way down. The shape now is the one Salesforce uses for a record home:
//
//   header (scope + window + sync) → alerts, only if there are any
//   → four headline KPIs → the revenue trend beside the plan mix
//   → ONE sortable villages table → everything else behind tabs.
//
// Nothing was dropped. Every figure demoted out of the KPI rail reappears in
// the tab it belongs to, and the thirty-one cards became thirty-one rows that
// can be sorted and searched — which the cards never could be.

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Tooltip,
} from "recharts";
import {
  Users, DollarSign, LifeBuoy, Activity, TrendingUp, Database, BarChart3,
  Clock, CheckCircle, Wifi, WifiOff, RefreshCw, Zap, HardDrive, ArrowUpRight,
  Ticket, MapPin, ChevronUp, ChevronDown, PackageOpen, ChevronRight, AlertTriangle,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import PlanBreakdown from "../components/PlanBreakdown";
import { scopePackages } from "../utils/scopePackages";
import { api, voucherApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { useAuth } from "../hooks/useAuth";
import MonthPicker from "../components/MonthPicker";
import { useMonthlyBreakdown } from "../hooks/useMonthlyBreakdown";
import {
  hasSalesHistory, BreakdownEmpty,
  RevenueTrendPanel, RevenuePlanMix, SalesTotals, RiskTotals,
  SalesByHourPanel, SoldByPlanPanel, RevenueByVillagePanel, OutcomesPanel,
  VillageRevenuePanel,
} from "../components/MonthlyBreakdown";
import {
  PageShell, PageHeader, KpiGrid, StatCard, MeterCard, Panel, Toolbar, SearchInput, Tabs,
  DataTable, Th, Td, TableMessage, RecordCell, StatusPill, EmptyState,
  Button, Modal,
  SkeletonKpis, SkeletonCard, SkeletonTable,
  CHART_COLORS, CHART_SERIES, STATUS_COLORS, ChartTooltip, ChartGradient,
  useChartTheme, ChartStat, LegendRow, LegendRows, DONUT, DonutCenter,
  axisX, axisY, gridProps, BAR_RADIUS, BAR_MAX_SIZE, BAR_CATEGORY_GAP,
} from "../components/ui";

const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n || 0).toLocaleString();

// Gigabytes read better without decimals once they are into the hundreds; a
// village on 3.4 GB and one on 1,204 GB want different precision.
const fmtGb = (n) => {
  const v = Number(n || 0);
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
};

// Relative age for the status tooltip. Seconds matter near the online
// threshold; days matter for a dish that has been dark a while.
const fmtAge = (s) => {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

/** Data meters go teal → orange → red, so a village near its allocation reads hot. */
function usageColor(pct) {
  return pct >= 90 ? "var(--danger-fg)" : pct >= 70 ? "var(--tile-orange)" : "var(--tile-teal)";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { sites, setActiveSiteId, isSiteVisible, allVisible } = useSite();
  const { isViewer } = useAuth();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [voucherStats, setVoucherStats] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [revenue, setRevenue] = useState(null);
  // Village uptime/status from the collector snapshots (no Ruijie calls here).
  const [netOverview, setNetOverview] = useState(null);

  const ct = useChartTheme();

  // Ruijie groupIds of the villages currently in the "All Villages" scope.
  // Declared up here because the breakdown below has to be fetched for exactly
  // these villages — server-side, since its totals and series cannot be
  // re-scoped after the fact the way the per-site payloads can.
  const inScopeGroupIds = useMemo(
    () =>
      sites
        .filter((s) => (allVisible ? true : isSiteVisible(s.id)))
        .map((s) => s.ruijieGroupId)
        .filter(Boolean),
    [sites, allVisible, isSiteVisible]
  );

  // One window drives every historical figure on this page, scoped to the same
  // villages as everything else. `null` when every village is in scope, so
  // transactions that resolve to no village at all still count.
  const mb = useMonthlyBreakdown(null, allVisible ? null : inScopeGroupIds);
  const [manualAssist, setManualAssist] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [drillDownData, setDrillDownData] = useState(null);

  // Villages list controls. The card wall had neither, which is why finding one
  // village among thirty-one meant scrolling and reading.
  const [villageQuery, setVillageQuery] = useState("");
  const [sort, setSort] = useState({ key: "revenue", dir: "desc" });
  const [tab, setTab] = useState("sales");

  // Load from our local DB mirror only — NO automatic Ruijie Cloud sync on
  // login/mount. Opening the dashboard must never hit Ruijie (that was feeding
  // the account-wide code:44 throttle). Fresh data is pulled only when the
  // operator explicitly clicks "Sync now" below (or on the dedicated Sync page).
  useEffect(() => {
    loadDashboardData();
  }, []);

  async function syncNow() {
    setSyncing(true);
    try {
      const { syncId } = await voucherApi.sync();
      const log = await voucherApi.waitForSync(syncId);
      if (!log) {
        toast("Sync still running — data will update shortly.", { icon: "⏳" });
      } else if (log.status === "failed") {
        toast.error("Sync failed: " + (log.error_message || "unknown error"));
      } else {
        toast.success(
          `Sync complete · ${log.total_processed} processed (${log.total_new} new, ${log.total_updated} updated, ${log.total_archived || 0} archived)`
        );
      }
    } catch (err) {
      toast.error("Sync failed: " + (err?.message || "unknown error"));
    } finally {
      setSyncing(false);
    }
    await loadDashboardData();
  }

  async function loadDashboardData() {
    try {
      // Viewers can't reach sync-logs or manual-assistance (403, server-blocked),
      // so skip those fetches entirely — they only get stats + (scoped) revenue.
      const [statsData, logsData, revenueData, maData, netData] = await Promise.all([
        api("/vouchers/stats", { auth: true }),
        isViewer ? Promise.resolve({ logs: [] }) : api("/vouchers/sync-logs", { auth: true }),
        api("/portal-config/revenue", { auth: true }).catch(() => null),
        isViewer ? Promise.resolve(null) : api("/portal-config/manual-assistance?status=open", { auth: true }).catch(() => null),
        // 30 days so daily collection still yields enough samples to mean
        // something — at a 24h window one sample is only ever 0% or 100%.
        api("/network/overview?uptimeHours=720", { auth: true }).catch(() => null),
      ]);
      setVoucherStats(statsData);
      setSyncLogs(logsData.logs || []);
      setRevenue(revenueData);
      setManualAssist(maData);
      setNetOverview(netData);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
      if (
        String(error?.message || "").includes("401") ||
        String(error?.message || "").includes("token")
      ) {
        toast.error("Session expired. Please log in again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePackageDrillDown(packageName) {
    try {
      // Scope the drill-down list to the same in-scope villages as the charts.
      const scopeQs = allVisible ? "" : `&groupIds=${inScopeGroupIds.join(",")}`;
      const data = await api(
        `/vouchers?packageName=${encodeURIComponent(packageName)}&limit=100${scopeQs}`,
        { auth: true }
      );
      setDrillDownData(data);
      setSelectedPackage(packageName);
    } catch (error) {
      console.error("Failed to load package details:", error);
    }
  }

  function formatDuration(minutes) {
    const m = Number(minutes || 0);
    if (m < 60) return `${Math.round(m)}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  }

  function formatQuota(mbVal) {
    const val = Number(mbVal || 0);
    if (val < 1024) return `${val} MB`;
    return `${(val / 1024).toFixed(1)} GB`;
  }

  // Per-plan stats collapsed to only the in-scope villages (falls back to the
  // server's all-villages packageStats if the per-site rollup isn't present).
  const scopedPackageStats = useMemo(
    () =>
      scopePackages(voucherStats?.packageSiteStats, inScopeGroupIds, allVisible) ??
      voucherStats?.packageStats ??
      [],
    [voucherStats, inScopeGroupIds, allVisible]
  );

  const metrics = useMemo(() => {
    const f = scopedPackageStats;
    return {
      totalVouchers: f.reduce((s, p) => s + Number(p.total || 0), 0),
      unusedVouchers: f.reduce((s, p) => s + Number(p.unused || 0), 0),
      activeVouchers: f.reduce((s, p) => s + Number(p.active || 0), 0),
      liveUsers: f.reduce((s, p) => s + Number(p.currently_in_use || 0), 0),
      totalDataUsage: f.reduce(
        (s, p) => s + Number(p.total_used_quota_mb || 0),
        0
      ),
      totalQuota: f.reduce((s, p) => s + Number(p.total_quota_mb || 0), 0),
      expired: f.reduce((s, p) => s + Number(p.expired || 0), 0),
      inactive: f.reduce((s, p) => s + Number(p.inactive || 0), 0),
    };
  }, [scopedPackageStats]);

  // ---- Scope-aware headline numbers (from per-site totals) ----
  const scopedPerSite = useMemo(() => {
    const ps = Array.isArray(voucherStats?.perSite) ? voucherStats.perSite : [];
    return ps.filter((s) => {
      const site = sites.find((x) => String(x.ruijieGroupId) === String(s.group_id));
      return site ? isSiteVisible(site.id) : allVisible;
    });
  }, [voucherStats, sites, isSiteVisible, allVisible]);

  const scopedMetrics = useMemo(() => {
    const f = scopedPerSite;
    const total = f.reduce((s, p) => s + Number(p.total || 0), 0);
    const active = f.reduce((s, p) => s + Number(p.active || 0), 0);
    const unused = f.reduce((s, p) => s + Number(p.unused || 0), 0);
    return {
      totalVouchers: total,
      activeVouchers: active,
      unused,
      sold: Math.max(0, total - unused),
      liveUsers: f.reduce((s, p) => s + Number(p.currently_in_use || 0), 0),
      totalDataUsage: f.reduce((s, p) => s + Number(p.total_used_quota_mb || 0), 0),
      totalQuota: f.reduce((s, p) => s + Number(p.total_quota_mb || 0), 0),
      activeRate: total > 0 ? Math.round((active / total) * 100) : 0,
    };
  }, [scopedPerSite]);

  // Village network status keyed by Ruijie group id, for the villages table.
  const netByGroup = useMemo(() => {
    const map = {};
    for (const v of netOverview?.sites || []) if (v.groupId != null) map[String(v.groupId)] = v;
    return map;
  }, [netOverview]);

  // Health of the villages actually in scope — the estate's headline KPI and
  // the trigger for the "villages down" alert.
  const netHealth = useMemo(() => {
    const scoped = (netOverview?.sites || []).filter((v) => allVisible || isSiteVisible(v.id));
    const uptimes = scoped.map((v) => v.uptimePct).filter((u) => u != null);
    return {
      total: scoped.length,
      up: scoped.filter((v) => v.online === true).length,
      down: scoped.filter((v) => v.online === false).length,
      avgUptime: uptimes.length ? Math.round((uptimes.reduce((a, u) => a + u, 0) / uptimes.length) * 10) / 10 : null,
      // Starlink consumption for the estate, from the SCOPED villages so it
      // moves with the scope switcher like every other figure on this page.
      starlinkUsedGb: scoped.reduce((a, v) => a + (v.starlink?.usedGb || 0), 0),
      // Villages Starlink publishes no cap for are SKIPPED, not counted as
      // zero — a zero in the denominator makes the estate look further from its
      // limit than it is. Null when nothing in scope has a cap at all, so the
      // card can say so rather than meter against nothing.
      starlinkAllowanceGb: scoped.some((v) => v.starlink?.allowanceGb != null)
        ? scoped.reduce((a, v) => a + (v.starlink?.allowanceGb || 0), 0)
        : null,
      withTelemetry: scoped.filter((v) => v.starlink?.configured).length,
      // Distinguishes "no data used" from "the collector has never run".
      usageCollected:
        netOverview?.summary?.usageCollected ??
        scoped.some((v) => v.starlink?.usedGb != null),
    };
  }, [netOverview, allVisible, isSiteVisible]);

  // Per-village revenue for the SELECTED WINDOW. The /revenue payload this used
  // to read is all-time plus a hard-coded current calendar month, so the village
  // rows would sit frozen while the picker moved everything else on the page.
  // The breakdown already returns exactly this, scoped to the same window.
  const revWindowByGroup = useMemo(() => {
    const map = {};
    for (const v of mb.data?.byVillage || []) map[String(v.groupId)] = v;
    return map;
  }, [mb.data]);

  // ---- The villages table: one row per in-scope village ----
  const villageRows = useMemo(() => {
    return scopedPerSite.map((s) => {
      const site = sites.find((x) => String(x.ruijieGroupId) === String(s.group_id));
      const net = netByGroup[String(s.group_id)];
      const rev = revWindowByGroup[String(s.group_id)];
      const usedQ = Number(s.total_used_quota_mb || 0);
      const totalQ = Number(s.total_quota_mb || 0);
      return {
        key: s.group_id || "unknown",
        siteId: site?.id || null,
        name: site?.name || (s.group_id ? `Group ${s.group_id}` : "Unassigned"),
        hostname: site?.hostname || "",
        vouchers: Number(s.total || 0),
        active: Number(s.active || 0),
        live: Number(s.currently_in_use || 0),
        // Both figures are for the window the picker is on, so a village can
        // read $0 — that is a real answer for the window, not missing data.
        revenue: Number(rev?.revenue || 0),
        sales: Number(rev?.count || 0),
        usedQ,
        totalQ,
        dataPct: totalQ ? Math.round((usedQ / totalQ) * 100) : 0,
        online: net ? net.online : undefined,
        onlineSource: net?.onlineSource ?? null,
        uptimePct: net?.uptimePct ?? null,
        apsOnline: net?.apsOnline ?? 0,
        apsTotal: net?.apsTotal ?? 0,
        hasNet: !!net,
        // Starlink: the backhaul's own account of itself. `sl.usedGb` is what
        // the dish actually carried this cycle, which is the figure the old
        // Ruijie voucher-quota column could never give us.
        sl: net?.starlink || null,
        // Sort key for the Starlink column. Villages with no figure sort last
        // rather than as zero, so "nothing reported" never outranks a village
        // that genuinely used very little.
        slUsed: net?.starlink?.usedGb ?? -1,
      };
    });
  }, [scopedPerSite, sites, netByGroup, revWindowByGroup]);

  const visibleVillages = useMemo(() => {
    const needle = villageQuery.trim().toLowerCase();
    const filtered = needle
      ? villageRows.filter(
          (r) => r.name.toLowerCase().includes(needle) || String(r.hostname).toLowerCase().includes(needle)
        )
      : villageRows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      // Villages with no collector sample sort last either way, rather than
      // pretending a missing uptime is 0%.
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return (av - bv) * dir;
    });
  }, [villageRows, villageQuery, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  function openVillage(siteId) {
    setActiveSiteId(siteId);
    navigate("/vouchers");
  }

  /* ---- Charts fed by the voucher mirror (not the window) ---- */

  const pieData = scopedPackageStats
    .filter((p) => Number(p.total || 0) > 0)
    .map((p) => ({
      name: p.package_name || "Unknown",
      value: Number(p.total || 0),
    }));
  const pieTotal = pieData.reduce((a, p) => a + p.value, 0);

  // Expired takes amber rather than STATUS_COLORS.expired: that token is slate,
  // which is also the only sensible colour for Inactive, and two identical
  // slices in one donut is not a chart.
  const statusData = (() => {
    const m = metrics;
    const out = [];
    if (m.unusedVouchers > 0) out.push({ name: "Unused", value: m.unusedVouchers, color: STATUS_COLORS.unused });
    if (m.activeVouchers > 0) out.push({ name: "Active", value: m.activeVouchers, color: STATUS_COLORS.active });
    if (m.expired > 0) out.push({ name: "Expired", value: m.expired, color: CHART_COLORS.amber });
    if (m.inactive > 0) out.push({ name: "Inactive", value: m.inactive, color: CHART_COLORS.slate });
    return out;
  })();
  const statusTotal = statusData.reduce((a, d) => a + d.value, 0);

  const quotaBarData = scopedPackageStats.map((p) => ({
    name: p.package_name || "Unknown",
    shortName:
      (p.package_name || "Unknown").length > 12
        ? (p.package_name || "Unknown").substring(0, 12) + "…"
        : p.package_name || "Unknown",
    allocated: Math.round(Number(p.total_quota_mb || 0) / 1024),
    consumed: Math.round(Number(p.total_used_quota_mb || 0) / 1024),
  }));

  const syncTrendData = syncLogs
    .slice(-7)
    .reverse()
    .map((log) => ({
      date: new Date(log.sync_started_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      processed: log.total_processed || 0,
      new: log.total_new || 0,
      updated: log.total_updated || 0,
    }));

  const lastSync = syncLogs[0];
  const allTimeRevenue = revenue?.total ?? null;
  const allTimeCount = revenue?.totalCount ?? null;
  const monthsOnRecord = (revenue?.monthly || []).length;

  const headerActions = (
    <>
      <MonthPicker state={mb} compact />
      {/* Sync is an admin action (and hits Ruijie) — hidden for read-only viewers. */}
      {!isViewer && (
        <Button
          variant="secondary"
          size="sm"
          onClick={syncNow}
          loading={syncing}
          iconLeft={<RefreshCw size={14} />}
          title={
            lastSync
              ? `Last sync · ${new Date(lastSync.sync_started_at).toLocaleString()}. Pulls fresh voucher data from Ruijie Cloud (the only action here that calls Ruijie).`
              : "Pull fresh voucher data from Ruijie Cloud (the only action here that calls Ruijie)"
          }
        >
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      )}
    </>
  );

  if (loading) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Operations"
          title="Dashboard"
          subtitle="Loading analytics…"
          icon={<BarChart3 size={22} />}
          tone="red"
          actions={headerActions}
        />
        <SkeletonKpis count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
          <SkeletonCard height="h-[400px]" />
          <SkeletonCard height="h-[400px]" />
        </div>
        <SkeletonTable rows={6} cols={6} />
      </PageShell>
    );
  }

  const tabs = [
    { value: "sales", label: "Sales" },
    { value: "outcomes", label: "Outcomes" },
    { value: "plans", label: "Plans" },
    { value: "capacity", label: "Capacity" },
    // Sync history is admin-only — /vouchers/sync-logs 403s for viewers.
    ...(!isViewer ? [{ value: "sync", label: "Sync" }] : []),
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Dashboard"
        subtitle={`Revenue, voucher stock and network health across ${allVisible ? "every village" : `${inScopeGroupIds.length} village${inScopeGroupIds.length === 1 ? "" : "s"} in scope`}.`}
        icon={<BarChart3 size={22} />}
        tone="red"
        actions={headerActions}
      />

      {/* ----- Attention. One ~44px row of queue pills rather than a stack of
              full-width banners. An operator's three questions are "is anything
              wrong / how much / where do I go"; the pill answers all three and
              IS the link, so every queue stays exactly one click away. Nothing
              wrong renders nothing at all — a row of reassuring green strips
              would just be more to scroll past. ----- */}
      {(manualAssist?.unresolvedCount > 0 || netHealth.down > 0) && (
        <AttentionBar>
          {manualAssist?.unresolvedCount > 0 && (
            <AttentionPill
              tone="warning"
              icon={<LifeBuoy size={14} />}
              count={manualAssist.unresolvedCount}
              label={`manual assistance case${manualAssist.unresolvedCount === 1 ? "" : "s"}`}
              title="Customers who paid but weren't auto-connected — assign their reserved voucher."
              onClick={() => navigate("/manual-assistance")}
            />
          )}
          {netHealth.down > 0 && (
            <AttentionPill
              tone="danger"
              icon={<WifiOff size={14} />}
              count={netHealth.down}
              label={`village${netHealth.down === 1 ? "" : "s"} offline`}
              title="Last collector snapshot reported no internet at these sites."
              // /network is admin-only, so a viewer gets the count without a
              // click that would bounce them.
              onClick={isViewer ? null : () => navigate("/network")}
            />
          )}
        </AttentionBar>
      )}

      {/* ----- Four headline KPIs: is the estate healthy, and is it earning?
              Everything demoted from the old eight-tile rail now lives in the
              tab it belongs to (inventory → Capacity, avg sale → Sales). ----- */}
      <KpiGrid cols={5}>
        {/* Just "Revenue": at five across, "Revenue · September 2026" truncates
            to "REVENUE · SEPTEM…", and the window is already stated twice
            within a few hundred pixels — in the period picker directly above
            and on the revenue chart below. The sub carries it for the moving
            ranges ("all time", "this week"), where the label alone would be
            genuinely ambiguous. */}
        <StatCard
          label="Revenue"
          value={fmtMoney(mb.totals.revenue)}
          icon={<DollarSign size={18} />}
          color="accent"
          sub={`${fmtNum(mb.totals.transactions)} sale${mb.totals.transactions === 1 ? "" : "s"} · ${mb.label || "this month"}`}
          onClick={() => navigate("/portal-flows")}
        />
        <StatCard
          label="Vouchers sold"
          value={fmtNum(mb.totals.sold)}
          icon={<TrendingUp size={18} />}
          color="violet"
          sub={`${fmtNum(mb.totals.customers)} customers · ${mb.label || "month"}`}
          onClick={() => {
            // The window's real start date — `mb.month` is "all"/"week" for a
            // moving range, which would build a nonsense "all-01".
            if (mb.fromDate) navigate(`/portal-flows?startDate=${mb.fromDate}`);
          }}
        />
        <StatCard
          label="Live users"
          value={fmtNum(scopedMetrics.liveUsers)}
          icon={<Users size={18} />}
          color="blue"
          sub={`${fmtNum(scopedMetrics.activeVouchers)} active vouchers`}
        />
        <StatCard
          label="Network"
          value={netHealth.total ? `${netHealth.up}/${netHealth.total}` : "—"}
          icon={netHealth.down > 0 ? <WifiOff size={18} /> : <Wifi size={18} />}
          color={netHealth.down > 0 ? "rose" : netHealth.total ? "emerald" : "slate"}
          // The online count and the uptime % answer DIFFERENT questions and
          // used to be concatenated as if they were one. Online is Starlink —
          // is the village's internet up right now. Uptime is the Ruijie
          // gateway's local link, sampled every few minutes over 30 days.
          // "31/31 online · 71% uptime" is not defensible unless it says which
          // is which, so the label now does.
          sub={
            netHealth.total
              ? `villages online${netHealth.avgUptime != null ? ` · gateway uptime ${netHealth.avgUptime}% · 30d` : ""}`
              : "no collector data yet"
          }
          onClick={isViewer ? undefined : () => navigate("/network")}
        />
        {/* Starlink consumption against the plan. Never renders a zero before
            the usage collector has run — that is the absence of a measurement,
            not a measurement, and showing it as a figure sends someone looking
            for traffic that was never missing. */}
        {netHealth.total && !netHealth.usageCollected ? (
          <StatCard
            label="Starlink data"
            value="—"
            icon={<HardDrive size={18} />}
            color="slate"
            sub="usage collection is off"
          />
        ) : (
          <MeterCard
            label="Starlink data"
            used={netHealth.starlinkUsedGb ?? 0}
            total={netHealth.starlinkAllowanceGb ?? null}
            unit="GB"
            format={(n) => Math.round(Number(n || 0)).toLocaleString()}
            icon={<HardDrive size={18} />}
            color="violet"
            sub={`${fmtNum(netHealth.withTelemetry || 0)} linked ${netHealth.withTelemetry === 1 ? "kit" : "kits"}`}
            noTotalNote="no plan cap published"
            onClick={isViewer ? undefined : () => navigate("/overview")}
          />
        )}
      </KpiGrid>

      {/* ----- The one chart pair worth the space above the fold: what we earned
              over the window, and what plan mix earned it. ----- */}
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

      {/* ----- Villages. One sortable table instead of thirty-one cards: the
              single biggest reason this page used to feel endless. ----- */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <SearchInput
            value={villageQuery}
            onChange={(e) => setVillageQuery(e.target.value)}
            placeholder="Search villages…"
            width="w-72"
          />
          <span className="text-[12.5px] text-[var(--fg-muted)]">
            {visibleVillages.length} of {villageRows.length} village{villageRows.length === 1 ? "" : "s"}
            {allVisible ? "" : " in scope"}
          </span>
          <span className="ml-auto text-[12.5px] text-[var(--fg-muted)]">
            Revenue and sales are for {mb.label || "the selected window"}
          </span>
        </Toolbar>

        <Panel
          title="Villages"
          subtitle="Stock, live usage, earnings and link health, per village"
          icon={<MapPin size={15} />}
          tone="navy"
          padding={false}
        >
          {/* Scrolls in its own box rather than stretching the page: thirty-one
              rows at 57px plus a 35px header is ~1800px of Dashboard, which is
              the single biggest reason this page felt endless. 404px shows six
              full rows and clips the seventh — the half-row is the affordance
              that says "keep going", the same trick the tab strip uses. It is a
              MAX height, so filtering down to three villages shrinks the box
              instead of stranding them in an empty well. */}
          <DataTable maxHeight={404}>
            <thead>
              <tr>
                <SortTh label="Village" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortTh label="Vouchers" sortKey="vouchers" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Active" sortKey="active" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Live" sortKey="live" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Revenue" sortKey="revenue" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Sales" sortKey="sales" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Starlink data" sortKey="slUsed" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Uptime" sortKey="uptimePct" sort={sort} onSort={toggleSort} align="right" />
                <Th align="right">Open</Th>
              </tr>
            </thead>
            <tbody>
              {visibleVillages.length === 0 ? (
                <TableMessage colSpan={9}>
                  {villageRows.length === 0
                    ? "No villages in scope yet — add one in Settings, or widen the All Villages scope."
                    : `No village matches “${villageQuery}”.`}
                </TableMessage>
              ) : (
                visibleVillages.map((r) => (
                  <tr key={r.key}>
                    <Td>
                      <span className="flex items-center gap-2.5 min-w-0">
                        <StatusDot online={r.online} hasNet={r.hasNet} source={r.onlineSource} sl={r.sl} />
                        <RecordCell
                          title={r.name}
                          subtitle={r.hostname}
                          mono
                          onClick={r.siteId ? () => openVillage(r.siteId) : undefined}
                        />
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">{fmtNum(r.vouchers)}</Td>
                    <Td align="right" className="tabular-nums">{fmtNum(r.active)}</Td>
                    <Td align="right" strong className="tabular-nums">{fmtNum(r.live)}</Td>
                    <Td align="right" strong className="tabular-nums">{fmtMoney(r.revenue)}</Td>
                    <Td align="right" className="tabular-nums">{fmtNum(r.sales)}</Td>
                    <Td align="right">
                      <StarlinkDataCell sl={r.sl} />
                    </Td>
                    <Td align="right">
                      {r.hasNet ? (
                        <span
                          className="flex flex-col items-end"
                          title={`${r.uptimePct == null ? "No uptime data" : `${r.uptimePct}% over 30 days`}${r.apsTotal > 0 ? ` · ${r.apsOnline}/${r.apsTotal} APs online` : ""}`}
                        >
                          <span className="tabular-nums">
                            {r.uptimePct == null ? "—" : `${r.uptimePct}%`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--fg-muted)]">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.siteId ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openVillage(r.siteId)}
                          iconRight={<ChevronRight size={14} />}
                          title={`Open ${r.name} vouchers`}
                        >
                          Open
                        </Button>
                      ) : (
                        <span className="text-[var(--fg-subtle)] text-[12px]">—</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      {/* ----- Secondary analysis. All of it used to be stacked below the
              villages; grouped here it is reachable rather than scrolled past.
              Nothing was removed — only moved one click away. ----- */}
      <div className="flex flex-col gap-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} variant="underline" />

        {tab === "sales" && (
          <div className="flex flex-col gap-5">
            <SalesTotals state={mb} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <SalesByHourPanel state={mb} />
              <RevenueByVillagePanel state={mb} />
            </div>
            <VillageRevenuePanel state={mb} />
            {/* All-time totals come from /portal-config/revenue, which is not
                window- or scope-aware — labelled so it can't be read as either. */}
            {allTimeRevenue != null && (
              <Panel title="All-time revenue" subtitle="Every village · every month on record" icon={<DollarSign size={15} />} tone="red">
                <ChartStat
                  value={fmtMoney(allTimeRevenue)}
                  unit="since launch"
                  caption={`${fmtNum(allTimeCount)} paid transactions across ${fmtNum(monthsOnRecord)} month${monthsOnRecord === 1 ? "" : "s"}`}
                />
              </Panel>
            )}
          </div>
        )}

        {tab === "outcomes" && (
          <div className="flex flex-col gap-5">
            <RiskTotals state={mb} />
            <OutcomesPanel state={mb} />
            {!isViewer && (
              <Panel title="Manual assistance" subtitle="Paid customers who still need a voucher assigned" icon={<LifeBuoy size={15} />} tone="orange">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[24px] font-semibold tabular-nums text-[var(--fg-primary)] leading-none">
                      {fmtNum(manualAssist?.unresolvedCount || 0)}
                    </p>
                    <p className="text-[12.5px] text-[var(--fg-muted)] mt-1.5">open case{manualAssist?.unresolvedCount === 1 ? "" : "s"}</p>
                  </div>
                  <Button variant="secondary" size="sm" iconRight={<ArrowUpRight size={14} />} onClick={() => navigate("/manual-assistance")}>
                    Open queue
                  </Button>
                </div>
              </Panel>
            )}
          </div>
        )}

        {tab === "plans" && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Panel title="Package distribution" subtitle="Voucher pool by plan" icon={<Activity size={15} />} tone="indigo">
                {pieData.length === 0 ? (
                  <EmptyState icon={PackageOpen} title="No data available" />
                ) : (
                  <>
                    <div className="relative mx-auto" style={{ width: 196, height: 196 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} dataKey="value" nameKey="name" {...DONUT} isAnimationActive={false}>
                            {pieData.map((p, i) => (
                              <Cell
                                key={i}
                                fill={CHART_SERIES[i % CHART_SERIES.length]}
                                className="cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => handlePackageDrillDown(p.name)}
                              />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip hideLabel valueFormatter={(v) => `${fmtNum(v)} vouchers`} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <DonutCenter value={fmtNum(pieTotal)} label="Vouchers" />
                    </div>
                    {/* Every plan is listed: the old recharts legend showed
                        them all, and a truncated list loses a plan silently. */}
                    <LegendRows>
                      {pieData.map((p, i) => (
                        <LegendRow
                          key={p.name}
                          color={CHART_SERIES[i % CHART_SERIES.length]}
                          label={p.name}
                          value={fmtNum(p.value)}
                          amount={p.value}
                          total={pieTotal}
                        />
                      ))}
                    </LegendRows>
                  </>
                )}
              </Panel>

              <SoldByPlanPanel state={mb} />
            </div>

            {/* Per-plan utilisation. Click a plan to open the voucher list. */}
            <Panel title="Plan utilisation" subtitle="Share active, share of allocation consumed" icon={<Wifi size={15} />} tone="teal">
              {scopedPackageStats.length === 0 ? (
                <EmptyState icon={PackageOpen} title="No packages in this category" />
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {scopedPackageStats.map((pkg, i) => {
                    const total = Number(pkg.total || 0);
                    const active = Number(pkg.active || 0);
                    const pct = total ? Math.round((active / total) * 100) : 0;
                    const usedQ = Number(pkg.total_used_quota_mb || 0);
                    const totalQ = Number(pkg.total_quota_mb || 0);
                    const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;
                    const color = CHART_SERIES[i % CHART_SERIES.length];
                    return (
                      <button
                        key={pkg.package_name || i}
                        onClick={() => handlePackageDrillDown(pkg.package_name)}
                        className="group text-left p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2.5">
                          <span className="flex items-center gap-2 min-w-0 text-[13px] font-semibold text-[var(--fg-primary)] font-display">
                            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
                            <span className="truncate">{pkg.package_name || "Unknown"}</span>
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[13px] font-semibold tabular-nums text-[var(--fg-primary)]">{fmtNum(total)}</span>
                            <ArrowUpRight size={13} className="text-[var(--fg-subtle)] group-hover:text-[var(--brand)] transition-colors" />
                          </span>
                        </div>
                        <ProgressLine label="active" pct={pct} color={color} />
                        <ProgressLine label="data" pct={dataPct} color={usageColor(dataPct)} />
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel
              title="Plan breakdown"
              subtitle="Sold · Active · Expired · Left · Data used — grouped by plan across all in-scope villages"
              icon={<Ticket size={15} />}
              tone="indigo"
              padding={false}
            >
              <PlanBreakdown
                packages={scopedPackageStats}
                formatQuota={formatQuota}
                onSelect={handlePackageDrillDown}
              />
            </Panel>
          </div>
        )}

        {tab === "capacity" && (
          <div className="flex flex-col gap-5">
            {/* The inventory half of the old eight-tile rail, intact. */}
            <KpiGrid cols={4}>
              <StatCard
                label="Total vouchers"
                value={fmtNum(scopedMetrics.totalVouchers)}
                icon={<Database size={18} />}
                color="indigo"
                sub={`${fmtNum(scopedMetrics.unused)} left · ${allVisible ? "all villages" : `${scopedPerSite.length} of ${sites.length}`}`}
                onClick={() => navigate("/vouchers")}
              />
              <StatCard
                label="Vouchers sold"
                value={fmtNum(scopedMetrics.sold)}
                icon={<Ticket size={18} />}
                color="violet"
                sub={
                  scopedMetrics.totalVouchers
                    ? `${Math.round((scopedMetrics.sold / scopedMetrics.totalVouchers) * 100)}% of pool`
                    : "—"
                }
                onClick={() => navigate("/vouchers?status=sold")}
              />
              <StatCard
                label="Data consumed"
                value={formatQuota(scopedMetrics.totalDataUsage)}
                icon={<HardDrive size={18} />}
                color="teal"
                sub={`of ${formatQuota(scopedMetrics.totalQuota)} allocated`}
                onClick={() => navigate("/vouchers?status=sold")}
              />
              <StatCard
                label="Active vouchers"
                value={fmtNum(scopedMetrics.activeVouchers)}
                icon={<Zap size={18} />}
                color="emerald"
                sub={`${scopedMetrics.activeRate}% active rate`}
                onClick={() => navigate("/vouchers?status=2")}
              />
            </KpiGrid>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5">
              <Panel title="Status breakdown" subtitle="The whole voucher pool" icon={<CheckCircle size={15} />} tone="blue">
                {statusData.length === 0 ? (
                  <EmptyState icon={PackageOpen} title="No data available" />
                ) : (
                  <>
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

              <Panel title="Quota by package" subtitle="Allocated · Consumed (GB) per plan" icon={<TrendingUp size={15} />} tone="teal">
                {quotaBarData.length === 0 ? (
                  <EmptyState icon={PackageOpen} title="No data available" />
                ) : (
                  <>
                    <ChartStat
                      value={formatQuota(metrics.totalDataUsage)}
                      unit="consumed"
                      caption={`of ${formatQuota(metrics.totalQuota)} allocated across ${fmtNum(quotaBarData.length)} plan${quotaBarData.length === 1 ? "" : "s"}`}
                    />
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={quotaBarData} barGap={4} barCategoryGap={BAR_CATEGORY_GAP} margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
                        <CartesianGrid {...gridProps(ct)} />
                        <XAxis
                          dataKey="shortName"
                          {...axisX(ct, { interval: 0, angle: -25, textAnchor: "end", height: 66, minTickGap: 0 })}
                        />
                        <YAxis {...axisY(ct, { width: 48 })} tickFormatter={(v) => `${v} GB`} />
                        <Tooltip
                          content={<ChartTooltip valueFormatter={(v) => `${fmtNum(v)} GB`} labelFormatter={(l) => quotaBarData.find((q) => q.shortName === l)?.name || l} />}
                          cursor={{ fill: ct.cursor }}
                        />
                        <Bar dataKey="allocated" name="Allocated" fill={CHART_COLORS.slate} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                        {/* Consumed is the figure that matters, so it gets the brand. */}
                        <Bar dataKey="consumed" name="Consumed" fill={CHART_COLORS.brand} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                    <LegendRows>
                      <LegendRow color={CHART_COLORS.slate} label="Allocated" value={formatQuota(metrics.totalQuota)} />
                      <LegendRow color={CHART_COLORS.brand} label="Consumed" value={formatQuota(metrics.totalDataUsage)} />
                    </LegendRows>
                  </>
                )}
              </Panel>
            </div>
          </div>
        )}

        {tab === "sync" && !isViewer && (
          <Panel
            title="Sync activity"
            subtitle="Last 7 syncs from Ruijie Cloud"
            icon={<Clock size={15} />}
            tone="teal"
            actions={
              <Button variant="secondary" size="sm" onClick={syncNow} loading={syncing} iconLeft={<RefreshCw size={14} />}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            }
          >
            {syncTrendData.length === 0 ? (
              <EmptyState icon={Clock} title="No sync history yet" description="Run a sync to pull fresh voucher data." />
            ) : (
              <>
                {/* `updated` is collected per sync but never plotted, so it is
                    stated here rather than dropped. */}
                <ChartStat
                  value={fmtNum(lastSync?.total_processed || 0)}
                  unit="processed"
                  caption={`${fmtNum(syncTrendData.reduce((a, s) => a + s.updated, 0))} vouchers updated over these syncs${
                    lastSync ? ` · last sync ${new Date(lastSync.sync_started_at).toLocaleString()}` : ""
                  }`}
                />
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={syncTrendData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <ChartGradient id="syncProcessed" color={CHART_COLORS.blue} />
                      <ChartGradient id="syncNew" color={CHART_COLORS.green} />
                    </defs>
                    <CartesianGrid {...gridProps(ct)} />
                    <XAxis dataKey="date" {...axisX(ct)} />
                    <YAxis {...axisY(ct, { width: 36 })} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip valueFormatter={fmtNum} />} cursor={{ stroke: ct.axisLine }} />
                    <Area type="monotone" dataKey="processed" name="Processed" stroke={CHART_COLORS.blue} strokeWidth={2} fill="url(#syncProcessed)" isAnimationActive={false} />
                    <Area type="monotone" dataKey="new" name="New" stroke={CHART_COLORS.green} strokeWidth={2} fill="url(#syncNew)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <LegendRows>
                  <LegendRow color={CHART_COLORS.blue} label="Processed" value={fmtNum(syncTrendData.reduce((a, s) => a + s.processed, 0))} />
                  <LegendRow color={CHART_COLORS.green} label="New" value={fmtNum(syncTrendData.reduce((a, s) => a + s.new, 0))} />
                </LegendRows>
              </>
            )}
          </Panel>
        )}
      </div>

      {/* ----- Drill-down modal ----- */}
      {selectedPackage && drillDownData && (
        <Modal
          open
          onClose={() => {
            setSelectedPackage(null);
            setDrillDownData(null);
          }}
          width="2xl"
        >
          <Modal.Header
            eyebrow="Package detail"
            title={selectedPackage}
            subtitle={`${drillDownData.total || 0} vouchers in this package`}
            icon={Ticket}
            onClose={() => {
              setSelectedPackage(null);
              setDrillDownData(null);
            }}
          />

          <Modal.Body>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Total", value: fmtNum(drillDownData.total) },
                {
                  label: "Active now",
                  value: fmtNum(
                    drillDownData.vouchers?.filter((v) => Number(v.current_clients) > 0).length || 0
                  ),
                },
                {
                  label: "Usage rate",
                  value: drillDownData.total
                    ? `${Math.round(
                        (drillDownData.vouchers?.filter((v) => Number(v.used_time) > 0).length /
                          drillDownData.total) *
                          100
                      )}%`
                    : "0%",
                },
                {
                  label: "Data used",
                  value: formatQuota(
                    drillDownData.vouchers?.reduce((s, v) => s + Number(v.used_quota || 0), 0) || 0
                  ),
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                >
                  <p className="text-label truncate">{s.label}</p>
                  <p className="mt-1.5 text-[20px] leading-none font-semibold tabular-nums text-[var(--fg-primary)]">
                    {s.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-[var(--border-default)] overflow-hidden">
              <DataTable>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Status</Th>
                    <Th align="right">Clients</Th>
                    <Th align="right">Time</Th>
                    <Th align="right">Data</Th>
                  </tr>
                </thead>
                <tbody>
                  {(drillDownData.vouchers || []).slice(0, 15).map((v) => (
                    <tr key={v.uuid}>
                      <Td>
                        <span className="font-mono text-[12.5px] font-semibold px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
                          {v.voucher_code}
                        </span>
                      </Td>
                      <Td>
                        <VoucherStatusPill status={v.status} />
                      </Td>
                      <Td align="right" mono>{v.current_clients}/{v.max_clients}</Td>
                      <Td align="right" mono>{formatDuration(v.used_time)} / {formatDuration(v.time_period)}</Td>
                      <Td align="right" mono>{formatQuota(v.used_quota)} / {formatQuota(v.quota)}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </PageShell>
  );
}

/* ------------ Sub-components --------------------------------------------- */

/**
 * The attention row. Its surface stays neutral so that two different severities
 * can sit side by side without the page turning into a wall of red — the tone
 * lives on each pill, not on the bar.
 *
 * Only ever rendered when there is something to act on, so its presence alone
 * means "read me". One row scales: a third queue is one more pill, not a third
 * full-width banner.
 */
function AttentionBar({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2.5">
      <span className="flex items-center gap-2 pr-1 text-[13px] font-semibold font-display text-[var(--fg-primary)]">
        <AlertTriangle size={15} className="text-[var(--warning-fg)]" />
        Needs attention
      </span>
      {children}
    </div>
  );
}

/**
 * One queue. The count is the point, so it leads; the explanation that used to
 * occupy a second line now lives in the tooltip, because an operator needs it
 * once rather than on every page load.
 *
 * Renders as a plain span when there is nowhere to send this viewer, so the
 * figure still informs without offering a click that would bounce.
 */
function AttentionPill({ tone, icon, count, label, title, onClick }) {
  const tones = {
    warning: "bg-[var(--warning-soft)] border-[var(--warning-border)] text-[var(--warning-fg)]",
    danger: "bg-[var(--danger-soft)] border-[var(--danger-border)] text-[var(--danger-fg)]",
  };
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick || undefined}
      title={title}
      className={
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
        tones[tone] +
        (onClick ? " hover:brightness-[0.97] cursor-pointer" : "")
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="font-semibold tabular-nums">{fmtNum(count)}</span>
      <span className="opacity-90">{label}</span>
      {onClick && <ArrowUpRight size={13} className="shrink-0 opacity-70" />}
    </Tag>
  );
}

/** A sortable column head. Th itself stays presentational. */
function SortTh({ label, sortKey, sort, onSort, align = "left" }) {
  const active = sort.key === sortKey;
  return (
    <Th align={align}>
      <button
        onClick={() => onSort(sortKey)}
        className={
          "inline-flex items-center gap-1 uppercase tracking-[0.06em] transition-colors " +
          (active ? "text-[var(--fg-primary)]" : "hover:text-[var(--fg-secondary)]")
        }
      >
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronDown size={12} className="opacity-25" />
        )}
      </button>
    </Th>
  );
}

/** Village link health. Absent from the collector reads as unknown, not down. */
/**
 * Starlink's own account of what the dish carried this cycle.
 *
 * This replaced a Ruijie voucher-quota figure that was wrong in two ways: its
 * numerator read 0 on any village whose gateway does not report per-voucher
 * used-flow, and its denominator was the summed allowance of every voucher ever
 * printed — so the meter went DOWN when an operator generated more stock. The
 * dish meters the actual backhaul and does not care how the gateway is set up.
 *
 * An allowance is only a number when Starlink publishes one. Where it does not,
 * this states the usage alone rather than dividing by nothing or printing
 * "0 GB", which would read as "this village has no data" — the opposite of
 * what an absent cap means.
 */
function StarlinkDataCell({ sl }) {
  if (!sl || !sl.configured) {
    return <span className="text-[var(--fg-subtle)]" title="No Starlink kit linked to this village">—</span>;
  }
  if (sl.usedGb == null) {
    return <span className="text-[var(--fg-subtle)]" title="Starlink has not reported usage for this cycle yet">—</span>;
  }
  const cap = sl.allowanceGb;
  const pct = cap ? Math.round((sl.usedGb / cap) * 100) : null;
  const over = cap != null && sl.usedGb > cap;
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span className="tabular-nums whitespace-nowrap">
        {fmtGb(sl.usedGb)}
        {cap ? <span className="text-[var(--fg-subtle)]"> / {fmtGb(cap)}</span> : null} GB
      </span>
      {pct == null ? (
        // No published cap: there is nothing to fill a meter against, and a
        // full-width or empty bar would both be a claim we cannot make.
        <span
          className="hidden lg:block w-12 text-[10.5px] text-[var(--fg-subtle)] shrink-0 text-left"
          title="Starlink publishes no plan cap for this cycle"
        >
          no cap
        </span>
      ) : (
        <span
          className="hidden lg:block w-12 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden shrink-0"
          title={
            over
              ? `${pct}% — ${fmtGb(sl.usedGb - cap)} GB past the ${fmtGb(cap)} GB allowance`
              : `${pct}% of the ${fmtGb(cap)} GB allowance used`
          }
        >
          {/* Clamped: usage can legitimately exceed the allowance, and an
              unclamped bar would render past its own track. */}
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.min(pct, 100)}%`, background: usageColor(pct) }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Tri-state, because the underlying question is now genuinely three-valued.
 * Telemetry arriving means up; silence for half an hour means down; the band
 * between is "we have not heard recently", which is not the same claim as "it
 * is down" and must not be painted red.
 *
 * The tooltip names its source. A green dot vouched for by the Ruijie gateway
 * because no Starlink kit is linked is a weaker statement than one vouched for
 * by the dish, and an operator deserves to be able to tell them apart.
 */
function StatusDot({ online, hasNet, source, sl }) {
  const label = !hasNet
    ? "No collector data"
    : online === true
      ? "Online"
      : online === false
        ? "Offline"
        : "Unknown — no recent telemetry";
  const bg =
    online === true
      ? "var(--success-fg)"
      : online === false
        ? "var(--danger-fg)"
        : online === null && source === "telemetry"
          ? "var(--warning-fg)" // amber: heard from, but not lately
          : "var(--fg-subtle)";

  const detail = [
    label,
    source === "telemetry" ? "via Starlink telemetry" : source === "ruijie" ? "via the Ruijie gateway (no Starlink kit linked)" : null,
    sl?.ageSeconds != null ? `last seen ${fmtAge(sl.ageSeconds)} ago` : null,
    sl?.latencyMs != null ? `${Math.round(sl.latencyMs)} ms` : null,
    sl?.dropRate != null ? `${(sl.dropRate * 100).toFixed(1)}% drop` : null,
    sl?.obstructionPct != null ? `${sl.obstructionPct.toFixed(1)}% obstructed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="shrink-0 inline-flex items-center" title={detail}>
      <span className="h-2 w-2 rounded-full" style={{ background: bg }} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ProgressLine({ label, pct, color }) {
  return (
    <div className="flex items-center gap-2.5 mt-1.5">
      <span className="flex-1 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </span>
      <span className="text-[11.5px] text-[var(--fg-muted)] w-[68px] text-right tabular-nums">
        {pct}% {label}
      </span>
    </div>
  );
}

function VoucherStatusPill({ status }) {
  const map = {
    "1": { label: "Unused", tone: "info" },
    "2": { label: "Active", tone: "success" },
    "3": { label: "Expired", tone: "danger" },
    "0": { label: "Inactive", tone: "neutral" },
  };
  const c = map[String(status)] || map["0"];
  return <StatusPill tone={c.tone}>{c.label}</StatusPill>;
}
