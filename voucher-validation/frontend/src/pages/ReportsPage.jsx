// src/pages/ReportsPage.jsx
// Everything about one month, in one place: pick a month, see the totals and
// the splits behind them. One backend call fills the whole page.
//
// Every figure here comes from the LOCAL database (portal_audit_logs +
// voucher_claims), never from Ruijie or Starlink, so changing month is cheap
// and cannot contribute to any upstream rate limit.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  BarChart3, ChevronLeft, ChevronRight, RefreshCw, DollarSign, Ticket,
  Users, Wifi, AlertTriangle, Clock, MapPin,
} from "lucide-react";

import { useSite } from "../hooks/useSite";
import { portalConfigApi } from "../services/api";
import {
  PageHeader, Button, Panel, StatCard, EmptyState, Select, Badge,
  SkeletonKpis, SkeletonCard,
  CHART_COLORS, CHART_SERIES, ChartTooltip, useChartTheme,
  ChartStat, LegendRow, axisX, axisY, gridProps, BAR_RADIUS, BAR_MAX_SIZE, BAR_CATEGORY_GAP,
} from "../components/ui";

const money = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString();

const monthLabel = (m) => {
  if (!m) return "";
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
};

/** Event types worth naming; anything else is shown raw. */
const OUTCOME_LABEL = {
  payment_success: "Payment succeeded",
  payment_failed: "Payment failed",
  voucher_claimed: "Voucher issued",
  voucher_claim_failed: "Voucher claim failed",
  auth_success: "Connected",
  auth_failed: "Connection failed",
  manual_assistance_created: "Manual assistance",
  callback_received: "Callbacks received",
  receipt_email_sent: "Receipt emailed",
  receipt_email_skipped: "Receipt skipped",
};
const outcomeTone = (t) =>
  /fail|error/.test(t) ? CHART_COLORS.rose
    : /success|claimed|sent/.test(t) ? CHART_COLORS.emerald
    : /manual|skipped/.test(t) ? CHART_COLORS.amber
    : CHART_COLORS.slate;

export default function ReportsPage() {
  const { activeGroupId, activeSiteId, sites } = useSite();
  const ct = useChartTheme();
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m) => {
    setLoading(true);
    try {
      const params = {};
      if (m) params.month = m;
      if (activeGroupId) params.groupId = activeGroupId;
      const res = await portalConfigApi.breakdown(params);
      setData(res);
      setMonth(res.month || "");
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeGroupId]);

  useEffect(() => { load(month || undefined); /* eslint-disable-next-line */ }, [activeGroupId]);

  const months = data?.months || [];
  const idx = months.findIndex((m) => m.month === month);
  const step = (delta) => {
    const next = months[idx + delta];
    if (next) { setMonth(next.month); load(next.month); }
  };

  const t = data?.totals || {};
  const daily = data?.daily || [];
  const byPlan = data?.byPlan || [];
  const byVillage = data?.byVillage || [];
  const byHour = data?.byHour || [];
  const outcomes = data?.outcomes || [];
  const soldByPlan = data?.soldByPlan || [];

  const planTotal = useMemo(() => byPlan.reduce((a, p) => a + p.revenue, 0), [byPlan]);
  const villageTotal = useMemo(() => byVillage.reduce((a, v) => a + v.revenue, 0), [byVillage]);
  const busiestHour = useMemo(
    () => byHour.reduce((best, h) => (h.count > (best?.count ?? -1) ? h : best), null),
    [byHour]
  );
  const scopeName = activeSiteId ? sites.find((s) => s.id === activeSiteId)?.name : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-up">
      <PageHeader
        eyebrow="Reports"
        title="Monthly breakdown"
        subtitle={scopeName ? `${scopeName} — ${monthLabel(month)}` : `All villages — ${monthLabel(month)}`}
        icon={<BarChart3 size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => step(1)} disabled={idx < 0 || idx >= months.length - 1} aria-label="Earlier month">
              <ChevronLeft size={15} />
            </Button>
            <Select
              value={month}
              onChange={(e) => { setMonth(e.target.value); load(e.target.value); }}
              className="min-w-[190px]"
            >
              {months.length === 0 && <option value="">No sales yet</option>}
              {months.map((m) => (
                <option key={m.month} value={m.month}>
                  {monthLabel(m.month)} · {num(m.txns)} sales
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={() => step(-1)} disabled={idx <= 0} aria-label="Later month">
              <ChevronRight size={15} />
            </Button>
            <Button variant="secondary" size="sm" iconLeft={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />} onClick={() => load(month)} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      {loading && !data ? (
        <div className="mt-6 space-y-6">
          <SkeletonKpis count={4} />
          <SkeletonCard height="h-80" />
        </div>
      ) : months.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BarChart3} title="No sales recorded yet" description="Once a customer completes a purchase, the month appears here." />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Totals for the selected month */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Revenue" value={money(t.revenue)} icon={<DollarSign size={18} />} color="accent" sub={`${num(t.transactions)} paid transactions`} />
            <StatCard label="Vouchers sold" value={num(t.sold)} icon={<Ticket size={18} />} color="blue" sub={`${num(t.customers)} customers`} />
            <StatCard label="Average sale" value={money(t.avgSale)} icon={<BarChart3 size={18} />} color="violet" />
            <StatCard
              label="Got online"
              value={`${t.connectedPct ?? 0}%`}
              icon={<Wifi size={18} />}
              color={(t.connectedPct ?? 0) >= 95 ? "emerald" : (t.connectedPct ?? 0) >= 80 ? "amber" : "rose"}
              sub={`${num(t.connected)} of ${num(t.transactions)}`}
            />
          </div>

          {/* Money that did not turn into a connection is the number worth
              acting on, so it gets its own row rather than a footnote. */}
          {(t.manualCases > 0 || t.paidNoVoucher > 0 || t.revenueAtRisk > 0) && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Needed help" value={num(t.manualCases)} icon={<AlertTriangle size={18} />} color="amber" sub="paid, auth failed" />
              <StatCard label="Paid, no voucher" value={num(t.paidNoVoucher)} icon={<Ticket size={18} />} color={t.paidNoVoucher ? "rose" : "slate"} />
              <StatCard label="Revenue at risk" value={money(t.revenueAtRisk)} icon={<DollarSign size={18} />} color={t.revenueAtRisk ? "rose" : "slate"} sub="never connected" />
              <StatCard label="Busiest hour" value={busiestHour ? `${busiestHour.h}:00` : "—"} icon={<Clock size={18} />} color="cyan" sub={busiestHour ? `${num(busiestHour.count)} sales` : ""} />
            </div>
          )}

          {/* Revenue by day */}
          <Panel title="Revenue by day" subtitle={monthLabel(month)} icon={<DollarSign size={15} />}>
            <ChartStat value={money(t.revenue)} unit="this month" caption={`${num(t.transactions)} paid transactions`} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={daily} margin={{ top: 8, right: 8, left: -4, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
                <CartesianGrid {...gridProps(ct)} />
                <XAxis dataKey="d" {...axisX(ct)} />
                <YAxis {...axisY(ct, { width: 52 })} tickFormatter={(v) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                <Tooltip content={<ChartTooltip valueFormatter={(v, e) => (e?.dataKey === "revenue" ? money(v) : num(v))} labelFormatter={(d) => `Day ${d}`} />} cursor={{ fill: ct.cursor }} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.accent} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue by plan */}
            <Panel title="Revenue by plan" icon={<Ticket size={15} />}>
              {byPlan.length === 0 ? (
                <EmptyState icon={Ticket} title="No sales this month" />
              ) : (
                <div className="flex items-center gap-5">
                  <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={byPlan} dataKey="revenue" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} cornerRadius={6} stroke="none" isAnimationActive={false}>
                          {byPlan.map((_, i) => <Cell key={i} fill={CHART_SERIES[i % CHART_SERIES.length]} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip hideLabel valueFormatter={money} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-semibold text-[var(--fg-primary)] tabular-nums leading-none">{money(planTotal)}</span>
                      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-muted)] mt-1">Total</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2.5">
                    {byPlan.slice(0, 6).map((p, i) => (
                      <LegendRow key={p.name} color={CHART_SERIES[i % CHART_SERIES.length]} label={p.name} value={money(p.revenue)} total={planTotal} />
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* Vouchers sold by plan */}
            <Panel title="Vouchers sold by plan" subtitle="From the claim ledger" icon={<Ticket size={15} />}>
              {soldByPlan.length === 0 ? (
                <EmptyState icon={Ticket} title="No vouchers claimed this month" />
              ) : (
                <ResponsiveContainer width="100%" height={232}>
                  <BarChart data={soldByPlan} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
                    <CartesianGrid {...gridProps(ct)} horizontal={false} vertical />
                    <XAxis type="number" {...axisX(ct)} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" {...axisY(ct, { width: 104 })} />
                    <Tooltip content={<ChartTooltip valueFormatter={num} />} cursor={{ fill: ct.cursor }} />
                    <Bar dataKey="sold" name="Sold" fill={CHART_COLORS.blue} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales by hour */}
            <Panel title="Sales by hour" subtitle="When customers buy" icon={<Clock size={15} />}>
              <ResponsiveContainer width="100%" height={232}>
                <BarChart data={byHour} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="14%">
                  <CartesianGrid {...gridProps(ct)} />
                  <XAxis dataKey="h" {...axisX(ct, { minTickGap: 8 })} />
                  <YAxis {...axisY(ct, { width: 32 })} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip valueFormatter={num} labelFormatter={(h) => `${h}:00`} />} cursor={{ fill: ct.cursor }} />
                  <Bar dataKey="count" name="Sales" fill={CHART_COLORS.violet} radius={BAR_RADIUS} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            {/* Revenue by village — only meaningful across villages */}
            {!activeGroupId && (
              <Panel title="Revenue by village" icon={<MapPin size={15} />}>
                {byVillage.length === 0 ? (
                  <EmptyState icon={MapPin} title="No sales this month" />
                ) : (
                  <ResponsiveContainer width="100%" height={232}>
                    <BarChart data={byVillage.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
                      <CartesianGrid {...gridProps(ct)} horizontal={false} vertical />
                      <XAxis type="number" {...axisX(ct)} tickFormatter={(v) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                      <YAxis type="category" dataKey="name" {...axisY(ct, { width: 104 })} />
                      <Tooltip content={<ChartTooltip valueFormatter={money} />} cursor={{ fill: ct.cursor }} />
                      <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.accent} radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Panel>
            )}

            {/* What happened, successes and failures alike */}
            <Panel title="What happened" subtitle="Every recorded event this month" icon={<Users size={15} />}>
              {outcomes.length === 0 ? (
                <EmptyState icon={Users} title="No activity this month" />
              ) : (
                <div className="space-y-2.5 max-h-[232px] overflow-y-auto scrollbar-none pr-1">
                  {outcomes.slice(0, 12).map((o) => (
                    <LegendRow
                      key={o.type}
                      color={outcomeTone(o.type)}
                      label={OUTCOME_LABEL[o.type] || o.type.replace(/_/g, " ")}
                      value={num(o.count)}
                      total={outcomes[0]?.count || 0}
                    />
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Village table, so the numbers can be read exactly rather than
              estimated off a bar. */}
          {!activeGroupId && byVillage.length > 0 && (
            <Panel title="Village detail" subtitle={`${byVillage.length} villages with sales in ${monthLabel(month)}`} icon={<MapPin size={15} />} padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--fg-muted)] border-b border-[var(--border-default)]">
                      <th className="px-5 py-3 font-medium">Village</th>
                      <th className="px-5 py-3 font-medium text-right">Revenue</th>
                      <th className="px-5 py-3 font-medium text-right">Transactions</th>
                      <th className="px-5 py-3 font-medium text-right">Avg sale</th>
                      <th className="px-5 py-3 font-medium text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byVillage.map((v) => (
                      <tr key={v.name} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors">
                        <td className="px-5 py-3 text-[var(--fg-primary)] font-medium">{v.name}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{money(v.revenue)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-[var(--fg-secondary)]">{num(v.count)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-[var(--fg-secondary)]">{money(v.count ? v.revenue / v.count : 0)}</td>
                        <td className="px-5 py-3 text-right">
                          <Badge tone="neutral">{villageTotal ? Math.round((v.revenue / villageTotal) * 100) : 0}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
