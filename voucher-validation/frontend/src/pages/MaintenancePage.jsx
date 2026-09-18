// src/pages/MaintenancePage.jsx
// Service maintenance: which villages are due for their 6-monthly inspection,
// and the filed reports that prove one happened.
//
// Two audiences, one page. An engineer comes here to start and file a report;
// an admin comes here to see whether the estate is compliant and to read the
// evidence. The schedule is first for both, because "which sites are overdue"
// is the question the feature exists to answer.
//
// The three views are one Segmented control over one toolbar rather than three
// stacked panels: schedule, reports and submissions are the same records at
// three grains, and seeing them at once buys nothing but scroll.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertTriangle, CalendarClock, ChevronRight, CircleDashed, ClipboardCheck, FileText, ListChecks, Lock, MapPin, RefreshCw, Trash2, Wrench,
} from "lucide-react";
import { maintenanceApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import {
  PageShell, PageHeader, KpiGrid, StatCard, Panel, Toolbar, Segmented,
  DataTable, Th, Td, TableMessage, RecordCell, StatusPill,
  Button, EmptyState, Select,
} from "../components/ui";
import { usePhone, PhoneMore, PHONE_ROWS } from "../components/ui/phone";
import VisitEditor from "../components/maintenance/VisitEditor";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const cx = (...p) => p.filter(Boolean).join(" ");

/*
 * Phone cards.
 *
 * Below 640px DataTable turns each row into a card of "LABEL  value" lines.
 * That is right for a list of figures and wrong for these three: a schedule row
 * read on a phone is one question ("is this village due, and what state was it
 * in") and the labelled form spent seven lines and a full-width button not
 * answering it. So a phone builds the card by hand instead — a tappable title
 * line, the state as chips, and the provenance as one muted line — and the
 * other cells are simply not rendered.
 *
 * `usePhone()` rather than CSS: the rows differ in structure, not in styling,
 * and branching in the markup leaves the desktop table byte-identical.
 */

/** The card's first line: what the row is about, and where tapping it goes. */
function CardTitle({ title, sub, mono = false, aside, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg text-left focus-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-snug text-[var(--fg-primary)]">{title}</span>
        {sub && (
          <span
            className={cx(
              "block text-[11.5px] leading-snug text-[var(--fg-muted)] [overflow-wrap:anywhere]",
              mono && "font-mono text-[11px]"
            )}
          >
            {sub}
          </span>
        )}
      </span>
      {aside}
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--fg-subtle)]" />
    </button>
  );
}

/** The chips line under a card title: state, never labels. */
function CardChips({ children }) {
  return <span className="flex flex-wrap items-center gap-1.5">{children}</span>;
}

/** One muted line of provenance — who, when, how many. */
function CardMeta({ children }) {
  return <span className="text-[11.5px] leading-snug text-[var(--fg-muted)]">{children}</span>;
}

/** The phone card's shell: the whole row, since no other cell is rendered. */
function PhoneCard({ children }) {
  return <span className="flex w-full flex-col gap-2">{children}</span>;
}

/**
 * The four compliance figures on a phone.
 *
 * As StatCards they are four 140px tiles — the better part of the first screen
 * spent before the village list starts, on a page whose first question is
 * "which village". The same four figures in one card, at a quarter of the
 * height: the label, the figure, and the one clause that qualifies it.
 */
function PhoneKpis({ items }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--border-subtle)] shadow-[var(--shadow-card)]">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col bg-[var(--bg-elevated)] px-3.5 py-2.5">
          <span className="text-label truncate">{it.label}</span>
          <span className="mt-1.5 flex items-baseline gap-1.5">
            <span
              className={cx(
                "text-[19px] font-semibold leading-none tabular-nums",
                it.tone || "text-[var(--fg-primary)]"
              )}
            >
              {it.value}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-[var(--fg-muted)]">{it.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A component filed before the current checklist keeps its old key
 * ("access_points", "solar"), for which the server has no label and hands back
 * the key itself. Print something a person can read rather than a column value.
 */
const humanComponent = (label, key) => {
  const t = String(label ?? key ?? "").trim();
  if (!t) return "Component";
  // Only a bare key is rewritten; a real label ("Power (solar / battery / PSU)")
  // has spaces and capitals and is left exactly as the server said it.
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(t)) return t;
  return t.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
};

const CONDITION_TONE = { ok: "success", attention: "warning", faulty: "danger", na: "neutral" };
const CONDITION_LABEL = { ok: "OK", attention: "Needs attention", faulty: "Faulty", na: "N/A" };

// Mirrors the server checklist. Only used to populate the filter — the server
// is the authority and rejects anything it does not recognise.
const COMPONENT_FILTERS = [
  { key: "gateway", label: "Gateway / router" },
  { key: "aps", label: "Access points" },
  { key: "starlink", label: "Starlink dish & mount" },
  { key: "power", label: "Power (solar / battery / PSU)" },
  { key: "enclosure", label: "Enclosure & cabling" },
  { key: "site", label: "Site & safety" },
];

/** Human "due in"/"overdue by" from a day count. */
function dueLabel(site) {
  if (site.neverServiced) return "Never serviced";
  const d = site.daysUntilDue;
  if (d == null) return "—";
  if (d < 0) return `Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`;
  if (d === 0) return "Due today";
  if (d < 31) return `Due in ${d} day${d === 1 ? "" : "s"}`;
  return `Due ${fmtDate(site.nextDue)}`;
}

/**
 * The site paperwork a village has, as a pill that opens it. A handover pack is
 * called out by name: "never serviced" and "nothing on file at all" are
 * different states, and the schedule is where that question gets asked.
 */
function DocsCell({ site, onOpen }) {
  if (!site.docCount) return <span className="text-[var(--fg-muted)]">None</span>;
  const label = site.handoverCount
    ? `Handover${site.docCount > 1 ? ` +${site.docCount - 1}` : ""}`
    : `${site.docCount} document${site.docCount === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${site.docCount} document${site.docCount === 1 ? "" : "s"} on file${site.lastDocAt ? ` · newest ${fmtDate(site.lastDocAt)}` : ""} — open them`}
      className="rounded-full focus-ring pointer-coarse:min-h-8"
    >
      <StatusPill tone={site.handoverCount ? "success" : "info"} dot={false}>
        <FileText size={11} />
        {label}
      </StatusPill>
    </button>
  );
}

/** Condition as a pill, or an em dash when nothing has been filed. */
function ConditionPill({ value }) {
  if (!value) return <span className="text-[var(--fg-muted)]">—</span>;
  return <StatusPill tone={CONDITION_TONE[value] || "neutral"}>{CONDITION_LABEL[value] || value}</StatusPill>;
}

export default function MaintenancePage() {
  // The page speaks for the whole estate to an admin and for one contractor's
  // own list to everyone else. Telling someone who can see two villages of
  // thirty-one that "every village is in window" is a compliance claim they
  // are not in a position to make.
  const { isAdmin, isViewer } = useAuth();
  const navigate = useNavigate();
  // Follow the scope switcher and the "All Villages" set from Settings, the
  // same as Overview and Network. A village deselected there is not part of
  // the estate the operator is looking at, so it must not appear in the
  // compliance counts either — a test site would otherwise read as overdue.
  const { isInScope } = useSite();
  // Phone rows are a different card, not a narrower table; see the helpers above.
  const phone = usePhone();
  // Long lists are capped on a phone and offer the rest, the same as every
  // other list in the console. The schedule is not capped: "which villages are
  // overdue" is the page, and hiding four of them behind a button answers it
  // with a button.
  const [showAllReports, setShowAllReports] = useState(false);
  const [showAllSubs, setShowAllSubs] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openVisit, setOpenVisit] = useState(null);
  const [filterProject, setFilterProject] = useState("");
  const [tab, setTab] = useState("schedule"); // schedule | reports | submissions
  const [submissions, setSubmissions] = useState([]);
  const [filterComponent, setFilterComponent] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, v, sub] = await Promise.all([
        maintenanceApi.schedule(),
        maintenanceApi.visits({ limit: 100, ...(filterProject ? { projectId: filterProject } : {}) }),
        maintenanceApi.submissions({
          limit: 300,
          ...(filterProject ? { projectId: filterProject } : {}),
          ...(filterComponent ? { component: filterComponent } : {}),
        }),
      ]);
      setSchedule(s);
      setVisits(v.visits || []);
      setSubmissions(sub.submissions || []);
    } catch (e) {
      toast.error("Failed to load maintenance: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [filterProject, filterComponent]);

  useEffect(() => { load(); }, [load]);

  const sites = useMemo(
    () => (schedule?.sites || []).filter((s) => isInScope(s.projectId)),
    [schedule, isInScope]
  );
  const scopedSubmissions = useMemo(
    () => submissions.filter((x) => x.projectId == null || isInScope(x.projectId)),
    [submissions, isInScope]
  );

  const scopedVisits = useMemo(
    () => visits.filter((v) => v.projectId == null || isInScope(v.projectId)),
    [visits, isInScope]
  );
  const overdue = useMemo(() => sites.filter((s) => s.overdue), [sites]);
  const neverServiced = useMemo(() => sites.filter((s) => s.neverServiced), [sites]);
  const filedCount = scopedVisits.filter((v) => v.status === "submitted").length;
  const draftCount = scopedVisits.length - filedCount;

  async function deleteDraft(v) {
    if (!window.confirm(`Delete the draft for ${v.projectName || "this village"}? Its photos go too. This cannot be undone.`)) return;
    setDeleting(v.id);
    try {
      const r = await maintenanceApi.deleteVisit(v.id);
      toast.success(`Draft deleted${r.photosRemoved ? ` · ${r.photosRemoved} photo${r.photosRemoved === 1 ? "" : "s"} removed` : ""}`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  // Both the reports and the submissions views filter by village, and they share
  // one piece of state so switching between them keeps the village you picked.
  // A village picked here can stop being on offer — the scope switcher changed,
  // or an admin took it off this account. Left alone, the <Select> has no
  // matching <option> and renders blank while load() keeps querying the village
  // that is no longer listed: an empty table with no visible cause and no
  // control to clear it. Reconciling drops the filter back to "all".
  useEffect(() => {
    if (!filterProject || loading) return;
    if (!sites.some((s) => String(s.projectId) === String(filterProject))) setFilterProject("");
  }, [sites, filterProject, loading]);

  const villageFilter = (
    <Select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="min-w-[180px] max-sm:min-w-0">
      <option value="">All villages</option>
      {sites.map((s) => (
        <option key={s.projectId} value={s.projectId}>{s.name}</option>
      ))}
    </Select>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Field service"
        title="Maintenance"
        subtitle={
          // The phone gets the same sentence with the clauses a small screen
          // cannot afford: "component by component" costs a whole line above
          // the figures, and the component list says it two taps later.
          phone
            ? `Inspected every ${schedule?.intervalMonths ?? 6} months. ` +
              (isViewer ? "Open a village to see what was found." : "Open a village to record what you found.")
            : `${isAdmin ? "Every village" : "Each village assigned to you"} is inspected every ` +
              `${schedule?.intervalMonths ?? 6} months. ` +
              (isViewer
                ? "Open one to see what was found, component by component."
                : "Open one to record what you found, component by component.")
        }
        icon={<Wrench size={22} />}
        tone="orange"
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      {/* Compliance first — the question this page exists to answer. On a phone
          it is the same four figures in a quarter of the height; see PhoneKpis. */}
      {phone ? (
        <PhoneKpis
          items={[
            {
              label: "Villages in scope",
              value: sites.length,
              sub: `${schedule?.intervalMonths ?? 6}-month cycle`,
            },
            {
              label: "Overdue",
              value: overdue.length,
              sub: overdue.length ? "past window" : "all in window",
              tone: overdue.length ? "text-[var(--danger-fg)]" : null,
            },
            {
              label: "Never serviced",
              value: neverServiced.length,
              sub: neverServiced.length ? "no record" : "all on record",
              tone: neverServiced.length ? "text-[var(--warning-fg)]" : null,
            },
            {
              label: "Reports filed",
              value: filedCount,
              sub: draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} open` : "no open drafts",
            },
          ]}
        />
      ) : (
      <KpiGrid>
        <StatCard
          label="Villages in scope"
          value={sites.length}
          sub={`${schedule?.intervalMonths ?? 6}-month service cycle`}
          icon={<MapPin size={18} />}
          color="navy"
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          sub={
            overdue.length
              ? "past the service window"
              : isAdmin ? "every village is in window" : "all of yours are in window"
          }
          icon={<AlertTriangle size={18} />}
          color={overdue.length ? "red" : "green"}
        />
        <StatCard
          label="Never serviced"
          value={neverServiced.length}
          sub={
            neverServiced.length
              ? "no inspection on record"
              : isAdmin ? "all villages have a record" : "all of yours have a record"
          }
          icon={<CircleDashed size={18} />}
          color={neverServiced.length ? "orange" : "green"}
        />
        <StatCard
          label="Reports filed"
          value={filedCount}
          sub={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} still open` : "no open drafts"}
          icon={<ClipboardCheck size={18} />}
          color="indigo"
        />
      </KpiGrid>
      )}

      {/* One strip carries the view switch and that view's filters, so the
          filters never float loose above a table. */}
      <Toolbar>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "schedule", label: "Schedule", count: sites.length },
            { value: "reports", label: "Reports", count: scopedVisits.length },
            { value: "submissions", label: "Submissions", count: scopedSubmissions.length },
          ]}
        />
        {/* One row on a phone too: two stacked full-width selects put ~90px of
            chrome between the view switch and the first record. `[&>*]` is the
            Select's own relative wrapper — that is the flex item, and it needs
            both a zero basis and a zero minimum, or the widest option ("Power
            (solar / battery / PSU)") sets its width. */}
        {tab !== "schedule" && (
          <div className="ml-auto flex flex-wrap items-center gap-2.5 max-sm:flex-nowrap max-sm:gap-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1">
            {villageFilter}
            {tab === "submissions" && (
              <Select
                value={filterComponent}
                onChange={(e) => setFilterComponent(e.target.value)}
                className="min-w-[190px] max-sm:min-w-0"
              >
                <option value="">All components</option>
                {COMPONENT_FILTERS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </Select>
            )}
          </div>
        )}
      </Toolbar>

      {tab === "schedule" && (
        <Panel
          padding={false}
          title="Service schedule"
          subtitle={
            overdue.length
              ? `${overdue.length} village${overdue.length === 1 ? "" : "s"} due or overdue`
              : isAdmin
                ? "Every village is within its service window"
                : "Every village assigned to you is within its service window"
          }
          icon={<ClipboardCheck size={15} />}
          tone="orange"
        >
          {!loading && sites.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title={isAdmin ? "No villages" : "No villages assigned to you"}
              description={
                isAdmin
                  ? "Add sites under Network first."
                  : "Ask an administrator to add the villages you service to your account."
              }
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Village</Th>
                  <Th>Last serviced</Th>
                  <Th>Engineer</Th>
                  <Th>Condition</Th>
                  <Th>Documents</Th>
                  <Th>Next due</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessage colSpan={7}>Loading…</TableMessage>
                ) : (
                  sites.map((s) => {
                    const open = () => navigate(`/maintenance/village/${s.projectId}`);
                    const openDocs = () => navigate(`/maintenance/village/${s.projectId}?tab=documents`);
                    // A phone card: the village, its due state and condition as
                    // chips, and the last visit as one line. No Service button —
                    // the card already opens the village, which is where the
                    // servicing happens.
                    if (phone) {
                      const late = s.overdue || s.neverServiced;
                      return (
                        <tr key={s.projectId}>
                          <Td>
                            <PhoneCard>
                              <CardTitle title={s.name} sub={s.hostname} mono onClick={open} />
                              <CardChips>
                                <StatusPill tone={late ? "danger" : "neutral"} dot={false}>
                                  {s.overdue || s.neverServiced
                                    ? <AlertTriangle size={11} />
                                    : <CalendarClock size={11} className="text-[var(--fg-subtle)]" />}
                                  {dueLabel(s)}
                                </StatusPill>
                                {s.lastCondition && <ConditionPill value={s.lastCondition} />}
                                {s.docCount > 0 && <DocsCell site={s} onOpen={openDocs} />}
                              </CardChips>
                              {s.lastVisitDate && (
                                <CardMeta>
                                  Last serviced {fmtDate(s.lastVisitDate)}
                                  {s.lastEngineer ? ` · ${s.lastEngineer}` : ""}
                                </CardMeta>
                              )}
                            </PhoneCard>
                          </Td>
                        </tr>
                      );
                    }
                    return (
                    <tr key={s.projectId}>
                      <Td>
                        <RecordCell
                          tone="navy"
                          icon={<MapPin size={14} />}
                          title={s.name}
                          subtitle={s.hostname}
                          mono
                          onClick={open}
                        />
                      </Td>
                      <Td nowrap>{fmtDate(s.lastVisitDate)}</Td>
                      <Td>{s.lastEngineer || "—"}</Td>
                      <Td><ConditionPill value={s.lastCondition} /></Td>
                      <Td>
                        <DocsCell site={s} onOpen={openDocs} />
                      </Td>
                      <Td nowrap>
                        <span
                          className={
                            s.overdue
                              ? "inline-flex items-center gap-1.5 font-semibold text-[var(--danger-fg)]"
                              : "inline-flex items-center gap-1.5 text-[var(--fg-secondary)]"
                          }
                        >
                          {s.overdue ? <AlertTriangle size={12} /> : <CalendarClock size={12} className="text-[var(--fg-subtle)]" />}
                          {dueLabel(s)}
                        </span>
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft={<Wrench size={13} />}
                            onClick={open}
                          >
                            Service
                          </Button>
                        </div>
                      </Td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
          )}
        </Panel>
      )}

      {tab === "reports" && (
        <Panel
          padding={false}
          title="Reports"
          subtitle="The record behind the servicing — drafts you have open, and every filed report"
          icon={<ClipboardCheck size={15} />}
          tone="orange"
        >
          {!loading && scopedVisits.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No reports yet"
              description="Start one from the schedule."
            />
          ) : (
            <>
            <DataTable>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Village</Th>
                  <Th>Engineer</Th>
                  <Th>Condition</Th>
                  <Th align="right">Photos</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessage colSpan={7}>Loading…</TableMessage>
                ) : (
                  scopedVisits.map((v, i) => {
                    const filed = v.status === "submitted";
                    const statusPill = filed ? (
                      <StatusPill tone="success" dot={false}>
                        <Lock size={10} /> Filed
                      </StatusPill>
                    ) : (
                      <StatusPill tone="warning">Draft</StatusPill>
                    );
                    // A phone card is titled by the village, not the date, and
                    // opens the report by being tapped. Only a draft keeps a
                    // button: deleting one is the single thing the card cannot
                    // say with a tap.
                    if (phone) {
                      if (!showAllReports && i >= PHONE_ROWS) return null;
                      return (
                        <tr key={v.id}>
                          <Td>
                            <PhoneCard>
                              <CardTitle
                                title={v.projectName || "Village"}
                                sub={`${fmtDate(v.visitDate)}${v.engineerName ? ` · ${v.engineerName}` : ""}`}
                                aside={statusPill}
                                onClick={() => setOpenVisit(v.id)}
                              />
                              <CardChips>
                                {v.overallCondition && <ConditionPill value={v.overallCondition} />}
                                <CardMeta>
                                  {v.photoCount ?? 0} photo{(v.photoCount ?? 0) === 1 ? "" : "s"}
                                </CardMeta>
                                {!filed && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto"
                                    loading={deleting === v.id}
                                    onClick={() => deleteDraft(v)}
                                    aria-label={`Delete the draft for ${v.projectName || "this village"}`}
                                    iconLeft={deleting !== v.id && <Trash2 size={13} />}
                                  />
                                )}
                              </CardChips>
                            </PhoneCard>
                          </Td>
                        </tr>
                      );
                    }
                    return (
                    <tr key={v.id}>
                      <Td nowrap>{fmtDate(v.visitDate)}</Td>
                      <Td strong>{v.projectName || "—"}</Td>
                      <Td>{v.engineerName || "—"}</Td>
                      <Td><ConditionPill value={v.overallCondition} /></Td>
                      <Td align="right" className="tabular-nums">{v.photoCount ?? 0}</Td>
                      <Td>{statusPill}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setOpenVisit(v.id)}>
                            {filed ? "View" : "Continue"}
                          </Button>
                          {/* Drafts only — a filed report is evidence, and an
                              admin reopens it rather than deleting it. */}
                          {!filed && (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={deleting === v.id}
                              onClick={() => deleteDraft(v)}
                              title="Delete this draft"
                              aria-label="Delete this draft"
                              iconLeft={deleting !== v.id && <Trash2 size={13} />}
                            />
                          )}
                        </div>
                      </Td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
            <PhoneMore
              total={scopedVisits.length}
              expanded={showAllReports}
              onToggle={() => setShowAllReports((v) => !v)}
              noun="reports"
            />
            </>
          )}
        </Panel>
      )}

      {tab === "submissions" && (
        <Panel
          padding={false}
          title="Component submissions"
          subtitle="Every component filed, newest first — what was inspected, when, and by whom"
          icon={<ListChecks size={15} />}
          tone="orange"
        >
          {!loading && scopedSubmissions.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Nothing filed yet"
              description="Components appear here as engineers file them, one at a time."
            />
          ) : (
            <>
            <DataTable>
              <thead>
                <tr>
                  <Th>Filed</Th>
                  <Th>Village</Th>
                  <Th>Component</Th>
                  <Th>Condition</Th>
                  <Th align="right">Photos</Th>
                  <Th>Engineer</Th>
                  <Th>Notes</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessage colSpan={8}>Loading…</TableMessage>
                ) : (
                  scopedSubmissions.map((x, i) => {
                    // A phone card leads with the component — the village is
                    // the sub-line, because this list is read component-first
                    // ("what has been filed for the solar") — and the note gets
                    // two lines before the next card starts.
                    if (phone) {
                      if (!showAllSubs && i >= PHONE_ROWS) return null;
                      return (
                        <tr key={`${x.visitId}-${x.component}-${i}`}>
                          <Td>
                            <PhoneCard>
                              <CardTitle
                                title={humanComponent(x.componentLabel, x.component)}
                                sub={x.projectName || "—"}
                                aside={x.condition ? <ConditionPill value={x.condition} /> : null}
                                onClick={() => setOpenVisit(x.visitId)}
                              />
                              <CardMeta>
                                {[
                                  x.submittedAt ? `Filed ${fmtDate(x.submittedAt)}` : null,
                                  x.engineerName || null,
                                  `${x.photoCount} photo${x.photoCount === 1 ? "" : "s"}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </CardMeta>
                              {x.notes && (
                                <span className="line-clamp-2 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
                                  {x.notes}
                                </span>
                              )}
                            </PhoneCard>
                          </Td>
                        </tr>
                      );
                    }
                    return (
                    <tr key={`${x.visitId}-${x.component}-${i}`}>
                      <Td nowrap>{fmtDate(x.submittedAt)}</Td>
                      <Td strong>{x.projectName || "—"}</Td>
                      <Td>{x.componentLabel}</Td>
                      <Td><ConditionPill value={x.condition} /></Td>
                      <Td align="right" className="tabular-nums">{x.photoCount}</Td>
                      <Td>{x.engineerName || "—"}</Td>
                      <Td className="sm:max-w-[280px] sm:truncate">
                        <span title={x.notes || ""}>{x.notes || "—"}</span>
                      </Td>
                      <Td align="right">
                        <Button variant="ghost" size="sm" onClick={() => setOpenVisit(x.visitId)}>
                          Open
                        </Button>
                      </Td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
            <PhoneMore
              total={scopedSubmissions.length}
              expanded={showAllSubs}
              onToggle={() => setShowAllSubs((v) => !v)}
              noun="submissions"
            />
            </>
          )}
        </Panel>
      )}

      {openVisit && (
        <VisitEditor
          visitId={openVisit}
          isAdmin={isAdmin}
          onClose={() => setOpenVisit(null)}
          onChanged={load}
        />
      )}
    </PageShell>
  );
}
