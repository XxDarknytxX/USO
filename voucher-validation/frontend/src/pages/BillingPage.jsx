// src/pages/BillingPage.jsx
//
// Monthly billing: every village's revenue for one calendar month against the
// per-village target. Two lists, because they are two different conversations —
// the villages SHORT of the target and by how much, and the villages bringing in
// ADDITIONAL revenue and how much.
//
// The numbers are the dashboard's numbers (same sales, same village attribution)
// summed in cents on the server; this page only lays them out. It opens on the
// last COMPLETE month, because a month still in progress reads almost every
// village as short.

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Receipt, TrendingDown, TrendingUp, Scale, Wallet, Download, Pencil, Check, X,
  AlertTriangle, MapPin, Info,
} from "lucide-react";

import { billingApi } from "../services/api";
import {
  PageShell, PageHeader, Panel, KpiGrid, StatCard, Select, Button, Input,
  DataTable, Th, Td, EmptyState, SkeletonKpis, SkeletonCard,
} from "../components/ui";

const money = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));

/** A thin bar showing how far a village got toward its target. */
function Progress({ pct, tone }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-[var(--surface-pressed)]">
      <span
        className="block h-full rounded-full"
        style={{ width: `${w}%`, background: tone === "danger" ? "var(--danger-fg)" : "var(--success-fg)" }}
      />
    </span>
  );
}

function VillageCell({ name, hostname }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] font-semibold text-[var(--fg-primary)]">{name}</span>
      {hostname && <span className="truncate font-mono text-[11px] text-[var(--fg-muted)]">{hostname}</span>}
    </span>
  );
}

/** The target, shown and — for the admin who owns it — edited in place. */
function TargetControl({ target, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(target));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(String(target)), [target]);

  async function save() {
    setBusy(true);
    try {
      const r = await billingApi.setTarget(value);
      toast.success(`Target set to ${money(r.target)} per village per month`);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
        Target
        <span className="font-semibold tabular-nums text-[var(--fg-primary)]">{money(target)}</span>
        <span className="text-[var(--fg-muted)]">per village / month</span>
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)} iconLeft={<Pencil size={11} />}>
          Change
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[12.5px] text-[var(--fg-secondary)]">Target $</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        inputMode="decimal"
        autoFocus
        className="h-8 w-24 tabular-nums"
      />
      <Button variant="primary" size="xs" onClick={save} loading={busy} iconLeft={<Check size={11} />}>Save</Button>
      <Button variant="ghost" size="xs" onClick={() => setEditing(false)} disabled={busy} iconLeft={<X size={11} />}>Cancel</Button>
    </span>
  );
}

export default function BillingPage() {
  const [month, setMonth] = useState(""); // "" = let the server choose the last complete month
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await billingApi.get(month ? { month } : {});
      setData(r);
      if (!month) setMonth(r.month);
    } catch (e) {
      toast.error("Could not load billing: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const monthLabel = useMemo(
    () => data?.months?.find((m) => m.key === data?.month)?.label || data?.month || "",
    [data]
  );

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Month", "Village", "Hostname", "Revenue", "Target", "Short by", "Additional", "Position"],
      ...[...data.under, ...data.over].map((r) => [
        data.month, r.name, r.hostname || "", r.revenue.toFixed(2), Number(data.target).toFixed(2),
        r.deficit.toFixed(2), r.excess.toFixed(2), r.deficit > 0 ? "Below target" : "At or above target",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `uso-billing-${data.month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const t = data?.totals;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Billing"
        subtitle={
          data
            ? `${monthLabel} · each village's revenue against the ${money(data.target)} monthly target.`
            : "Each village's revenue against the monthly target."
        }
        icon={<Receipt size={22} />}
        tone="green"
        actions={
          <>
            <Select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="min-w-[170px]"
              aria-label="Billing month"
            >
              {(data?.months || []).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!data} iconLeft={<Download size={14} />}>
              Export CSV
            </Button>
          </>
        }
      />

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TargetControl target={data.target} onSaved={load} />
          {data.inProgress && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-1 text-[12px] font-medium text-[var(--warning-fg)]">
              <AlertTriangle size={12} />
              Month in progress — {data.daysElapsed} of {data.daysInMonth} days. Shortfalls will shrink as it fills in.
            </span>
          )}
        </div>
      )}

      {loading && !data ? (
        <>
          <SkeletonKpis count={4} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SkeletonCard height="h-[420px]" />
            <SkeletonCard height="h-[420px]" />
          </div>
        </>
      ) : !data ? null : (
        <>
          <KpiGrid>
            <StatCard
              label="Below target"
              value={t.underCount}
              sub={t.underCount ? `${money(t.deficit)} short in total` : "no village is short"}
              icon={<TrendingDown size={18} />}
              color={t.underCount ? "red" : "green"}
            />
            <StatCard
              label="At or above target"
              value={t.overCount}
              sub={`${money(t.excess)} additional revenue`}
              icon={<TrendingUp size={18} />}
              color="green"
            />
            <StatCard
              label="Net position"
              value={signed(t.net)}
              sub="additional revenue less the shortfall"
              icon={<Scale size={18} />}
              color={t.net >= 0 ? "green" : "orange"}
            />
            <StatCard
              label="Revenue billed"
              value={money(t.revenue)}
              sub={`against ${money(t.targetTotal)} across ${t.villages} village${t.villages === 1 ? "" : "s"}`}
              icon={<Wallet size={18} />}
              color="navy"
            />
          </KpiGrid>

          {/* The two lists side by side, each scrolling within itself so the
              page stays one screen however many villages there are. */}
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <Panel
              title="Below target"
              subtitle={`Villages under ${money(data.target)} for ${monthLabel}, and how far short.`}
              icon={<TrendingDown size={15} />}
              tone="red"
              padding={false}
            >
              {data.under.length === 0 ? (
                <EmptyState icon={Check} title="Every village met its target" description={`Nothing is short for ${monthLabel}.`} />
              ) : (
                <>
                  <div className="max-h-[520px] overflow-y-auto">
                    <DataTable>
                      <thead>
                        <tr>
                          <Th>Village</Th>
                          <Th align="right">Revenue</Th>
                          <Th align="right">Short by</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.under.map((r) => (
                          <tr key={r.projectId}>
                            <Td>
                              <span className="flex min-w-0 flex-col gap-1.5">
                                <VillageCell name={r.name} hostname={r.hostname} />
                                <Progress pct={r.pctOfTarget} tone="danger" />
                              </span>
                            </Td>
                            <Td align="right" nowrap className="tabular-nums">
                              <span className="flex flex-col items-end">
                                <span>{money(r.revenue)}</span>
                                <span className="text-[11px] text-[var(--fg-muted)]">{r.pctOfTarget}% of target</span>
                              </span>
                            </Td>
                            <Td align="right" nowrap>
                              <span className="font-semibold tabular-nums text-[var(--danger-fg)]">−{money(r.deficit)}</span>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3 text-[12.5px]">
                    <span className="text-[var(--fg-muted)]">
                      {data.under.length} village{data.under.length === 1 ? "" : "s"} short
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--danger-fg)]">−{money(t.deficit)}</span>
                  </div>
                </>
              )}
            </Panel>

            <Panel
              title="Additional revenue"
              subtitle={`Villages at or above ${money(data.target)} for ${monthLabel}, and what they brought in over it.`}
              icon={<TrendingUp size={15} />}
              tone="green"
              padding={false}
            >
              {data.over.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No village reached its target" description={`Nothing above target for ${monthLabel}.`} />
              ) : (
                <>
                  <div className="max-h-[520px] overflow-y-auto">
                    <DataTable>
                      <thead>
                        <tr>
                          <Th>Village</Th>
                          <Th align="right">Revenue</Th>
                          <Th align="right">Additional</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.over.map((r) => (
                          <tr key={r.projectId}>
                            <Td><VillageCell name={r.name} hostname={r.hostname} /></Td>
                            <Td align="right" nowrap className="tabular-nums">
                              <span className="flex flex-col items-end">
                                <span>{money(r.revenue)}</span>
                                <span className="text-[11px] text-[var(--fg-muted)]">{r.pctOfTarget}% of target</span>
                              </span>
                            </Td>
                            <Td align="right" nowrap>
                              <span className="font-semibold tabular-nums text-[var(--success-fg)]">
                                {r.excess > 0 ? `+${money(r.excess)}` : money(0)}
                              </span>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3 text-[12.5px]">
                    <span className="text-[var(--fg-muted)]">
                      {data.over.length} village{data.over.length === 1 ? "" : "s"} at or above target
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--success-fg)]">+{money(t.excess)}</span>
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* Everything the two lists do NOT include, so the figures above can be
              reconciled against the dashboard instead of just trusted. */}
          {(data.noGroup.length > 0 || t.unattributed.revenue > 0 || t.outsideEstate.revenue > 0) && (
            <Panel title="Not in these figures" subtitle="So the totals above reconcile with the dashboard." icon={<Info size={15} />} tone="slate">
              <ul className="flex flex-col gap-2.5 text-[12.5px] text-[var(--fg-secondary)]">
                {data.noGroup.length > 0 && (
                  <li className="flex items-start gap-2">
                    <MapPin size={13} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
                    <span>
                      <span className="font-medium text-[var(--fg-primary)]">
                        {data.noGroup.map((v) => v.name).join(", ")}
                      </span>{" "}
                      {data.noGroup.length === 1 ? "has" : "have"} no Ruijie group, so no sale can be attributed to{" "}
                      {data.noGroup.length === 1 ? "it" : "them"}. Left out rather than billed a full shortfall that
                      might not be real — add the group under Network.
                    </span>
                  </li>
                )}
                {t.unattributed.revenue > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
                    <span>
                      <span className="font-medium tabular-nums text-[var(--fg-primary)]">{money(t.unattributed.revenue)}</span>{" "}
                      from {t.unattributed.transactions} sale{t.unattributed.transactions === 1 ? "" : "s"} could not be
                      matched to any village — usually a plan with no village set in Portal Plans.
                    </span>
                  </li>
                )}
                {t.outsideEstate.revenue > 0 && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
                    <span>
                      <span className="font-medium tabular-nums text-[var(--fg-primary)]">{money(t.outsideEstate.revenue)}</span>{" "}
                      came from villages outside the estate default (test villages, for example), which are not billed.
                    </span>
                  </li>
                )}
              </ul>
            </Panel>
          )}
        </>
      )}
    </PageShell>
  );
}
