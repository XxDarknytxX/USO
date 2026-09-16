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
//
// WHICH villages: the estate default (Settings → Estate default), for everyone
// who opens this page — never the reader's own "Your view". The page says so in
// a scope strip, names what was left out and why, and tells an administrator
// when their own view differs from what was billed. It used to say nothing, so
// a personal filter on the Dashboard read as the bill "ignoring" the estate
// default when the default had simply never been saved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Receipt, TrendingDown, TrendingUp, Scale, Wallet, Download, Pencil, Check, X,
  AlertTriangle, MapPin, Info, Globe2, ChevronDown, Eye, Link2,
} from "lucide-react";

import { billingApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import {
  PageShell, PageHeader, Panel, KpiGrid, StatCard, Select, Button, Input,
  DataTable, Th, Td, EmptyState, SkeletonKpis, SkeletonCard,
} from "../components/ui";

const money = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

// Why a village is not on the bill, in words. The server sends the reason.
const REASONS = {
  not_in_estate_default: "not in the estate default",
  inactive: "switched off under Network",
  no_ruijie_group: "no Ruijie group",
  shared_group: "shares a Ruijie group",
};

const joinNames = (names, max = 6) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

/**
 * What this bill covers, stated rather than implied. One line in the normal
 * case; a callout when the estate default was never saved or cannot be read,
 * because then "every village" is not a decision anybody made.
 */
function ScopeStrip({ data, isAdmin }) {
  const navigate = useNavigate();
  const { sites, visibleSiteIds, followEstateDefault } = useSite();
  const [open, setOpen] = useState(false);
  const scope = data.scope;
  if (!scope) return null;

  const billed = new Set(scope.billedIds.map(Number));
  const excluded = scope.excluded || [];
  const count = scope.billedCount;
  // Villages the estate default takes in, whether or not they could be billed.
  // "Every active village (N)" must count the villages, not the billable ones:
  // a village with no group, or sharing one, is still in the estate.
  const inEstate = count + excluded.filter((x) => x.reason === "no_ruijie_group" || x.reason === "shared_group").length;
  const unbillable = inEstate - count;
  const billedNote = unbillable > 0 ? `, ${count} of them billable` : "";
  const nameOf = (id) => sites.find((s) => Number(s.id) === Number(id))?.name || `#${id}`;
  const saved = scope.setAt ? ` · saved ${fmtDate(scope.setAt)}${scope.setBy ? ` by ${scope.setBy}` : ""}` : "";

  // The reader's OWN view, when they have one. The bill does not follow it;
  // this only makes the difference impossible to miss.
  const personal = Array.isArray(visibleSiteIds) ? new Set(visibleSiteIds.map(Number)) : null;
  const hiddenButBilled = personal ? [...billed].filter((id) => !personal.has(id)) : [];
  const shownNotBilled = personal
    ? excluded.filter((x) => x.reason === "not_in_estate_default" && personal.has(Number(x.projectId)))
    : [];

  const byReason = excluded.reduce((m, x) => ((m[x.reason] ||= []).push(x), m), {});

  let headline;
  let tone = "neutral";
  if (scope.mode === "unset") {
    tone = isAdmin ? "warning" : "neutral";
    headline = isAdmin
      ? `No estate default has been saved, so this covers every active village (${inEstate}${billedNote}) — test villages included, and any village added later.`
      : `Every active village (${inEstate}${billedNote}).`;
  } else if (scope.mode === "unreadable") {
    tone = isAdmin ? "danger" : "neutral";
    headline = isAdmin
      ? `The saved estate default could not be read, so this covers every active village (${inEstate}${billedNote}). Save it again under Settings.`
      : `Every active village (${inEstate}${billedNote}).`;
  } else if (scope.mode === "none") {
    tone = "warning";
    headline = "The estate default has no villages in it, so nothing is billed.";
  } else if (scope.mode === "all") {
    headline = `Estate default · every active village (${inEstate}${billedNote}), including any added later${saved}`;
  } else {
    headline = `Estate default · ${inEstate} village${inEstate === 1 ? "" : "s"}${billedNote}${saved}`;
  }

  const toneClass = {
    neutral: "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--fg-secondary)]",
    warning: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-fg)]",
    danger: "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-fg)]",
  }[tone];

  return (
    <div className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-[12.5px] ${toneClass}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 items-start gap-2">
          {tone === "neutral" ? (
            <Globe2 size={14} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
          ) : (
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          )}
          <span className={tone === "neutral" ? "text-[var(--fg-primary)]" : "font-medium"}>{headline}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {excluded.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setOpen((v) => !v)}
              iconRight={<ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />}
            >
              {excluded.length} not billed
            </Button>
          )}
          {isAdmin && (
            <Button variant={tone === "neutral" ? "ghost" : "secondary"} size="xs" onClick={() => navigate("/settings")}>
              {scope.mode === "unset" ? "Set the estate default" : "Estate default settings"}
            </Button>
          )}
        </span>
      </div>

      {open && excluded.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2 text-[12px] text-[var(--fg-secondary)]">
          {Object.entries(byReason).map(([reason, list]) => (
            <li key={reason} className="flex flex-wrap gap-x-1.5">
              <span className="font-medium text-[var(--fg-primary)]">{REASONS[reason] || reason}:</span>
              <span>{joinNames(list.map((x) => x.name), 12)}</span>
            </li>
          ))}
        </ul>
      )}

      {(hiddenButBilled.length > 0 || shownNotBilled.length > 0) && (
        <div className="flex flex-wrap items-start gap-2 border-t border-[var(--border-subtle)] pt-2 text-[12px] text-[var(--fg-secondary)]">
          <Eye size={13} className="mt-0.5 shrink-0 text-[var(--info-fg)]" />
          <span className="min-w-0 flex-1">
            Your own view differs from this bill, which always uses the estate default.
            {hiddenButBilled.length > 0 && (
              <>
                {" "}It hides{" "}
                <span className="font-medium text-[var(--fg-primary)]">{joinNames(hiddenButBilled.map(nameOf))}</span>
                {hiddenButBilled.length === 1 ? ", which is" : ", which are"} billed here.
              </>
            )}
            {shownNotBilled.length > 0 && (
              <>
                {" "}It shows{" "}
                <span className="font-medium text-[var(--fg-primary)]">{joinNames(shownNotBilled.map((x) => x.name))}</span>
                {shownNotBilled.length === 1 ? ", which is" : ", which are"} not in the estate default and not billed.
              </>
            )}
          </span>
          <Button variant="ghost" size="xs" onClick={followEstateDefault}>
            Follow the estate default
          </Button>
        </div>
      )}
    </div>
  );
}

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

/**
 * The target, shown to every reader and — for an admin — edited in place. A
 * billing account sees the number without the Change button: the server
 * refuses it the write, and a button that only ever errors is not an option.
 */
function TargetControl({ target, onSaved, canEdit }) {
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

  if (!editing || !canEdit) {
    return (
      <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
        Target
        <span className="font-semibold tabular-nums text-[var(--fg-primary)]">{money(target)}</span>
        <span className="text-[var(--fg-muted)]">per village / month</span>
        {canEdit && (
          <Button variant="ghost" size="xs" onClick={() => setEditing(true)} iconLeft={<Pencil size={11} />}>
            Change
          </Button>
        )}
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
  const { isAdmin } = useAuth();
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
    // What the bill covered, after the table so the header stays on the first
    // row for anything that imports the file. A CSV that travels on its own
    // should say which villages it is a bill for.
    const s = data.scope;
    if (s) {
      const modeText = {
        unset: "Estate default never saved: every active village",
        all: "Estate default: every active village",
        list: "Estate default",
        none: "Estate default: no villages",
        unreadable: "Estate default unreadable: every active village",
      }[s.mode] || "Estate default";
      rows.push([]);
      rows.push(["Scope", modeText, `${s.billedCount} villages billed`, s.setAt ? `saved ${fmtDate(s.setAt)}${s.setBy ? ` by ${s.setBy}` : ""}` : ""]);
      for (const x of s.excluded || []) rows.push(["Not billed", x.name, x.hostname || "", REASONS[x.reason] || x.reason]);
    }
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
  const shared = (data?.scope?.excluded || []).filter((x) => x.reason === "shared_group");

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
          <TargetControl target={data.target} onSaved={load} canEdit={isAdmin} />
          {data.inProgress && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-1 text-[12px] font-medium text-[var(--warning-fg)]">
              <AlertTriangle size={12} />
              Month in progress — {data.daysElapsed} of {data.daysInMonth} days. Shortfalls will shrink as it fills in.
            </span>
          )}
        </div>
      )}

      {data && <ScopeStrip data={data} isAdmin={isAdmin} />}

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
          {(data.noGroup.length > 0 || shared.length > 0 || t.unattributed?.revenue > 0 || t.outsideEstate?.revenue > 0) && (
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
                      might not be real — {isAdmin ? "add the group under Network." : "an administrator needs to add the group."}
                    </span>
                  </li>
                )}
                {shared.length > 0 && (
                  <li className="flex items-start gap-2">
                    <Link2 size={13} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
                    <span>
                      <span className="font-medium text-[var(--fg-primary)]">{joinNames(shared.map((x) => x.name), 12)}</span>{" "}
                      share a Ruijie group with another village, so a sale cannot be told apart between them. Left out
                      rather than credit one village with another's revenue
                      {t.sharedGroup?.revenue > 0 && (
                        <>
                          {" "}(<span className="font-medium tabular-nums text-[var(--fg-primary)]">{money(t.sharedGroup.revenue)}</span>{" "}
                          from {t.sharedGroup.transactions} sale{t.sharedGroup.transactions === 1 ? "" : "s"})
                        </>
                      )}
                      {" "}— {isAdmin ? "give each village its own group under Network." : "an administrator needs to separate them."}
                    </span>
                  </li>
                )}
                {t.unattributed?.revenue > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
                    <span>
                      <span className="font-medium tabular-nums text-[var(--fg-primary)]">{money(t.unattributed.revenue)}</span>{" "}
                      from {t.unattributed.transactions} sale{t.unattributed.transactions === 1 ? "" : "s"} could not be
                      matched to any village — usually a plan with no village set in Portal Plans.
                    </span>
                  </li>
                )}
                {t.outsideEstate?.revenue > 0 && (
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
