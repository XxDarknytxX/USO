// src/pages/Dashboard.jsx
// Operations dashboard — metrics, charts, package drilldowns.
// Rebuilt on the design system: tokenized surfaces, Vodafone red as the only
// chromatic punctuation, dark-mode-aware tooltips and charts.

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Tooltip,
  Legend,
} from "recharts";
import {
  Users,
  DollarSign,
  Activity,
  TrendingUp,
  Database,
  BarChart3,
  Clock,
  CheckCircle,
  Wifi,
  RefreshCw,
  Zap,
  HardDrive,
  ArrowUpRight,
  Ticket,
  MapPin,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import PlanBreakdown from "../components/PlanBreakdown";
import { scopePackages } from "../utils/scopePackages";
import { api, voucherApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { Modal, Badge, EmptyState } from "../components/ui";

// Categorize package by time_period (minutes)
function classifyPackage(timePeriodMinutes) {
  const mins = Number(timePeriodMinutes || 0);
  if (mins <= 1440) return "daily";
  if (mins <= 10080) return "weekly";
  return "monthly";
}

// Palette: brand red + neutrals. Charts pull from these via getCSSVar.
function getVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

// Stable hashed palette derived from brand tokens. Six rotating accents.
const PALETTE_VARS = [
  "--color-brand-600",
  "--color-brand-400",
  "--color-brand-800",
  "--color-ink-500",
  "--color-ink-700",
  "--color-ink-400",
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { sites, setActiveSiteId, isSiteVisible, allVisible } = useSite();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [voucherStats, setVoucherStats] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [drillDownData, setDrillDownData] = useState(null);

  useEffect(() => {
    autoSyncAndLoad();
  }, []);

  async function autoSyncAndLoad() {
    setSyncing(true);
    try {
      await voucherApi.sync();
    } catch (err) {
      toast.error("Auto-sync failed — showing cached data");
    } finally {
      setSyncing(false);
    }
    await loadDashboardData();
  }

  async function loadDashboardData() {
    try {
      const [statsData, logsData, revenueData] = await Promise.all([
        api("/vouchers/stats", { auth: true }),
        api("/vouchers/sync-logs", { auth: true }),
        api("/portal-config/revenue", { auth: true }).catch(() => null),
      ]);
      setVoucherStats(statsData);
      setSyncLogs(logsData.logs || []);
      setRevenue(revenueData);
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

  function formatQuota(mb) {
    const val = Number(mb || 0);
    if (val < 1024) return `${val} MB`;
    return `${(val / 1024).toFixed(1)} GB`;
  }

  // Ruijie groupIds of the villages currently in the "All Villages" scope.
  const inScopeGroupIds = useMemo(
    () =>
      sites
        .filter((s) => (allVisible ? true : isSiteVisible(s.id)))
        .map((s) => s.ruijieGroupId)
        .filter(Boolean),
    [sites, allVisible, isSiteVisible]
  );

  // Per-plan stats collapsed to only the in-scope villages (falls back to the
  // server's all-villages packageStats if the per-site rollup isn't present).
  const scopedPackageStats = useMemo(
    () =>
      scopePackages(voucherStats?.packageSiteStats, inScopeGroupIds, allVisible) ??
      voucherStats?.packageStats ??
      [],
    [voucherStats, inScopeGroupIds, allVisible]
  );

  const filteredPackageStats = useMemo(() => {
    const base = scopedPackageStats;
    if (!base.length) return [];
    if (activeView === "overview") return base;
    return base.filter(
      (pkg) => classifyPackage(Number(pkg.avg_duration_minutes || 0)) === activeView
    );
  }, [scopedPackageStats, activeView]);

  const metrics = useMemo(() => {
    const f = filteredPackageStats;
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
  }, [filteredPackageStats]);

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

  // ---- Revenue (scoped to the in-scope villages) ----
  const revByGroup = useMemo(() => {
    const map = {};
    for (const r of revenue?.perSite || []) map[String(r.groupId)] = r;
    return map;
  }, [revenue]);

  const scopedRevenue = useMemo(() => {
    if (!revenue) return { total: 0, month: 0, count: 0, monthCount: 0 };
    if (allVisible)
      return {
        total: revenue.total || 0,
        month: revenue.month || 0,
        count: revenue.totalCount || 0,
        monthCount: revenue.monthCount || 0,
      };
    let total = 0, month = 0, count = 0, monthCount = 0;
    for (const site of sites) {
      if (!isSiteVisible(site.id)) continue;
      const r = revByGroup[String(site.ruijieGroupId)];
      if (r) { total += r.revenue; month += r.month; count += r.count; monthCount += r.monthCount; }
    }
    return { total, month, count, monthCount };
  }, [revenue, allVisible, sites, isSiteVisible, revByGroup]);

  const fmtMoney = (n) =>
    "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const revenueTrend = useMemo(
    () =>
      (revenue?.monthly || []).map((m) => ({
        label: m.label,
        revenue: Number(m.revenue || 0),
        count: Number(m.count || 0),
      })),
    [revenue]
  );

  const pieData = filteredPackageStats
    .filter((p) => Number(p.total || 0) > 0)
    .map((p) => ({
      name: p.package_name || "Unknown",
      value: Number(p.total || 0),
    }));

  const statusData = (() => {
    const m = metrics;
    const out = [];
    if (m.unusedVouchers > 0)
      out.push({
        name: "Unused",
        value: m.unusedVouchers,
        color: getVar("--info-fg", "#1d4ed8"),
      });
    if (m.activeVouchers > 0)
      out.push({
        name: "Active",
        value: m.activeVouchers,
        color: getVar("--success-fg", "#15803d"),
      });
    if (m.expired > 0)
      out.push({
        name: "Expired",
        value: m.expired,
        color: getVar("--brand", "#e60000"),
      });
    if (m.inactive > 0)
      out.push({
        name: "Inactive",
        value: m.inactive,
        color: getVar("--text-tertiary", "#6d747f"),
      });
    return out;
  })();

  const quotaBarData = filteredPackageStats.map((p) => ({
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

  if (loading) {
    return (
      <div className="page-shell">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
          <div
            className="w-9 h-9 rounded-full border-[3px] animate-spin"
            style={{
              borderColor: "var(--surface-pressed)",
              borderTopColor: "var(--brand)",
            }}
          />
          <p className="text-[13px] font-medium">
            {syncing ? "Syncing with Ruijie Cloud…" : "Loading analytics…"}
          </p>
        </div>
      </div>
    );
  }

  const lastSync = syncLogs[0];

  return (
    <div className="page-shell">
      {/* ----- Header ----- */}
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <BarChart3 size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Operations</span>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">
              Voucher inventory, sync health, and consumption across all plans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {syncing && (
            <Badge tone="brand" icon={<RefreshCw size={11} className="animate-spin" />}>
              Syncing
            </Badge>
          )}
          {lastSync && (
            <span className="text-[12px] text-[var(--text-tertiary)]">
              Last sync · {new Date(lastSync.sync_started_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* ----- View tabs ----- */}
        <div
          className={
            "inline-flex items-center rounded-md p-0.5 " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)]"
          }
        >
          {[
            { key: "overview", label: "All" },
            { key: "daily", label: "Daily" },
            { key: "weekly", label: "Weekly" },
            { key: "monthly", label: "Monthly" },
          ].map(({ key, label }) => {
            const active = activeView === key;
            return (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={
                  "h-7 px-3 text-[12px] font-medium rounded transition-colors " +
                  (active
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ----- Revenue + headline (scope-aware) ----- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Revenue (total)"
            value={fmtMoney(scopedRevenue.total)}
            icon={<DollarSign size={14} />}
            sub={`${scopedRevenue.count.toLocaleString()} sale${scopedRevenue.count === 1 ? "" : "s"}`}
          />
          <MetricCard
            label="Sold this month"
            value={fmtMoney(scopedRevenue.month)}
            icon={<TrendingUp size={14} />}
            sub={`${scopedRevenue.monthCount.toLocaleString()} this month`}
          />
          <MetricCard
            label="Live users"
            value={scopedMetrics.liveUsers.toLocaleString()}
            icon={<Users size={14} />}
            sub="Currently connected"
          />
          <MetricCard
            label="Active rate"
            value={`${scopedMetrics.activeRate}%`}
            icon={<Zap size={14} />}
            sub={`${scopedMetrics.activeVouchers.toLocaleString()} active`}
          />
        </div>

        {/* ----- Voucher inventory (in-scope villages) ----- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Total vouchers"
            value={scopedMetrics.totalVouchers.toLocaleString()}
            icon={<Database size={14} />}
            sub={`${scopedMetrics.unused.toLocaleString()} left · ${allVisible ? "all villages" : `${scopedPerSite.length} of ${sites.length}`}`}
          />
          <MetricCard
            label="Vouchers sold"
            value={scopedMetrics.sold.toLocaleString()}
            icon={<Ticket size={14} />}
            sub={
              scopedMetrics.totalVouchers
                ? `${Math.round((scopedMetrics.sold / scopedMetrics.totalVouchers) * 100)}% of pool`
                : "—"
            }
          />
          <MetricCard
            label="Data consumed"
            value={formatQuota(scopedMetrics.totalDataUsage)}
            icon={<HardDrive size={14} />}
            sub={`of ${formatQuota(scopedMetrics.totalQuota)} allocated`}
          />
          <MetricCard
            label="Active vouchers"
            value={scopedMetrics.activeVouchers.toLocaleString()}
            icon={<Zap size={14} />}
            sub={`${scopedMetrics.activeRate}% active rate`}
          />
        </div>

        {/* ----- Sites overview (villages in the All Villages scope) ----- */}
        {(() => {
          const perSite = Array.isArray(voucherStats?.perSite) ? voucherStats.perSite : [];
          const scoped = perSite.filter((s) => {
            const site = sites.find((x) => String(x.ruijieGroupId) === String(s.group_id));
            return site ? isSiteVisible(site.id) : allVisible;
          });
          if (scoped.length === 0) return null;
          return (
            <div>
              <h2 className="text-[10.5px] font-medium text-[var(--text-quaternary)] mb-3">
                Sites · {scoped.length}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {scoped.map((s) => {
                  const site = sites.find((x) => String(x.ruijieGroupId) === String(s.group_id));
                  return (
                    <SiteCard
                      key={s.group_id || "unknown"}
                      name={site?.name || (s.group_id ? `Group ${s.group_id}` : "Unassigned")}
                      hostname={site?.hostname}
                      stats={s}
                      revenue={revByGroup[String(s.group_id)]}
                      fmtMoney={fmtMoney}
                      onOpen={
                        site
                          ? () => {
                              setActiveSiteId(site.id);
                              navigate("/vouchers");
                            }
                          : null
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ----- Revenue trend ----- */}
        {revenueTrend.some((m) => m.revenue > 0) && (
          <ChartCard
            title="Revenue trend"
            subtitle="Last 6 months · all villages"
            icon={<DollarSign size={14} />}
          >
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenueTrend}
                  margin={{ top: 5, right: 5, bottom: 5, left: -4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--text-quaternary)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v) =>
                      "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
                    }
                  />
                  <Tooltip content={<RevenueTooltip />} cursor={{ fill: "var(--surface-hover)" }} />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill={getVar("--brand", "#e60000")}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={52}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* ----- Charts Row 1 ----- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Package distribution" icon={<Activity size={14} />}>
            {pieData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      innerRadius={48}
                      outerRadius={84}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={0}
                    >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={getVar(PALETTE_VARS[i % PALETTE_VARS.length], "#e60000")}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => handlePackageDrillDown(pieData[i].name)}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={7}
                      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                      formatter={(val) => (
                        <span
                          className="ml-1"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {val}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard title="Status breakdown" icon={<CheckCircle size={14} />}>
            {statusData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex-1 min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={44}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        strokeWidth={0}
                      >
                        {statusData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="shrink-0 mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
                  {statusData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: d.color }}
                        />
                        {d.name}
                      </span>
                      <span className="text-[12px] font-mono font-semibold text-[var(--text-primary)]">
                        {d.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>

        </div>

        {/* ----- Quota by package (full width, all plan labels readable) ----- */}
        <ChartCard
          title="Quota by package"
          subtitle="Allocated · Consumed (GB) per plan"
          icon={<TrendingUp size={14} />}
        >
          {quotaBarData.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={quotaBarData}
                  barGap={4}
                  barCategoryGap="26%"
                  margin={{ top: 8, right: 12, bottom: 24, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10.5, fill: "var(--text-quaternary)" }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={72}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v) => `${v} GB`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-hover)" }} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={7}
                    wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                    formatter={(val) => (
                      <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>
                        {val}
                      </span>
                    )}
                  />
                  <Bar
                    dataKey="allocated"
                    name="Allocated"
                    fill={getVar("--color-ink-400", "#9aa1ab")}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={46}
                  />
                  <Bar
                    dataKey="consumed"
                    name="Consumed"
                    fill={getVar("--brand", "#e60000")}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={46}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {/* ----- Charts Row 2 ----- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Sync activity"
            subtitle="Last 7 syncs"
            icon={<Clock size={14} />}
          >
            {syncTrendData.length === 0 ? (
              <EmptyChart message="No sync history yet" />
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={syncTrendData}
                    margin={{ top: 5, right: 5, bottom: 5, left: -10 }}
                  >
                    <defs>
                      <linearGradient id="syncProcessed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={getVar("--brand", "#e60000")} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={getVar("--brand", "#e60000")} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="syncNew" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={getVar("--success-fg", "#15803d")} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={getVar("--success-fg", "#15803d")} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "var(--text-quaternary)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      iconSize={7}
                      wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                      formatter={(val) => (
                        <span
                          className="ml-1"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {val}
                        </span>
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="processed"
                      name="Processed"
                      stroke={getVar("--brand", "#e60000")}
                      strokeWidth={2}
                      fill="url(#syncProcessed)"
                      dot={{ r: 2.5, fill: getVar("--brand", "#e60000"), strokeWidth: 0 }}
                      activeDot={{ r: 4, stroke: "var(--surface-raised)", strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="new"
                      name="New"
                      stroke={getVar("--success-fg", "#15803d")}
                      strokeWidth={2}
                      fill="url(#syncNew)"
                      dot={{ r: 2.5, fill: getVar("--success-fg", "#15803d"), strokeWidth: 0 }}
                      activeDot={{ r: 4, stroke: "var(--surface-raised)", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard title="Quick overview" icon={<Wifi size={14} />}>
            <div className="space-y-2 overflow-y-auto max-h-[280px] pr-1">
              {filteredPackageStats.map((pkg, i) => {
                const total = Number(pkg.total || 0);
                const active = Number(pkg.active || 0);
                const pct = total ? Math.round((active / total) * 100) : 0;
                const usedQ = Number(pkg.total_used_quota_mb || 0);
                const totalQ = Number(pkg.total_quota_mb || 0);
                const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;
                const color = getVar(PALETTE_VARS[i % PALETTE_VARS.length], "#e60000");

                return (
                  <div
                    key={i}
                    onClick={() => handlePackageDrillDown(pkg.package_name)}
                    className={
                      "group p-3 rounded-md cursor-pointer border transition-colors " +
                      "bg-[var(--surface-sunken)] border-[var(--border-subtle)] " +
                      "hover:bg-[var(--surface-hover)] hover:border-[var(--border-default)]"
                    }
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: color }}
                        />
                        {pkg.package_name || "Unknown"}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] font-mono font-semibold text-[var(--text-primary)]">
                          {total.toLocaleString()}
                        </span>
                        <ArrowUpRight
                          size={12}
                          className="text-[var(--text-quaternary)] group-hover:text-[var(--brand)] transition-colors"
                        />
                      </div>
                    </div>
                    <ProgressLine
                      label="active"
                      pct={pct}
                      color={color}
                    />
                    <ProgressLine
                      label="data"
                      pct={dataPct}
                      color="var(--brand)"
                    />
                  </div>
                );
              })}
              {filteredPackageStats.length === 0 && (
                <EmptyChart message="No packages in this category" />
              )}
            </div>
          </ChartCard>
        </div>

        {/* ----- Plan breakdown (by plan name, merged across all in-scope villages) ----- */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[12px] font-medium text-[var(--text-tertiary)]">
              Plan breakdown
            </h2>
            <span className="text-[11px] text-[var(--text-quaternary)]">
              Sold · Active · Expired · Left · Data used — grouped by plan across all villages
            </span>
          </div>
          <PlanBreakdown
            packages={filteredPackageStats}
            formatQuota={formatQuota}
            onSelect={handlePackageDrillDown}
          />
        </div>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Total", value: drillDownData.total },
                {
                  label: "Active now",
                  value:
                    drillDownData.vouchers?.filter(
                      (v) => Number(v.current_clients) > 0
                    ).length || 0,
                },
                {
                  label: "Usage rate",
                  value: drillDownData.total
                    ? `${Math.round(
                        (drillDownData.vouchers?.filter(
                          (v) => Number(v.used_time) > 0
                        ).length /
                          drillDownData.total) *
                          100
                      )}%`
                    : "0%",
                },
                {
                  label: "Data used",
                  value: formatQuota(
                    drillDownData.vouchers?.reduce(
                      (s, v) => s + Number(v.used_quota || 0),
                      0
                    ) || 0
                  ),
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className={
                    "p-3 rounded-lg bg-[var(--surface-sunken)] " +
                    "border border-[var(--border-subtle)]"
                  }
                >
                  <p className="text-[12px] font-medium text-[var(--text-tertiary)] mb-1">
                    {s.label}
                  </p>
                  <p className="text-[18px] font-semibold text-[var(--text-primary)]">
                    {s.value}
                  </p>
                </div>
              ))}
            </div>

            <div
              className={
                "rounded-md border border-[var(--border-default)] overflow-hidden"
              }
            >
              <table className="w-full text-[13px]">
                <thead>
                  <tr
                    className={
                      "bg-[var(--surface-sunken)] text-left " +
                      "text-[12px] font-medium text-[var(--text-tertiary)]"
                    }
                  >
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Clients</th>
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-4 py-2.5 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {(drillDownData.vouchers || []).slice(0, 15).map((v) => (
                    <tr
                      key={v.uuid}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[12.5px] font-medium px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
                          {v.voucher_code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadgeMini status={v.status} />
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] font-mono text-[var(--text-secondary)]">
                        {v.current_clients}/{v.max_clients}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] font-mono text-[var(--text-secondary)]">
                        {formatDuration(v.used_time)} / {formatDuration(v.time_period)}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] font-mono text-[var(--text-secondary)]">
                        {formatQuota(v.used_quota)} / {formatQuota(v.quota)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
}

/* ------------ Sub-components --------------------------------------------- */

function SiteCard({ name, hostname, stats, revenue, fmtMoney, onOpen }) {
  const total = Number(stats.total || 0);
  const active = Number(stats.active || 0);
  const live = Number(stats.currently_in_use || 0);
  const usedQ = Number(stats.total_used_quota_mb || 0);
  const totalQ = Number(stats.total_quota_mb || 0);
  const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;
  const money = fmtMoney || ((n) => "$" + Number(n || 0).toFixed(2));
  const rev = Number(revenue?.revenue || 0);
  const revMonth = Number(revenue?.month || 0);
  const revCount = Number(revenue?.count || 0);
  return (
    <button
      onClick={onOpen || undefined}
      disabled={!onOpen}
      className={
        "text-left w-full p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)] shadow-[var(--elev-1)] " +
        (onOpen
          ? "hover:border-[var(--brand)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          : "cursor-default")
      }
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-7 w-7 rounded-md inline-flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] shrink-0">
            <MapPin size={14} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{name}</span>
            {hostname && (
              <span className="text-[10.5px] font-mono text-[var(--text-quaternary)] truncate">{hostname}</span>
            )}
          </div>
        </div>
        {onOpen && <ArrowUpRight size={14} className="text-[var(--text-quaternary)] shrink-0" />}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniStat label="Vouchers" value={total} />
        <MiniStat label="Active" value={active} />
        <MiniStat label="Live" value={live} accent />
      </div>
      <div className="flex items-center justify-between mb-3 px-2.5 py-2 rounded-md bg-[var(--brand-soft)]">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--brand-fg-on-soft)] opacity-80">
            Revenue
          </span>
          <span className="text-[15px] font-semibold text-[var(--brand-fg-on-soft)] tracking-tight">
            {money(rev)}
          </span>
        </div>
        <div className="text-right">
          <span className="block text-[10px] text-[var(--brand-fg-on-soft)] opacity-80">
            {money(revMonth)} this month
          </span>
          <span className="block text-[10px] text-[var(--brand-fg-on-soft)] opacity-70">
            {revCount.toLocaleString()} sale{revCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[10.5px] mb-1.5 font-mono">
          <span className="text-[var(--text-quaternary)] uppercase tracking-wide">Data</span>
          <span className="text-[var(--text-tertiary)]">
            {Math.round(usedQ / 1024)} / {Math.round(totalQ / 1024)} GB
          </span>
        </div>
        <div className="h-1.5 bg-[var(--surface-sunken)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--brand)] rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(dataPct, 100)}%` }}
          />
        </div>
      </div>
    </button>
  );
}

function MetricCard({ label, value, icon, sub }) {
  return (
    <div
      className={
        "rounded-lg p-4 " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-1)]"
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={
            "h-7 w-7 rounded-md inline-flex items-center justify-center " +
            "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
          }
        >
          {icon}
        </span>
        <span className="text-[12px] font-medium text-[var(--text-tertiary)]">
          {label}
        </span>
      </div>
      <p className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[12px] text-[var(--text-tertiary)] mt-1">{sub}</p>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, icon, children }) {
  return (
    <div
      className={
        "rounded-lg p-4 flex flex-col " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-1)]"
      }
    >
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[12px] font-medium text-[var(--text-tertiary)] mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
        <span className="h-7 w-7 rounded-md inline-flex items-center justify-center bg-[var(--surface-sunken)] text-[var(--text-tertiary)] border border-[var(--border-subtle)] shrink-0 ml-2">
          {icon}
        </span>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div className="text-left">
      <p
        className={
          "text-[15px] font-semibold " +
          (accent ? "text-[var(--brand)]" : "text-[var(--text-primary)]")
        }
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-[11.5px] font-medium text-[var(--text-tertiary)] mt-0.5">
        {label}
      </p>
    </div>
  );
}

function ProgressLine({ label, pct, color }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1 bg-[var(--surface-raised)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
      <span className="text-[11.5px] text-[var(--text-tertiary)] w-16 text-right">
        {pct}% {label}
      </span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={
        "rounded-md px-3 py-2 text-[11.5px] " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-2)]"
      }
    >
      {label && (
        <p className="text-[11.5px] font-medium text-[var(--text-tertiary)] mb-1">
          {label}
        </p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-[var(--text-tertiary)]">{entry.name}:</span>
          <span className="font-mono font-semibold text-[var(--text-primary)]">
            {typeof entry.value === "number"
              ? entry.value.toLocaleString()
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload || {};
  const money =
    "$" +
    Number(d.revenue || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <div
      className={
        "rounded-md px-3 py-2 text-[11.5px] " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-2)]"
      }
    >
      <p className="text-[11.5px] font-medium text-[var(--text-tertiary)] mb-1">{label}</p>
      <p className="font-mono font-semibold text-[var(--text-primary)]">{money}</p>
      <p className="mt-0.5 text-[var(--text-tertiary)]">
        {Number(d.count || 0).toLocaleString()} sale{Number(d.count) === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div
      className={
        "rounded-md px-3 py-2 text-[11.5px] " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-2)]"
      }
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: d.payload?.color || d.payload?.fill }}
        />
        <span className="font-medium text-[var(--text-primary)]">{d.name}</span>
      </div>
      <p className="mt-0.5 text-[var(--text-tertiary)]">
        {d.value?.toLocaleString()} vouchers
      </p>
    </div>
  );
}

function StatusBadgeMini({ status }) {
  const map = {
    "1": { label: "Unused", tone: "info" },
    "2": { label: "Active", tone: "success" },
    "3": { label: "Expired", tone: "danger" },
    "0": { label: "Inactive", tone: "neutral" },
  };
  const c = map[String(status)] || map["0"];
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

function EmptyChart({ message = "No data available" }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-[var(--text-quaternary)]">
      <BarChart3 size={26} className="mb-2 opacity-60" />
      <p className="text-[12px] font-medium">{message}</p>
    </div>
  );
}
