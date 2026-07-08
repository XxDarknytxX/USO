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
      const [statsData, logsData] = await Promise.all([
        api("/vouchers/stats", { auth: true }),
        api("/vouchers/sync-logs", { auth: true }),
      ]);
      setVoucherStats(statsData);
      setSyncLogs(logsData.logs || []);
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
      const data = await api(
        `/vouchers?packageName=${encodeURIComponent(packageName)}&limit=100`,
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

  const filteredPackageStats = useMemo(() => {
    if (!voucherStats?.packageStats) return [];
    if (activeView === "overview") return voucherStats.packageStats;
    return voucherStats.packageStats.filter(
      (pkg) => classifyPackage(Number(pkg.avg_duration_minutes || 0)) === activeView
    );
  }, [voucherStats, activeView]);

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

        {/* ----- Metric tiles ----- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Total vouchers"
            value={metrics.totalVouchers.toLocaleString()}
            icon={<Database size={14} />}
            sub={`${metrics.activeVouchers.toLocaleString()} active`}
          />
          <MetricCard
            label="Live users"
            value={metrics.liveUsers.toLocaleString()}
            icon={<Users size={14} />}
            sub="Currently connected"
          />
          <MetricCard
            label="Data consumed"
            value={formatQuota(metrics.totalDataUsage)}
            icon={<HardDrive size={14} />}
            sub={`of ${formatQuota(metrics.totalQuota)}`}
          />
          <MetricCard
            label="Active rate"
            value={
              metrics.totalVouchers
                ? `${Math.round((metrics.activeVouchers / metrics.totalVouchers) * 100)}%`
                : "0%"
            }
            icon={<Zap size={14} />}
            sub={`${metrics.expired.toLocaleString()} expired`}
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

        {/* ----- Charts Row 1 ----- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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

          <ChartCard
            title="Quota by package"
            subtitle="Allocated · Consumed (GB)"
            icon={<TrendingUp size={14} />}
          >
            {quotaBarData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={quotaBarData}
                    barGap={2}
                    barCategoryGap="25%"
                    margin={{ top: 5, right: 5, bottom: 5, left: -10 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border-subtle)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="shortName"
                      tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={40}
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
                      wrapperStyle={{ fontSize: 10, paddingBottom: 4 }}
                      formatter={(val) => (
                        <span
                          className="ml-1"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {val}
                        </span>
                      )}
                    />
                    <Bar
                      dataKey="allocated"
                      name="Allocated"
                      fill={getVar("--color-ink-400", "#9aa1ab")}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={26}
                    />
                    <Bar
                      dataKey="consumed"
                      name="Consumed"
                      fill={getVar("--brand", "#e60000")}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={26}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

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

        {/* ----- Package breakdown cards ----- */}
        <div>
          <h2 className="text-[12px] font-medium text-[var(--text-tertiary)] mb-3">
            Package breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredPackageStats.map((pkg, i) => {
              const total = Number(pkg.total || 0);
              const active = Number(pkg.active || 0);
              const liveUsers = Number(pkg.currently_in_use || 0);
              const usedQ = Math.round(Number(pkg.total_used_quota_mb || 0) / 1024);
              const totalQ = Math.round(Number(pkg.total_quota_mb || 0) / 1024);
              const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;
              const color = getVar(PALETTE_VARS[i % PALETTE_VARS.length], "#e60000");

              return (
                <div
                  key={i}
                  onClick={() => handlePackageDrillDown(pkg.package_name)}
                  className={
                    "p-4 rounded-lg cursor-pointer transition-[border-color,background-color] " +
                    "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
                    "hover:border-[var(--brand)] hover:bg-[var(--surface-hover)]"
                  }
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)] truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: color }}
                      />
                      {pkg.package_name || "Unknown"}
                    </span>
                    <ArrowUpRight size={13} className="text-[var(--text-quaternary)]" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MiniStat label="Total" value={total} />
                    <MiniStat label="Active" value={active} />
                    <MiniStat label="Live" value={liveUsers} accent />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11.5px] mb-1.5 font-medium">
                      <span className="text-[var(--text-tertiary)]">
                        Data usage
                      </span>
                      <span className="text-[var(--text-tertiary)]">
                        {usedQ} / {totalQ} GB
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--surface-sunken)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--brand)] rounded-full transition-[width] duration-500"
                        style={{ width: `${Math.min(dataPct, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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

function SiteCard({ name, hostname, stats, onOpen }) {
  const total = Number(stats.total || 0);
  const active = Number(stats.active || 0);
  const live = Number(stats.currently_in_use || 0);
  const usedQ = Number(stats.total_used_quota_mb || 0);
  const totalQ = Number(stats.total_quota_mb || 0);
  const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;
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
