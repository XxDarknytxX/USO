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
// WHICH villages: the same ones the reader's dashboards show — the village
// picked in the switcher, else their own "Your view", else the estate default
// (Settings → Estate default). The page resolves the first two from useSite, as
// the dashboards do, and sends them as ?villages=; with neither set it sends
// nothing and the server bills the estate default itself. A scope strip says
// which of the three was used and names what was left out and why.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePhone, PhoneMore, PHONE_ROWS } from "../components/ui/phone";

const money = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

// Why a village is not on the bill, in words. The server sends the reason.
const REASONS = {
  not_in_estate_default: "not in the estate default",
  not_in_view: "not in this view",
  inactive: "switched off under Network",
  no_ruijie_group: "no Ruijie group",
  shared_group: "shares a Ruijie group",
};

const joinNames = (names, max = 6) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

/**
 * Which villages this bill covers, stated rather than implied — and where that
 * came from, because the bill follows the reader's view the way the dashboards
 * do: the switcher's village, else "Your view", else the estate default.
 */
function ScopeStrip({ data, isAdmin, view, phone }) {
  const navigate = useNavigate();
  const { setActiveSiteId, followEstateDefault } = useSite();
  // null = nobody has touched it, so a phone opens the strip only when it is
  // carrying a warning; a desktop keeps the excluded list closed as before.
  const [openOverride, setOpenOverride] = useState(null);
  const scope = data.scope;
  if (!scope) return null;

  const excluded = scope.excluded || [];
  const count = scope.billedCount;
  // Villages in the view, whether or not they could be billed. "N villages"
  // must count the villages, not the billable ones: a village with no group,
  // or sharing one, is still in the view.
  const inView = count + excluded.filter((x) => x.reason === "no_ruijie_group" || x.reason === "shared_group").length;
  const unbillable = inView - count;
  const billedNote = unbillable > 0 ? `, ${count} of them billable` : "";
  const plural = (n) => `${n} village${n === 1 ? "" : "s"}`;
  const saved = scope.setAt ? ` · saved ${fmtDate(scope.setAt)}${scope.setBy ? ` by ${scope.setBy}` : ""}` : "";
  const estateText =
    scope.mode === "list" ? plural(scope.estateCount ?? 0)
    : scope.mode === "none" ? "no villages"
    : "every village";

  const byReason = excluded.reduce((m, x) => ((m[x.reason] ||= []).push(x), m), {});

  let icon = <Globe2 size={14} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />;
  let headline;
  // What the strip says on a phone before it is opened: which villages, in as
  // few words as the answer takes. The sentence itself is one tap away.
  let short;
  let sub = null;
  let tone = "neutral";
  const actions = [];

  if (view.kind === "village") {
    icon = <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />;
    headline = `${view.name || "One village"} only — the village selected in the switcher${billedNote}`;
    short = `${view.name || "One village"} only`;
    actions.push(
      <Button key="all" variant="ghost" size="xs" onClick={() => setActiveSiteId(null)}>
        Show all my villages
      </Button>
    );
  } else if (view.kind === "personal") {
    icon = <Eye size={14} className="mt-0.5 shrink-0 text-[var(--info-fg)]" />;
    headline = `Your view · ${plural(inView)}${billedNote}`;
    short = `Your view · ${plural(inView)}`;
    sub = `Accounts following the estate default see ${estateText}${saved}.`;
    if (isAdmin) {
      actions.push(
        <Button key="edit" variant="ghost" size="xs" onClick={() => navigate("/settings")}>
          Edit your view
        </Button>,
        <Button key="follow" variant="ghost" size="xs" onClick={followEstateDefault}>
          Use the estate default
        </Button>
      );
    }
  } else if (scope.mode === "unset") {
    tone = isAdmin ? "warning" : "neutral";
    headline = isAdmin
      ? `No estate default has been saved, so this covers every active village (${inView}${billedNote}) — test villages included, and any village added later.`
      : `Every active village (${inView}${billedNote}).`;
    short = isAdmin ? `No estate default saved · ${plural(inView)}` : `Every active village (${inView})`;
    if (isAdmin) actions.push(<Button key="set" variant="secondary" size="xs" onClick={() => navigate("/settings")}>Set the estate default</Button>);
  } else if (scope.mode === "unreadable") {
    tone = isAdmin ? "danger" : "neutral";
    headline = isAdmin
      ? `The saved estate default could not be read, so this covers every active village (${inView}${billedNote}). Save it again under Settings.`
      : `Every active village (${inView}${billedNote}).`;
    short = isAdmin ? `Estate default unreadable · ${plural(inView)}` : `Every active village (${inView})`;
    if (isAdmin) actions.push(<Button key="set" variant="secondary" size="xs" onClick={() => navigate("/settings")}>Estate default settings</Button>);
  } else if (scope.mode === "none") {
    tone = "warning";
    headline = "The estate default has no villages in it, so nothing is billed.";
    short = "Nothing is billed";
  } else {
    headline =
      scope.mode === "all"
        ? `Estate default · every active village (${inView}${billedNote}), including any added later${saved}`
        : `Estate default · ${plural(inView)}${billedNote}${saved}`;
    short = `Estate default · ${plural(inView)}`;
    if (isAdmin) actions.push(<Button key="set" variant="ghost" size="xs" onClick={() => navigate("/settings")}>Estate default settings</Button>);
  }

  if (tone !== "neutral") icon = <AlertTriangle size={14} className="mt-0.5 shrink-0" />;
  const toneClass = {
    neutral: "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--fg-secondary)]",
    warning: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-fg)]",
    danger: "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-fg)]",
  }[tone];
  const open = openOverride ?? (phone && tone !== "neutral");
  const setOpen = () => setOpenOverride(!open);

  // The same list in both layouts; the desktop one carries its own rule above
  // it, exactly as it always has, and the phone's sits in a padded panel.
  const excludedList = (className) => (
    <ul className={className}>
      {Object.entries(byReason).map(([reason, list]) => (
        <li key={reason} className="flex flex-wrap gap-x-1.5 max-sm:flex-col">
          <span className="font-medium text-[var(--fg-primary)]">{REASONS[reason] || reason}:</span>
          <span>{joinNames(list.map((x) => x.name), 12)}</span>
        </li>
      ))}
    </ul>
  );

  // A phone gets the answer on one line — which villages, and whether anything
  // was left out — and the sentence, the exclusions and the settings links
  // behind it. Three lines of provenance above the figures is a paragraph
  // nobody reads twice.
  if (phone) {
    return (
      <div className={`overflow-hidden rounded-xl border text-[12.5px] ${toneClass}`}>
        <button
          type="button"
          onClick={setOpen}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left"
        >
          {icon}
          <span className={`min-w-0 flex-1 ${tone === "neutral" ? "text-[var(--fg-primary)]" : "font-medium"}`}>
            {short || headline}
          </span>
          {excluded.length > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fg-muted)]">
              {excluded.length} not billed
            </span>
          )}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="flex flex-col gap-2.5 border-t border-[var(--border-subtle)] px-4 py-3">
            <span className={tone === "neutral" ? "text-[var(--fg-primary)]" : "font-medium"}>{headline}</span>
            {sub && <span className="text-[12px] text-[var(--fg-muted)]">{sub}</span>}
            {excluded.length > 0 && excludedList("flex flex-col gap-1 text-[12px] text-[var(--fg-secondary)]")}
            {actions.length > 0 && <span className="flex flex-wrap items-center gap-1.5">{actions}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-[12.5px] ${toneClass}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* On a phone the sentence gets the whole width and the buttons drop
            beneath it, lined up with the text; squeezed beside them it wraps
            to three words a line. */}
        <span className="flex min-w-0 flex-1 items-start gap-2 max-sm:basis-full">
          {icon}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={tone === "neutral" ? "text-[var(--fg-primary)]" : "font-medium"}>{headline}</span>
            {sub && <span className="text-[12px] text-[var(--fg-muted)]">{sub}</span>}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 max-sm:pl-2.5">
          {excluded.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={setOpen}
              iconRight={<ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />}
            >
              {excluded.length} not billed
            </Button>
          )}
          {actions}
        </span>
      </div>

      {open && excluded.length > 0 &&
        excludedList("flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2 text-[12px] text-[var(--fg-secondary)]")}
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
 * One village on a phone: the name and the figure that matters on one line, the
 * bar under it, and the working ("$0.00 of $168.00 · 0%") as one muted line.
 *
 * The labelled-lines card the table falls back to spent five lines per village
 * saying REVENUE and SHORT BY over and over — ten villages of it — and the
 * hostname, which nobody reads a bill by, took one of them.
 */
function PhoneBillRow({ name, revenue, target, pct, figure, tone, bar }) {
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[14px] font-semibold leading-snug text-[var(--fg-primary)]">{name}</span>
        <span
          className={`shrink-0 text-[14px] font-semibold tabular-nums ${
            tone === "danger" ? "text-[var(--danger-fg)]" : "text-[var(--success-fg)]"
          }`}
        >
          {figure}
        </span>
      </span>
      {bar && <Progress pct={pct} tone={tone} />}
      <span className="text-[11.5px] tabular-nums text-[var(--fg-muted)]">
        {money(revenue)} of {money(target)} · {pct}% of target
      </span>
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
      <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)] max-sm:flex-wrap max-sm:gap-y-1">
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
    <span className="inline-flex items-center gap-1.5 max-sm:flex-wrap">
      <span className="text-[12.5px] text-[var(--fg-secondary)] max-sm:whitespace-nowrap">Target $</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        inputMode="decimal"
        autoFocus
        className="h-8 w-24 tabular-nums max-sm:h-9 max-sm:w-24"
      />
      <Button variant="primary" size="xs" onClick={save} loading={busy} iconLeft={<Check size={11} />}>Save</Button>
      <Button variant="ghost" size="xs" onClick={() => setEditing(false)} disabled={busy} iconLeft={<X size={11} />}>Cancel</Button>
    </span>
  );
}

export default function BillingPage() {
  const { isAdmin } = useAuth();
  const { activeSiteId, activeSite, visibleSiteIds, loading: sitesLoading } = useSite();
  // The village lists are a different card on a phone, not a narrower table.
  const phone = usePhone();
  const [showAllUnder, setShowAllUnder] = useState(false);
  const [showAllOver, setShowAllOver] = useState(false);
  const [month, setMonth] = useState(""); // "" = let the server choose the last complete month
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  // The dashboards' precedence, resolved once: switcher village, then "Your
  // view", then the estate default (sent as nothing, so the server decides).
  const view = useMemo(() => {
    if (activeSiteId != null) return { kind: "village", ids: [Number(activeSiteId)], name: activeSite?.name };
    if (Array.isArray(visibleSiteIds)) return { kind: "personal", ids: visibleSiteIds.map(Number) };
    return { kind: "estate", ids: null };
  }, [activeSiteId, activeSite?.name, visibleSiteIds]);
  const viewKey = view.ids ? [...view.ids].sort((a, b) => a - b).join(",") : "estate";

  const load = useCallback(async () => {
    // Wait for the view: billing the estate default for a moment and then
    // swapping to the reader's own villages would flash the wrong bill.
    if (sitesLoading) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const params = {};
      if (month) params.month = month;
      if (viewKey !== "estate") params.villages = viewKey;
      const r = await billingApi.get(params);
      if (mine !== seq.current) return; // a newer view or month superseded this
      setData(r);
      if (!month) setMonth(r.month);
    } catch (e) {
      if (mine === seq.current) toast.error("Could not load billing: " + e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [month, viewKey, sitesLoading]);

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
      const modeText =
        view.kind === "village"
          ? `One village: ${view.name || ""}`
          : view.kind === "personal"
            ? "Your view"
            : {
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-1 text-[12px] font-medium text-[var(--warning-fg)] max-sm:items-start max-sm:rounded-xl max-sm:py-2">
              <AlertTriangle size={12} className="shrink-0 max-sm:mt-0.5" />
              Month in progress — {data.daysElapsed} of {data.daysInMonth} days. Shortfalls will shrink as it fills in.
            </span>
          )}
        </div>
      )}

      {data && <ScopeStrip data={data} isAdmin={isAdmin} view={view} phone={phone} />}

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
              page stays one screen however many villages there are. On a
              phone they stack and flow with the page instead: a scroll box
              inside a scrolling page is a trap for a thumb. */}
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
                  <div className="sm:max-h-[520px] sm:overflow-y-auto">
                    <DataTable>
                      <thead>
                        <tr>
                          <Th>Village</Th>
                          <Th align="right">Revenue</Th>
                          <Th align="right">Short by</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.under.map((r, i) => {
                          if (phone) {
                            if (!showAllUnder && i >= PHONE_ROWS) return null;
                            return (
                              <tr key={r.projectId}>
                                <Td>
                                  <PhoneBillRow
                                    name={r.name}
                                    revenue={r.revenue}
                                    target={data.target}
                                    pct={r.pctOfTarget}
                                    figure={`−${money(r.deficit)}`}
                                    tone="danger"
                                    bar
                                  />
                                </Td>
                              </tr>
                            );
                          }
                          return (
                          <tr key={r.projectId}>
                            <Td>
                              <span className="flex w-full min-w-0 flex-col gap-1.5">
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
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </div>
                  <PhoneMore
                    total={data.under.length}
                    expanded={showAllUnder}
                    onToggle={() => setShowAllUnder((v) => !v)}
                    noun="villages"
                  />
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
                  <div className="sm:max-h-[520px] sm:overflow-y-auto">
                    <DataTable>
                      <thead>
                        <tr>
                          <Th>Village</Th>
                          <Th align="right">Revenue</Th>
                          <Th align="right">Additional</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.over.map((r, i) => {
                          if (phone) {
                            if (!showAllOver && i >= PHONE_ROWS) return null;
                            return (
                              <tr key={r.projectId}>
                                <Td>
                                  <PhoneBillRow
                                    name={r.name}
                                    revenue={r.revenue}
                                    target={data.target}
                                    pct={r.pctOfTarget}
                                    figure={r.excess > 0 ? `+${money(r.excess)}` : money(0)}
                                    tone="success"
                                  />
                                </Td>
                              </tr>
                            );
                          }
                          return (
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
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </div>
                  <PhoneMore
                    total={data.over.length}
                    expanded={showAllOver}
                    onToggle={() => setShowAllOver((v) => !v)}
                    noun="villages"
                  />
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
          {(data.noGroup.length > 0 || shared.length > 0 || t.unattributed?.revenue > 0 || t.outsideBill?.revenue > 0) && (
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
                {t.outsideBill?.revenue > 0 && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
                    <span>
                      <span className="font-medium tabular-nums text-[var(--fg-primary)]">{money(t.outsideBill.revenue)}</span>{" "}
                      came from villages that are not on this bill — outside this view, or switched off.
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
