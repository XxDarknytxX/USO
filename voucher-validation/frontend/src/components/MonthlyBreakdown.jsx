// src/components/MonthlyBreakdown.jsx
// Everything about one reporting window, as panels a dashboard composes itself.
//
// Pick a window in the page header and every figure here re-scopes; one backend
// call fills the lot.
//
// This used to render as a single ten-panel stack dropped under the KPI rail,
// which is most of why the dashboard scrolled forever — and why revenue, sold
// and average sale each appeared twice on one screen. The pieces are exported
// individually now: the two that answer "are we earning" go in the dashboard's
// primary chart row, the rest sit behind its analysis tabs. The default export
// still stacks all of them, so a caller that wants the whole section unchanged
// keeps working.
//
// Every figure here comes from the LOCAL database (portal_audit_logs +
// voucher_claims), never from Ruijie or Starlink, so changing the window is
// cheap and cannot contribute to any upstream rate limit.

import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  BarChart3, DollarSign, Ticket,
  Users, Wifi, AlertTriangle, Clock, MapPin, ChevronRight,
} from "lucide-react";

import { rangeLabel } from "../hooks/useMonthlyBreakdown";
import {
  PHONE_CARD, PHONE_ROWS, phoneRowClass, PhoneMore, PhoneChevron,
  PhoneList, PhoneFacts, PhoneBarRow, usePhone, shortLabel,
} from "./ui/phone";
import {
  Panel, StatCard, EmptyState, Badge, KpiGrid, Button,
  DataTable, Th, Td,
  SkeletonKpis, SkeletonCard,
  CHART_COLORS, CHART_SERIES, ChartTooltip, ChartGradient, useChartTheme,
  ChartStat, LegendRow, DONUT, DonutCenter,
  axisX, axisY, gridProps, BAR_RADIUS, BAR_MAX_SIZE, BAR_CATEGORY_GAP,
} from "./ui";

const money = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString();

/* Phone helpers now live in ui/phone.jsx — see the note there. Re-exported so
   a panel file can keep importing them from one place. */
export {
  PHONE_CARD, PHONE_ROWS, phoneRowClass, PhoneMore, PhoneChevron,
  PhoneList, PhoneFacts, PhoneBarRow, usePhone, shortLabel,
} from "./ui/phone";

/** Event types worth naming; anything else falls back to `outcomeLabel`. */
const OUTCOME_LABEL = {
  payment_initiated: "Payment started",
  payment_success: "Payment succeeded",
  payment_failed: "Payment failed",
  voucher_claimed: "Voucher issued",
  voucher_claim_failed: "Voucher claim failed",
  voucher_reserved_manual: "Voucher reserved manually",
  auth_success: "Connected",
  auth_failed: "Connection failed",
  manual_assistance_created: "Manual assistance",
  manual_assistance_resolved: "Manual assistance resolved",
  callback_received: "Callbacks received",
  receipt_email_sent: "Receipt emailed",
  receipt_email_skipped: "Receipt skipped",
};
/**
 * A name for an event type we have not spelled out. The raw key printed as-is
 * sat lowercase in a column of sentence-case rows; the ledger grows new event
 * types faster than this map does, so the fallback matches the house style
 * rather than waiting for someone to notice.
 */
const outcomeLabel = (t) => {
  if (OUTCOME_LABEL[t]) return OUTCOME_LABEL[t];
  const words = String(t).replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : String(t);
};
const outcomeTone = (t) =>
  /fail|error/.test(t) ? CHART_COLORS.danger
    : /success|claimed|sent/.test(t) ? CHART_COLORS.success
    : /manual|skipped/.test(t) ? CHART_COLORS.warning
    : CHART_COLORS.slate;

/* ───────────────────────── Shared state helpers ─────────────────────────
 * Each panel is dropped into a tab on its own, so each has to answer "still
 * loading?" for itself rather than relying on one wrapper around the stack. */

/** True before the first payload lands — panels render a skeleton instead. */
const isCold = (state) => state.loading && !state.data;

/**
 * False only once we KNOW there has never been a sale. While the first payload
 * is in flight it stays true, so a page shows the panels (and their skeletons)
 * rather than flashing "no sales recorded yet" on every load.
 */
export function hasSalesHistory(state) {
  if (state?.loading && !state?.data) return true;
  return (state?.months?.length || 0) > 0;
}

/** The "nothing has ever been sold" state, for a page to show in place of the analysis. */
export function BreakdownEmpty() {
  const phone = usePhone();
  return (
    <EmptyState
      className="max-sm:py-8"
      icon={phone ? null : BarChart3}
      title="No sales recorded yet"
      description="Once a customer completes a purchase, the window appears here."
    />
  );
}

/* ───────────────────────── Primary row ───────────────────────── */

/**
 * The revenue trend — the one chart that belongs above the fold. Its headline
 * also carries average sale, which used to occupy a KPI tile of its own.
 */
export function RevenueTrendPanel({ state, className }) {
  const ct = useChartTheme();
  // A month of daily bars in 290px leaves each one about 7px wide at the shared
  // category gap, which reads as a row of hairlines. A phone closes the gaps and
  // spends less height on a chart you scroll past to reach the day you want.
  const phone = usePhone();
  const { data } = state;
  const t = data?.totals || {};
  const daily = data?.daily || [];
  // "All time" buckets by month, every other window by day — the wording and
  // the tooltip follow whatever the server actually bucketed by.
  const byMonthBuckets = (data?.dailyUnit || "day") === "month";
  const windowLabel = rangeLabel(state.month);
  const barLabel = (d) => (String(d).match(/^\d+$/) ? `Day ${d}` : String(d));

  if (isCold(state)) return <SkeletonCard height="h-[400px]" className={className} />;

  return (
    <Panel
      title={byMonthBuckets ? "Revenue by month" : "Revenue by day"}
      subtitle={windowLabel}
      icon={<DollarSign size={15} />}
      tone="red"
      className={className}
    >
      <ChartStat
        value={money(t.revenue)}
        unit={windowLabel}
        caption={`${num(t.transactions)} paid transactions · ${money(t.avgSale)} average sale`}
      />
      <ResponsiveContainer width="100%" height={phone ? 208 : 268}>
        <BarChart data={daily} margin={{ top: 8, right: 8, left: -4, bottom: 0 }} barCategoryGap={phone ? "10%" : BAR_CATEGORY_GAP}>
          <CartesianGrid {...gridProps(ct)} />
          <XAxis dataKey="d" {...axisX(ct, phone ? { minTickGap: 20 } : {})} />
          <YAxis {...axisY(ct, { width: phone ? 40 : 52 })} tickFormatter={(v) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
          <Tooltip content={<ChartTooltip valueFormatter={(v, e) => (e?.dataKey === "revenue" ? money(v) : num(v))} labelFormatter={barLabel} />} cursor={{ fill: ct.cursor }} />
          <defs><ChartGradient id="mbRevDay" color={CHART_COLORS.brand} from={0.95} to={0.45} /></defs>
          <Bar dataKey="revenue" name="Revenue" fill="url(#mbRevDay)" radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/**
 * Plan composition for the window. Stacked vertically (donut over legend)
 * rather than side by side, because it now lives in the narrow column beside
 * the revenue trend.
 */
export function RevenuePlanMix({ state, limit = 6, className }) {
  const phone = usePhone();
  const byPlan = state.data?.byPlan || [];
  const planTotal = useMemo(() => byPlan.reduce((a, p) => a + p.revenue, 0), [byPlan]);

  if (isCold(state)) return <SkeletonCard height="h-[400px]" className={className} />;

  return (
    <Panel title="Revenue by plan" subtitle={rangeLabel(state.month)} icon={<Ticket size={15} />} tone="violet" className={className}>
      {byPlan.length === 0 ? (
        <EmptyState className="max-sm:py-8" icon={phone ? null : Ticket} title="No sales in this window" />
      ) : (
        <>
          {/* A phone gets the ranking rather than the ring: at 375px a donut
              plus a legend is 300px tall, a single-plan window draws a circle
              that measures nothing, and the share each plan earned is easier to
              compare along one edge than around a curve. */}
          <div className="sm:hidden">
            <ChartStat
              value={money(planTotal)}
              unit="total"
              caption={`Across ${num(byPlan.length)} plan${byPlan.length === 1 ? "" : "s"}`}
            />
            <div className="-mt-1 divide-y divide-[var(--border-subtle)]">
              {byPlan.slice(0, limit).map((p, i) => (
                <PhoneBarRow
                  key={p.name}
                  inset={false}
                  label={p.name}
                  value={money(p.revenue)}
                  amount={p.revenue}
                  total={planTotal}
                  color={CHART_SERIES[i % CHART_SERIES.length]}
                  sub={
                    <PhoneFacts
                      items={[{ v: `${planTotal ? Math.round((p.revenue / planTotal) * 100) : 0}%`, l: "of revenue" }]}
                    />
                  }
                />
              ))}
            </div>
          </div>

          <div className="max-sm:hidden!">
            <div className="relative mx-auto" style={{ width: 196, height: 196 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byPlan} dataKey="revenue" nameKey="name" {...DONUT} isAnimationActive={false}>
                    {byPlan.map((_, i) => <Cell key={i} fill={CHART_SERIES[i % CHART_SERIES.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip hideLabel valueFormatter={money} />} />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenter value={money(planTotal)} label="Total" />
            </div>
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] space-y-2.5">
              {byPlan.slice(0, limit).map((p, i) => (
                <LegendRow
                  key={p.name}
                  color={CHART_SERIES[i % CHART_SERIES.length]}
                  label={p.name}
                  value={money(p.revenue)}
                  amount={p.revenue}
                  total={planTotal}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────── Sales analysis ───────────────────────── */

/**
 * The window's headline totals. Demoted from the page's KPI rail — the rail
 * now carries only four figures — but kept in full here.
 */
export function SalesTotals({ state }) {
  const phone = usePhone();
  const t = state.data?.totals || {};
  if (isCold(state)) return <SkeletonKpis count={4} />;
  return (
    <KpiGrid cols={4}>
      {/* Both dashboards carry revenue and vouchers sold in the rail at the top
          of the page. On a laptop that rail is a screen away; on a phone you
          scrolled past it to get here, so these two would be the same two
          figures twice in a row. The tab keeps what the rail does not say. */}
      <StatCard className="max-sm:hidden!" label="Revenue" value={money(t.revenue)} icon={<DollarSign size={18} />} color="accent" sub={`${num(t.transactions)} paid transactions`} />
      <StatCard className="max-sm:hidden!" label="Vouchers sold" value={num(t.sold)} icon={<Ticket size={18} />} color="blue" sub={`${num(t.customers)} customers`} />
      {/* Paired with "Got online" on the two-up phone grid, a tile with no sub
          line was stretched to its neighbour's height and carried ~40px of
          nothing — and sized to its content instead, the pair went ragged. On
          a phone it states what the average is over, which is also the count
          the hidden Revenue tile carried. Desktop keeps it sub-less. */}
      <StatCard
        label="Average sale"
        value={money(t.avgSale)}
        icon={<BarChart3 size={18} />}
        color="violet"
        sub={phone ? `over ${num(t.transactions)} sales` : undefined}
      />
      <StatCard
        label="Got online"
        value={`${t.connectedPct ?? 0}%`}
        icon={<Wifi size={18} />}
        color={(t.connectedPct ?? 0) >= 95 ? "emerald" : (t.connectedPct ?? 0) >= 80 ? "amber" : "rose"}
        sub={`${num(t.connected)} of ${num(t.transactions)}`}
      />
    </KpiGrid>
  );
}

/**
 * Money that did not turn into a connection. Renders nothing when every sale
 * connected — an all-zero row of alarm tiles is worse than no row.
 */
export function RiskTotals({ state }) {
  const phone = usePhone();
  const t = state.data?.totals || {};
  const byHour = state.data?.byHour || [];
  const busiestHour = useMemo(
    () => byHour.reduce((best, h) => (h.count > (best?.count ?? -1) ? h : best), null),
    [byHour]
  );
  if (isCold(state)) return <SkeletonKpis count={4} />;
  if (!(t.manualCases > 0 || t.paidNoVoucher > 0 || t.revenueAtRisk > 0)) return null;
  return (
    <KpiGrid cols={4}>
      <StatCard label="Needed help" value={num(t.manualCases)} icon={<AlertTriangle size={18} />} color="amber" sub="paid, auth failed" />
      {/* A phone-only sub, so the two-up pair matches height; see SalesTotals. */}
      <StatCard
        label="Paid, no voucher"
        value={num(t.paidNoVoucher)}
        icon={<Ticket size={18} />}
        color={t.paidNoVoucher ? "rose" : "slate"}
        sub={phone ? `of ${num(t.transactions)} paid` : undefined}
      />
      <StatCard label="Revenue at risk" value={money(t.revenueAtRisk)} icon={<DollarSign size={18} />} color={t.revenueAtRisk ? "rose" : "slate"} sub="never connected" />
      <StatCard label="Busiest hour" value={busiestHour ? `${busiestHour.h}:00` : "—"} icon={<Clock size={18} />} color="cyan" sub={busiestHour ? `${num(busiestHour.count)} sales` : phone ? "no sales" : ""} />
    </KpiGrid>
  );
}

export function SalesByHourPanel({ state, className }) {
  const ct = useChartTheme();
  const byHour = state.data?.byHour || [];
  const busiest = useMemo(
    () => byHour.reduce((best, h) => (h.count > (best?.count ?? -1) ? h : best), null),
    [byHour]
  );
  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;
  return (
    <Panel title="Sales by hour" subtitle="When customers buy" icon={<Clock size={15} />} tone="violet" className={className}>
      <ChartStat
        value={busiest ? `${busiest.h}:00` : "—"}
        unit="busiest"
        caption={busiest ? `${num(busiest.count)} sales in that hour` : "No sales in this window"}
      />
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
  );
}

/** Units sold per plan, straight from the claim ledger. */
export function SoldByPlanPanel({ state, className }) {
  const ct = useChartTheme();
  const phone = usePhone();
  const soldByPlan = state.data?.soldByPlan || [];
  const total = useMemo(() => soldByPlan.reduce((a, p) => a + Number(p.sold || 0), 0), [soldByPlan]);
  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;
  return (
    <Panel title="Vouchers sold by plan" subtitle="From the claim ledger" icon={<Ticket size={15} />} tone="blue" className={className}>
      {soldByPlan.length === 0 ? (
        <EmptyState className="max-sm:py-8" icon={phone ? null : Ticket} title="No vouchers claimed in this window" />
      ) : (
        <>
          <ChartStat value={num(total)} unit="sold" caption={`Across ${num(soldByPlan.length)} plan${soldByPlan.length === 1 ? "" : "s"}`} />
          {/* The category axis is 104px of a 375px screen, which leaves a plan
              name clipped and its bar too short to compare. The same ranking
              reads whole as rows. */}
          {phone ? (
            <div className="-mt-1 divide-y divide-[var(--border-subtle)]">
              {soldByPlan.map((p) => (
                <PhoneBarRow
                  key={p.name}
                  inset={false}
                  label={p.name}
                  value={num(p.sold)}
                  amount={Number(p.sold || 0)}
                  total={total}
                  color={CHART_COLORS.blue}
                />
              ))}
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={232}>
            <BarChart data={soldByPlan} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
              <CartesianGrid {...gridProps(ct)} horizontal={false} vertical />
              <XAxis type="number" {...axisX(ct)} allowDecimals={false} />
              <YAxis type="category" dataKey="name" {...axisY(ct, { width: 104 })} />
              <Tooltip content={<ChartTooltip valueFormatter={num} />} cursor={{ fill: ct.cursor }} />
              <Bar dataKey="sold" name="Sold" fill={CHART_COLORS.blue} radius={[0, 6, 6, 0]} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * Plans purchased in the window, as an auditable list.
 *
 * The bar chart beside it answers "which plan sells"; this answers "what
 * exactly was bought, and can I go and look at it". Each row carries the data
 * those sales issued — summed from the real quota on the vouchers the
 * transactions handed out, not from the plan's display text — and opens the
 * voucher list filtered to that plan.
 *
 * `onOpenPlan` is what makes it a drill rather than a read: without somewhere
 * to go, a number a customer disputes is a dead end.
 */
export function PlansPurchasedPanel({ state, onOpenPlan, className }) {
  const phone = usePhone();
  const byPlan = state.data?.byPlan || [];
  const [showAll, setShowAll] = useState(false);
  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;

  const totalMb = byPlan.reduce((a, p) => a + Number(p.purchasedMb || 0), 0);
  // Denominator for the phone list's share bars.
  const planRevenue = byPlan.reduce((a, p) => a + Number(p.revenue || 0), 0);
  const gb = (mb) => {
    const v = Number(mb || 0) / 1024;
    return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  };
  // A plan whose vouchers we could not price in data is reported rather than
  // silently counted as zero — otherwise the column would understate the
  // month and nobody would know why.
  const unpriced = byPlan.reduce((a, p) => a + (Number(p.count || 0) - Number(p.withQuota || 0)), 0);

  return (
    <Panel
      title="Plans purchased"
      subtitle={`${num(byPlan.reduce((a, p) => a + Number(p.count || 0), 0))} sale(s) · ${gb(totalMb)} GB issued · ${rangeLabel(state.month)}`}
      icon={<Ticket size={15} />}
      tone="violet"
      padding={false}
      className={className}
    >
      {byPlan.length === 0 ? (
        <div className="p-5">
          <EmptyState
            className="max-sm:py-8"
            icon={phone ? null : Ticket}
            title="No plans purchased in this window"
            description="Nothing was sold here in the selected period. Widen the window to see earlier sales."
          />
        </div>
      ) : (
        <>
          {/* A phone reads this as a list of plans: what each earned, a bar for
              its share of the window, and the sale and data figures underneath
              in a line rather than as four labelled tiles. */}
          <PhoneList>
            {byPlan.slice(0, showAll ? undefined : PHONE_ROWS).map((p) => (
              <PhoneBarRow
                key={p.name}
                label={p.name}
                value={money(p.revenue)}
                amount={Number(p.revenue || 0)}
                total={planRevenue}
                color={CHART_COLORS.violet}
                onClick={onOpenPlan ? () => onOpenPlan(p) : undefined}
                title={onOpenPlan ? `Open the ${p.name} vouchers` : undefined}
                sub={
                  <PhoneFacts
                    items={[
                      { v: num(p.count), l: `sold` },
                      { v: `${gb(p.purchasedMb)} GB`, l: "issued" },
                      // Zero used across sold vouchers is usually the gateway
                      // not reporting flow rather than nobody connecting, so it
                      // is left off rather than printed as a confident 0.
                      p.usedMb ? { v: `${gb(p.usedMb)} GB`, l: "used" } : null,
                    ]}
                  />
                }
              />
            ))}
          </PhoneList>
          <DataTable maxHeight={320} className="max-sm:hidden!">
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th align="right">Sold</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Issued GB</Th>
                <Th align="right">Used GB</Th>
              </tr>
            </thead>
            <tbody>
              {byPlan.map((p) => (
                <tr
                  key={p.name}
                  onClick={onOpenPlan ? () => onOpenPlan(p) : undefined}
                  className={onOpenPlan ? "cursor-pointer" : ""}
                  title={onOpenPlan ? `Open the ${p.name} vouchers` : undefined}
                >
                  <Td strong>{p.name}</Td>
                  <Td align="right" className="tabular-nums">{num(p.count)}</Td>
                  <Td align="right" strong className="tabular-nums">{money(p.revenue)}</Td>
                  <Td align="right" className="tabular-nums">{gb(p.purchasedMb)}</Td>
                  <Td align="right" className="tabular-nums">
                    {p.usedMb ? gb(p.usedMb) : <span className="text-[var(--fg-subtle)]">—</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <PhoneMore total={byPlan.length} expanded={showAll} onToggle={() => setShowAll((v) => !v)} noun="plans" />
          {unpriced > 0 && (
            <p className="px-5 py-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--fg-muted)]">
              {num(unpriced)} sale{unpriced === 1 ? "" : "s"} could not be matched to a voucher, so their
              data is not counted above — usually a payment that never got one.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** Revenue per village — only meaningful across villages, so the estate scope only. */
export function RevenueByVillagePanel({ state, className }) {
  const ct = useChartTheme();
  const phone = usePhone();
  const byVillage = state.data?.byVillage || [];
  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;
  return (
    <Panel title="Revenue by village" subtitle="Top 8 for the window" icon={<MapPin size={15} />} tone="navy" className={className}>
      {byVillage.length === 0 ? (
        <EmptyState className="max-sm:py-8" icon={phone ? null : MapPin} title="No sales in this window" />
      ) : (
        <ResponsiveContainer width="100%" height={288}>
          <BarChart data={byVillage.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={BAR_CATEGORY_GAP}>
            <CartesianGrid {...gridProps(ct)} horizontal={false} vertical />
            <XAxis type="number" {...axisX(ct)} tickFormatter={(v) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <YAxis type="category" dataKey="name" {...axisY(ct, { width: 104 })} />
            <Tooltip content={<ChartTooltip valueFormatter={money} />} cursor={{ fill: ct.cursor }} />
            <defs><ChartGradient id="mbRevVillage" color={CHART_COLORS.brand} from={0.95} to={0.45} /></defs>
            <Bar dataKey="revenue" name="Revenue" fill="url(#mbRevVillage)" radius={BAR_RADIUS} maxBarSize={BAR_MAX_SIZE} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/** Every recorded event in the window, successes and failures alike. */
export function OutcomesPanel({ state, className }) {
  const phone = usePhone();
  const outcomes = state.data?.outcomes || [];
  const windowLabel = rangeLabel(state.month);
  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;
  return (
    <Panel title="What happened" subtitle={`Every recorded event · ${windowLabel}`} icon={<Users size={15} />} tone="slate" className={className}>
      {outcomes.length === 0 ? (
        <EmptyState className="max-sm:py-8" icon={phone ? null : Users} title="No activity in this window" />
      ) : (
        // A scroll box inside a scrolling page is a trap for a thumb, and this
        // list is twelve rows at most — on a phone it simply flows.
        <div className="space-y-2.5 max-h-[288px] overflow-y-auto scrollbar-none pr-1 max-sm:max-h-none max-sm:overflow-visible">
          {outcomes.slice(0, 12).map((o) => (
            <LegendRow
              key={o.type}
              color={outcomeTone(o.type)}
              label={outcomeLabel(o.type)}
              value={num(o.count)}
              amount={o.count}
              total={outcomes[0]?.count || 0}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** The by-village numbers read exactly, rather than estimated off a bar. */
export function VillageRevenuePanel({ state, className }) {
  const phone = usePhone();
  const byVillage = state.data?.byVillage || [];
  const windowLabel = rangeLabel(state.month);
  const villageTotal = useMemo(() => byVillage.reduce((a, v) => a + v.revenue, 0), [byVillage]);
  const [showAll, setShowAll] = useState(false);

  if (isCold(state)) return <SkeletonCard height="h-80" className={className} />;
  return (
    <Panel
      title="Village revenue detail"
      subtitle={`${byVillage.length} village${byVillage.length === 1 ? "" : "s"} with sales · ${windowLabel}`}
      icon={<MapPin size={15} />}
      tone="navy"
      padding={false}
      className={className}
    >
      {/* Every village with sales, scrolled in its own box rather than run out
          down the page. Rows here are single-line (~39px) over a 35px header,
          so 320px shows seven and clips the eighth as the cue that there is
          more. Max-height, so a window with only three villages shrinks to fit
          instead of leaving them stranded in an empty well. */}
      {byVillage.length === 0 ? (
        <div className="p-5"><EmptyState className="max-sm:py-8" icon={phone ? null : MapPin} title="No sales in this window" /></div>
      ) : (
        <>
        {/* A phone reads the ranking, not the grid: village, what it earned, a
            bar for its share of the estate, and the two figures that explain
            the number underneath. The bar chart above this panel is hidden on a
            phone for the same reason — this list already is that chart. */}
        <PhoneList>
          {byVillage.slice(0, showAll ? undefined : PHONE_ROWS).map((v) => (
            <PhoneBarRow
              key={v.name}
              label={v.name}
              value={money(v.revenue)}
              amount={v.revenue}
              total={villageTotal}
              sub={
                <PhoneFacts
                  items={[
                    { v: num(v.count), l: `sale${v.count === 1 ? "" : "s"}` },
                    { v: money(v.count ? v.revenue / v.count : 0), l: "avg" },
                    { v: `${villageTotal ? Math.round((v.revenue / villageTotal) * 100) : 0}%`, l: "of revenue" },
                  ]}
                />
              }
            />
          ))}
        </PhoneList>
        <DataTable maxHeight={320} className="max-sm:hidden!">
          <thead>
            <tr>
              <Th>Village</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Transactions</Th>
              <Th align="right">Avg sale</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {/* No phone classes: below 640px this table is not on screen —
                PhoneList above is. */}
            {byVillage.map((v) => (
              <tr key={v.name}>
                <Td strong>{v.name}</Td>
                <Td align="right" strong className="tabular-nums">{money(v.revenue)}</Td>
                <Td align="right" className="tabular-nums">{num(v.count)}</Td>
                <Td align="right" className="tabular-nums">{money(v.count ? v.revenue / v.count : 0)}</Td>
                <Td align="right">
                  <Badge tone="neutral">{villageTotal ? Math.round((v.revenue / villageTotal) * 100) : 0}%</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        </>
      )}
      <PhoneMore total={byVillage.length} expanded={showAll} onToggle={() => setShowAll((v) => !v)} noun="villages" />
    </Panel>
  );
}

/* ───────────────────────── Full section ─────────────────────────
 * The original stacked layout, preserved for any caller that wants the whole
 * sales section in one drop-in. The dashboards compose the panels above
 * instead, so the same numbers are not printed twice on one screen. */

export default function MonthlyBreakdown({ state, groupId = null }) {
  const activeGroupId = groupId;

  if (isCold(state)) {
    return (
      <div className="space-y-6">
        <SkeletonKpis count={4} />
        <SkeletonCard height="h-80" />
      </div>
    );
  }
  if (!hasSalesHistory(state)) return <BreakdownEmpty />;

  return (
    <div className="space-y-6">
      <SalesTotals state={state} />
      <RiskTotals state={state} />
      <RevenueTrendPanel state={state} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenuePlanMix state={state} />
        <SoldByPlanPanel state={state} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SalesByHourPanel state={state} />
        {!activeGroupId && <RevenueByVillagePanel state={state} />}
        <OutcomesPanel state={state} />
      </div>

      {!activeGroupId && <VillageRevenuePanel state={state} />}
    </div>
  );
}
