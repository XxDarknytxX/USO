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
  AlertTriangle, CalendarClock, CircleDashed, ClipboardCheck, FileText, ListChecks, Lock, MapPin, RefreshCw, Trash2, Wrench,
} from "lucide-react";
import { maintenanceApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import {
  PageShell, PageHeader, KpiGrid, StatCard, Panel, Toolbar, Segmented,
  DataTable, Th, Td, TableMessage, RecordCell, StatusPill,
  Button, EmptyState, Select,
} from "../components/ui";
import VisitEditor from "../components/maintenance/VisitEditor";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const cx = (...p) => p.filter(Boolean).join(" ");

/*
 * Phone cards. Below 640px DataTable turns each row into a card of labelled
 * lines; these tune that card and do nothing on a wider screen. The `!` is
 * needed because the stacking CSS is unlayered and would otherwise win.
 *  • PHONE_HIDE — a line that only says "—", or repeats the card's title.
 *  • PHONE_ACTIONS — the row's buttons: no "ACTION" label, full width, for a thumb.
 *  • PHONE_BLOCK — prose (notes): label above, text left-aligned below it,
 *    rather than a ragged right-aligned paragraph.
 */
const PHONE_HIDE = "max-sm:hidden!";
const PHONE_ACTIONS = "max-sm:before:hidden! max-sm:pt-1";
const PHONE_ACTIONS_ROW = "max-sm:w-full! max-sm:ml-0!";
const PHONE_BLOCK = "max-sm:flex-col max-sm:gap-1! max-sm:text-left!";

/**
 * The card title on a phone: the village, with the date under it and an
 * optional status at the right. Hidden from sm up, where the table's own
 * columns say the same thing.
 */
function PhoneTitle({ title, sub, aside }) {
  return (
    <span className="flex flex-1 items-start justify-between gap-3 sm:hidden">
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-semibold text-[var(--fg-primary)]">{title}</span>
        {sub && <span className="text-[12px] text-[var(--fg-muted)]">{sub}</span>}
      </span>
      {aside && <span className="shrink-0">{aside}</span>}
    </span>
  );
}

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
    <Select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="min-w-[180px]">
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
          `${isAdmin ? "Every village" : "Each village assigned to you"} is inspected every ` +
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

      {/* Compliance first — the question this page exists to answer. */}
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
        {tab !== "schedule" && (
          <div className="ml-auto flex flex-wrap items-center gap-2.5 max-sm:flex-col max-sm:items-stretch">
            {villageFilter}
            {tab === "submissions" && (
              <Select
                value={filterComponent}
                onChange={(e) => setFilterComponent(e.target.value)}
                className="min-w-[190px]"
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
                  sites.map((s) => (
                    <tr key={s.projectId}>
                      <Td>
                        <RecordCell
                          tone="navy"
                          icon={<MapPin size={14} />}
                          title={s.name}
                          subtitle={s.hostname}
                          mono
                          onClick={() => navigate(`/maintenance/village/${s.projectId}`)}
                        />
                      </Td>
                      {/* On a phone card, what is due leads and the last visit
                          follows; a village never serviced has no last visit
                          to show, so those lines go rather than read "—". */}
                      <Td nowrap className={cx("max-sm:order-2", !s.lastVisitDate && PHONE_HIDE)}>
                        {fmtDate(s.lastVisitDate)}
                      </Td>
                      <Td className={cx("max-sm:order-2", !s.lastEngineer && PHONE_HIDE)}>{s.lastEngineer || "—"}</Td>
                      <Td className={cx("max-sm:order-1", !s.lastCondition && PHONE_HIDE)}><ConditionPill value={s.lastCondition} /></Td>
                      <Td className="max-sm:order-1">
                        <DocsCell
                          site={s}
                          onOpen={() => navigate(`/maintenance/village/${s.projectId}?tab=documents`)}
                        />
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
                      <Td align="right" className={cx("max-sm:order-3", PHONE_ACTIONS)}>
                        <div className={cx("flex items-center justify-end gap-2", PHONE_ACTIONS_ROW)}>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="max-sm:flex-1"
                            iconLeft={<Wrench size={13} />}
                            onClick={() => navigate(`/maintenance/village/${s.projectId}`)}
                          >
                            Service
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
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
                  scopedVisits.map((v) => {
                    const statusPill =
                      v.status === "submitted" ? (
                        <StatusPill tone="success" dot={false}>
                          <Lock size={10} /> Filed
                        </StatusPill>
                      ) : (
                        <StatusPill tone="warning">Draft</StatusPill>
                      );
                    return (
                    <tr key={v.id}>
                      {/* A phone card is titled by the village, not the date. */}
                      <Td nowrap>
                        <PhoneTitle title={v.projectName || "—"} sub={fmtDate(v.visitDate)} aside={statusPill} />
                        <span className="max-sm:hidden">{fmtDate(v.visitDate)}</span>
                      </Td>
                      <Td strong className={PHONE_HIDE}>{v.projectName || "—"}</Td>
                      <Td>{v.engineerName || "—"}</Td>
                      <Td className={cx(!v.overallCondition && PHONE_HIDE)}><ConditionPill value={v.overallCondition} /></Td>
                      <Td align="right" className="tabular-nums">{v.photoCount ?? 0}</Td>
                      <Td className={PHONE_HIDE}>{statusPill}</Td>
                      <Td align="right" className={PHONE_ACTIONS}>
                        <div className={cx("flex items-center justify-end gap-1", PHONE_ACTIONS_ROW, "max-sm:gap-2")}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="max-sm:flex-1"
                            onClick={() => setOpenVisit(v.id)}
                          >
                            {v.status === "submitted" ? "View" : "Continue"}
                          </Button>
                          {/* Drafts only — a filed report is evidence, and an
                              admin reopens it rather than deleting it. */}
                          {v.status !== "submitted" && (
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
                  scopedSubmissions.map((x, i) => (
                    <tr key={`${x.visitId}-${x.component}-${i}`}>
                      <Td nowrap>
                        <PhoneTitle
                          title={x.projectName || "—"}
                          sub={x.submittedAt ? `Filed ${fmtDate(x.submittedAt)}` : null}
                          aside={x.condition ? <ConditionPill value={x.condition} /> : null}
                        />
                        <span className="max-sm:hidden">{fmtDate(x.submittedAt)}</span>
                      </Td>
                      <Td strong className={PHONE_HIDE}>{x.projectName || "—"}</Td>
                      <Td>{x.componentLabel}</Td>
                      <Td className={PHONE_HIDE}><ConditionPill value={x.condition} /></Td>
                      <Td align="right" className="tabular-nums">{x.photoCount}</Td>
                      <Td>{x.engineerName || "—"}</Td>
                      {/* Truncated to one line in the table; a phone card has
                          the room to show the note whole. */}
                      <Td className={cx("sm:max-w-[280px] sm:truncate", PHONE_BLOCK, !x.notes && PHONE_HIDE)}>
                        <span title={x.notes || ""} className="max-sm:ml-0!">{x.notes || "—"}</span>
                      </Td>
                      <Td align="right" className={PHONE_ACTIONS}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cx("max-sm:flex-1", PHONE_ACTIONS_ROW)}
                          onClick={() => setOpenVisit(x.visitId)}
                        >
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
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
