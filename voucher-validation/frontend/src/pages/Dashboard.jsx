// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { voucherApi } from "../services/api";
import toast from "react-hot-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart,
  Area, Tooltip, Legend,
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
  XCircle,
  ArrowUpRight,
} from "lucide-react";

// Classify a package into a time-based category by its time_period (minutes)
function classifyPackage(timePeriodMinutes) {
  const mins = Number(timePeriodMinutes || 0);
  if (mins <= 1440) return "daily";
  if (mins <= 10080) return "weekly";
  return "monthly";
}

export default function Dashboard() {
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
      console.warn("Auto-sync failed:", err.message);
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
        toast.error("Session expired. Please login again.");
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

  // ── Data helpers ───────────────────────────────────────────

  const getFilteredPackageStats = () => {
    if (!voucherStats?.packageStats) return [];
    if (activeView === "overview") return voucherStats.packageStats;
    return voucherStats.packageStats.filter(
      (pkg) => classifyPackage(Number(pkg.avg_duration_minutes || 0)) === activeView
    );
  };

  const getTopMetrics = () => {
    const filtered = getFilteredPackageStats();
    const totalVouchers = filtered.reduce((s, p) => s + Number(p.total || 0), 0);
    const unusedVouchers = filtered.reduce((s, p) => s + Number(p.unused || 0), 0);
    const activeVouchers = filtered.reduce((s, p) => s + Number(p.active || 0), 0);
    const liveUsers = filtered.reduce((s, p) => s + Number(p.currently_in_use || 0), 0);
    const totalDataUsage = filtered.reduce((s, p) => s + Number(p.total_used_quota_mb || 0), 0);
    const totalQuota = filtered.reduce((s, p) => s + Number(p.total_quota_mb || 0), 0);
    const expired = filtered.reduce((s, p) => s + Number(p.expired || 0), 0);
    const inactive = filtered.reduce((s, p) => s + Number(p.inactive || 0), 0);
    return { totalVouchers, unusedVouchers, activeVouchers, liveUsers, totalDataUsage, totalQuota, expired, inactive };
  };

  // Pie chart — package distribution (total vouchers per package)
  const getPieData = () => {
    const filtered = getFilteredPackageStats();
    return filtered
      .filter((p) => Number(p.total || 0) > 0)
      .map((p) => ({
        name: p.package_name || "Unknown",
        value: Number(p.total || 0),
      }));
  };

  // Status donut data
  const getStatusData = () => {
    const m = getTopMetrics();
    const data = [];
    if (m.unusedVouchers > 0) data.push({ name: "Unused", value: m.unusedVouchers, color: "#3B82F6" });
    if (m.activeVouchers > 0) data.push({ name: "Active", value: m.activeVouchers, color: "#10B981" });
    if (m.expired > 0) data.push({ name: "Expired", value: m.expired, color: "#EF4444" });
    if (m.inactive > 0) data.push({ name: "Inactive", value: m.inactive, color: "#6B7280" });
    return data;
  };

  // Bar chart — quota comparison per package
  const getQuotaBarData = () => {
    const filtered = getFilteredPackageStats();
    return filtered.map((p) => ({
      name: p.package_name || "Unknown",
      shortName: (p.package_name || "Unknown").length > 12
        ? (p.package_name || "Unknown").substring(0, 12) + "..."
        : (p.package_name || "Unknown"),
      allocated: Math.round(Number(p.total_quota_mb || 0) / 1024),
      consumed: Math.round(Number(p.total_used_quota_mb || 0) / 1024),
    }));
  };

  // Sync trend
  const getSyncTrendData = () =>
    syncLogs
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

  // ── Chart colors ───────────────────────────────────────────
  const PIE_COLORS = ["#8B5CF6", "#EC4899", "#06B6D4", "#F59E0B", "#10B981", "#6366F1"];

  // ── Custom tooltip ─────────────────────────────────────────
  const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-xl text-xs border border-gray-700">
        {label && <p className="font-semibold text-gray-300 mb-1.5">{label}</p>}
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
            <span className="text-gray-400">{entry.name}:</span>
            <span className="font-bold">{typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-xl text-xs border border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.payload?.color || d.payload?.fill }} />
          <span className="font-semibold">{d.name}</span>
        </div>
        <p className="mt-1 text-gray-300">{d.value?.toLocaleString()} vouchers</p>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────

  if (loading)
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-12 h-12 border-[3px] border-purple-100 border-t-purple-500 rounded-full animate-spin" />
        <p className="text-sm font-medium text-gray-400">
          {syncing ? "Syncing with Ruijie Cloud..." : "Loading analytics..."}
        </p>
      </div>
    );

  const metrics = getTopMetrics();
  const pieData = getPieData();
  const statusData = getStatusData();
  const quotaBarData = getQuotaBarData();
  const syncTrendData = getSyncTrendData();
  const lastSync = syncLogs[0];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-6 space-y-6 flex-1">
        {/* ── Header ────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-xs text-gray-400 font-medium mt-0.5">
                Voucher analytics & overview
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {syncing && (
              <div className="flex items-center gap-1.5 text-xs text-purple-500 font-medium bg-purple-50 px-3 py-1.5 rounded-lg">
                <RefreshCw size={12} className="animate-spin" />
                Syncing...
              </div>
            )}
            {lastSync && (
              <div className="text-[11px] text-gray-300 font-medium">
                Last sync: {new Date(lastSync.sync_started_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* ── View Tabs ─────────────────────────────────────── */}
        <div className="flex items-center bg-gray-100/80 rounded-xl p-1 w-fit">
          {[
            { key: "overview", label: "All Packages" },
            { key: "daily", label: "Daily" },
            { key: "weekly", label: "Weekly" },
            { key: "monthly", label: "Monthly" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeView === key
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Metric Cards ──────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Vouchers"
            value={metrics.totalVouchers.toLocaleString()}
            icon={<Database size={18} />}
            color="purple"
            sub={`${metrics.activeVouchers} active`}
          />
          <MetricCard
            label="Live Users"
            value={metrics.liveUsers.toLocaleString()}
            icon={<Users size={18} />}
            color="blue"
            sub="Currently connected"
          />
          <MetricCard
            label="Data Consumed"
            value={formatQuota(metrics.totalDataUsage)}
            icon={<HardDrive size={18} />}
            color="green"
            sub={`of ${formatQuota(metrics.totalQuota)} total`}
          />
          <MetricCard
            label="Active Rate"
            value={
              metrics.totalVouchers
                ? `${Math.round((metrics.activeVouchers / metrics.totalVouchers) * 100)}%`
                : "0%"
            }
            icon={<Zap size={18} />}
            color="orange"
            sub={`${metrics.expiredUsed} expired / used`}
          />
        </div>

        {/* ── Charts Row 1 ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Package Distribution Pie */}
          <ChartCard title="Package Distribution" icon={<Activity size={15} />}>
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
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={0}
                    >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => handlePackageDrillDown(pieData[i].name)}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                      formatter={(val) => <span className="text-gray-500 ml-1">{val}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          {/* Status Breakdown Donut */}
          <ChartCard title="Status Breakdown" icon={<CheckCircle size={15} />}>
            {statusData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={4}
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
                {/* Legend below */}
                <div className="shrink-0 flex flex-col gap-2 pt-3 border-t border-gray-50 mt-2">
                  {statusData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-xs text-gray-500 font-medium">{d.name}</span>
                      </div>
                      <span className="text-xs font-bold text-gray-700">{d.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>

          {/* Data Quota Usage Bar */}
          <ChartCard title="Data Quota by Package" subtitle="Allocated vs Consumed (GB)" icon={<TrendingUp size={15} />}>
            {quotaBarData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={quotaBarData} barGap={2} barCategoryGap="25%" margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <defs>
                      <linearGradient id="barAllocated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="barConsumed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#EC4899" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#EC4899" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis
                      dataKey="shortName"
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={40}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      tickLine={false}
                      axisLine={false}
                      width={35}
                      label={{ value: "GB", position: "insideTopLeft", offset: -5, style: { fontSize: 10, fill: "#9ca3af" } }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      iconSize={7}
                      wrapperStyle={{ fontSize: 10, paddingBottom: 4 }}
                      formatter={(val) => <span className="text-gray-500 ml-1">{val}</span>}
                    />
                    <Bar dataKey="allocated" name="Allocated" fill="url(#barAllocated)" radius={[5, 5, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="consumed" name="Consumed" fill="url(#barConsumed)" radius={[5, 5, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* ── Charts Row 2 ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Sync Activity Trend */}
          <ChartCard title="Sync Activity" subtitle="Last 7 syncs" icon={<Clock size={15} />}>
            {syncTrendData.length === 0 ? (
              <EmptyChart message="No sync history yet" />
            ) : (
              <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={syncTrendData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <defs>
                    <linearGradient id="syncProcessed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="syncNew" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    width={35}
                    label={{ value: "Count", position: "insideTopLeft", offset: -5, style: { fontSize: 10, fill: "#9ca3af" } }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                    formatter={(val) => <span className="text-gray-500 ml-1">{val}</span>}
                  />
                  <Area
                    type="monotone"
                    dataKey="processed"
                    name="Processed"
                    stroke="#8B5CF6"
                    strokeWidth={2.5}
                    fill="url(#syncProcessed)"
                    dot={{ r: 3, fill: "#8B5CF6", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#8B5CF6", strokeWidth: 2, stroke: "#fff" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="new"
                    name="New"
                    stroke="#10B981"
                    strokeWidth={2}
                    fill="url(#syncNew)"
                    dot={{ r: 3, fill: "#10B981", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#10B981", strokeWidth: 2, stroke: "#fff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          {/* Quick Overview Panel */}
          <ChartCard title="Quick Overview" icon={<Wifi size={15} />}>
            <div className="space-y-3 overflow-y-auto max-h-[280px]">
              {getFilteredPackageStats().map((pkg, i) => {
                const total = Number(pkg.total || 0);
                const active = Number(pkg.active || 0);
                const pct = total ? Math.round((active / total) * 100) : 0;
                const usedQuota = Number(pkg.total_used_quota_mb || 0);
                const totalQuota = Number(pkg.total_quota_mb || 0);
                const dataPct = totalQuota ? Math.round((usedQuota / totalQuota) * 100) : 0;

                return (
                  <div
                    key={i}
                    className="group p-3.5 bg-gray-50/80 hover:bg-purple-50/60 rounded-xl transition-all cursor-pointer border border-transparent hover:border-purple-100"
                    onClick={() => handlePackageDrillDown(pkg.package_name)}
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-sm font-semibold text-gray-700 group-hover:text-purple-700 transition-colors">
                          {pkg.package_name || "Unknown"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-gray-800">{total}</span>
                        <span className="text-[10px] text-gray-400">vouchers</span>
                        <ArrowUpRight size={13} className="text-gray-300 group-hover:text-purple-400 transition-colors" />
                      </div>
                    </div>
                    {/* Active bar */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="h-1.5 bg-gray-200/80 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              background: PIE_COLORS[i % PIE_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-gray-400 w-10 text-right">
                        {pct}% active
                      </span>
                    </div>
                    {/* Data usage bar */}
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex-1">
                        <div className="h-1.5 bg-gray-200/80 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-pink-400 to-orange-400 rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(dataPct, 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-gray-400 w-10 text-right">
                        {dataPct}% data
                      </span>
                    </div>
                  </div>
                );
              })}

              {getFilteredPackageStats().length === 0 && <EmptyChart message="No packages in this category" />}
            </div>
          </ChartCard>
        </div>

        {/* ── Package Detail Cards ──────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Package Breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {getFilteredPackageStats().map((pkg, i) => {
              const total = Number(pkg.total || 0);
              const active = Number(pkg.active || 0);
              const expired = Number(pkg.expired || 0);
              const liveUsers = Number(pkg.currently_in_use || 0);
              const usedQ = Math.round(Number(pkg.total_used_quota_mb || 0) / 1024);
              const totalQ = Math.round(Number(pkg.total_quota_mb || 0) / 1024);
              const dataPct = totalQ ? Math.round((usedQ / totalQ) * 100) : 0;

              return (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-purple-200 hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => handlePackageDrillDown(pkg.package_name)}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <h3 className="text-sm font-bold text-gray-800 group-hover:text-purple-600 transition-colors">
                        {pkg.package_name || "Unknown"}
                      </h3>
                    </div>
                    <ArrowUpRight size={14} className="text-gray-200 group-hover:text-purple-400 transition-colors" />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <MiniStat label="Total" value={total} />
                    <MiniStat label="Active" value={active} color="text-green-600" />
                    <MiniStat label="Live" value={liveUsers} color="text-blue-600" />
                  </div>

                  {/* Data progress */}
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-1.5">
                      <span className="text-gray-400 font-medium">Data Usage</span>
                      <span className="font-semibold text-gray-500">
                        {usedQ} / {totalQ} GB
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-700"
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

      {/* ── Drill-Down Modal ──────────────────────────────── */}
      {selectedPackage && drillDownData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-5xl max-h-[85vh] overflow-auto bg-white rounded-2xl shadow-2xl">
            {/* Modal accent */}
            <div className="h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400" />

            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{selectedPackage}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Package detail view</p>
                </div>
                <button
                  onClick={() => { setSelectedPackage(null); setDrillDownData(null); }}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  <XCircle size={16} className="text-gray-500" />
                </button>
              </div>

              {/* Stat chips */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  { label: "Total", value: drillDownData.total, color: "purple" },
                  { label: "Active Now", value: drillDownData.vouchers?.filter((v) => Number(v.current_clients) > 0).length || 0, color: "green" },
                  { label: "Usage Rate", value: drillDownData.total ? `${Math.round((drillDownData.vouchers?.filter((v) => Number(v.used_time) > 0).length / drillDownData.total) * 100)}%` : "0%", color: "blue" },
                  { label: "Data Used", value: formatQuota(drillDownData.vouchers?.reduce((s, v) => s + Number(v.used_quota || 0), 0) || 0), color: "orange" },
                ].map((s, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-lg font-bold text-gray-800">{s.value}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] text-gray-400 uppercase tracking-wider font-semibold text-left">
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Clients</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(drillDownData.vouchers || []).slice(0, 15).map((v) => (
                      <tr key={v.uuid} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold text-purple-600 bg-purple-50/60 px-2 py-0.5 rounded-md">
                            {v.voucher_code}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                              v.status === "1"
                                ? "bg-green-50 text-green-600"
                                : v.status === "2"
                                ? "bg-amber-50 text-amber-600"
                                : v.status === "3"
                                ? "bg-red-50 text-red-600"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {v.status === "1" ? "Active" : v.status === "2" ? "Used" : v.status === "3" ? "Disabled" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {v.current_clients}/{v.max_clients}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {formatDuration(v.used_time)} / {formatDuration(v.time_period)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {formatQuota(v.used_quota)} / {formatQuota(v.quota)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function MetricCard({ label, value, icon, color, sub }) {
  const styles = {
    purple: { bg: "bg-purple-50", icon: "bg-purple-100 text-purple-500", accent: "text-purple-600" },
    blue: { bg: "bg-blue-50", icon: "bg-blue-100 text-blue-500", accent: "text-blue-600" },
    green: { bg: "bg-green-50", icon: "bg-green-100 text-green-500", accent: "text-green-600" },
    orange: { bg: "bg-orange-50", icon: "bg-orange-100 text-orange-500", accent: "text-orange-600" },
  };
  const s = styles[color];

  return (
    <div className={`${s.bg} rounded-2xl p-5 transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 ${s.icon} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs font-semibold text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, icon, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-800 truncate">{title}</h3>
          {subtitle && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 shrink-0 ml-2">
          {icon}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = "text-gray-800" }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${color}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
    </div>
  );
}

function EmptyChart({ message = "No data available" }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-gray-300">
      <BarChart3 size={28} className="mb-2 text-gray-200" />
      <p className="text-xs font-medium">{message}</p>
    </div>
  );
}
