// src/pages/MaintenancePage.jsx
// Service maintenance: which villages are due for their 6-monthly inspection,
// and the filed reports that prove one happened.
//
// Two audiences, one page. An engineer comes here to start and file a report;
// an admin comes here to see whether the estate is compliant and to read the
// evidence. The schedule is first for both, because "which sites are overdue"
// is the question the feature exists to answer.

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Wrench, RefreshCw, ClipboardCheck, AlertTriangle, Camera, Lock, Trash2, ListChecks,
} from "lucide-react";
import { maintenanceApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import { PageHeader, Panel, Button, Badge, EmptyState, Select } from "../components/ui";
import VisitEditor from "../components/maintenance/VisitEditor";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const CONDITION_TONE = { ok: "success", attention: "warning", faulty: "danger", na: "neutral" };
const CONDITION_LABEL = { ok: "OK", attention: "Needs attention", faulty: "Faulty", na: "N/A" };

// Mirrors the server checklist. Only used to populate the filter — the server
// is the authority and rejects anything it does not recognise.
const COMPONENT_FILTERS = [
  { key: "gateway", label: "Gateway / router" },
  { key: "aps", label: "Access points" },
  { key: "switch", label: "Switch" },
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

export default function MaintenancePage() {
  const { isAdmin } = useAuth();
  // Follow the scope switcher and the "All Villages" set from Settings, the
  // same as Overview and Network. A village deselected there is not part of
  // the estate the operator is looking at, so it must not appear in the
  // compliance counts either — a test site would otherwise read as overdue.
  const { isInScope } = useSite();
  const [schedule, setSchedule] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(null);
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

  async function startReport(projectId) {
    setStarting(projectId);
    try {
      const r = await maintenanceApi.createVisit({ projectId });
      if (r.reused) toast("Reopened your existing draft for this village", { icon: "📝" });
      setOpenVisit(r.visitId);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Field service"
        title="Maintenance"
        subtitle={`Every village is inspected every ${schedule?.intervalMonths ?? 6} months. Reports are photographic evidence of what was found.`}
        icon={<Wrench size={20} />}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      {/* Compliance first — the question this page exists to answer. */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Villages" value={sites.length} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "success"} />
        <Stat label="Never serviced" value={sites.filter((s) => s.neverServiced).length} tone={sites.some((s) => s.neverServiced) ? "warning" : "success"} />
        <Stat label="Reports filed" value={scopedVisits.filter((v) => v.status === "submitted").length} />
      </div>

      <div className="mt-5 inline-flex items-center rounded-md p-0.5 bg-[var(--surface-raised)] border border-[var(--border-default)]">
        {[
          { v: "schedule", l: "Schedule" },
          { v: "reports", l: "Reports" },
          { v: "submissions", l: "Submissions" },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={
              "h-7 px-3 text-[12px] font-medium rounded transition-colors " +
              (tab === v
                ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
            }
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "schedule" && (
      <div className="mt-5">
        <Panel
          padding={false}
          title="Service schedule"
          subtitle={
            overdue.length
              ? `${overdue.length} village${overdue.length === 1 ? "" : "s"} due or overdue`
              : "Every village is within its service window"
          }
          icon={<ClipboardCheck size={15} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--border-default)]">
                  <Th>Village</Th>
                  <Th>Last serviced</Th>
                  <Th>Engineer</Th>
                  <Th>Condition</Th>
                  <Th>Next due</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td></tr>
                ) : sites.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8">
                    <EmptyState icon={Wrench} title="No villages" description="Add sites under Network first." />
                  </td></tr>
                ) : (
                  sites.map((s) => (
                    <tr key={s.projectId} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-5 py-3 font-medium text-[var(--fg-primary)]">{s.name}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap">{fmtDate(s.lastVisitDate)}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)]">{s.lastEngineer || "—"}</td>
                      <td className="px-5 py-3">
                        {s.lastCondition ? (
                          <Badge tone={CONDITION_TONE[s.lastCondition] || "neutral"}>
                            {CONDITION_LABEL[s.lastCondition] || s.lastCondition}
                          </Badge>
                        ) : (
                          <span className="text-[var(--fg-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={s.overdue ? "text-[var(--brand)] font-medium" : "text-[var(--fg-secondary)]"}>
                          {s.overdue && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                          {dueLabel(s)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {s.lastVisitId && (
                            <Button variant="ghost" size="sm" onClick={() => setOpenVisit(s.lastVisitId)}>
                              View last
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={starting === s.projectId}
                            iconLeft={starting !== s.projectId && <Camera size={13} />}
                            onClick={() => startReport(s.projectId)}
                          >
                            Start report
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      )}

      {tab === "reports" && (
      <div className="mt-5">
        <Panel
          padding={false}
          title="Reports"
          subtitle="Drafts you have open, and every filed report"
          icon={<ClipboardCheck size={15} />}
          actions={
            <Select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="min-w-[190px]">
              <option value="">All villages</option>
              {sites.map((s) => (
                <option key={s.projectId} value={s.projectId}>{s.name}</option>
              ))}
            </Select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--border-default)]">
                  <Th>Date</Th>
                  <Th>Village</Th>
                  <Th>Engineer</Th>
                  <Th>Condition</Th>
                  <Th>Photos</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {loading ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td></tr>
                ) : scopedVisits.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8">
                    <EmptyState
                      icon={ClipboardCheck}
                      title="No reports yet"
                      description="Start one from the schedule above."
                    />
                  </td></tr>
                ) : (
                  scopedVisits.map((v) => (
                    <tr key={v.id} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap">{fmtDate(v.visitDate)}</td>
                      <td className="px-5 py-3 font-medium text-[var(--fg-primary)]">{v.projectName || "—"}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)]">{v.engineerName || "—"}</td>
                      <td className="px-5 py-3">
                        {v.overallCondition ? (
                          <Badge tone={CONDITION_TONE[v.overallCondition] || "neutral"}>
                            {CONDITION_LABEL[v.overallCondition] || v.overallCondition}
                          </Badge>
                        ) : (
                          <span className="text-[var(--fg-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-[var(--fg-secondary)]">{v.photoCount ?? 0}</td>
                      <td className="px-5 py-3">
                        {v.status === "submitted" ? (
                          <Badge tone="success">
                            <Lock size={9} className="inline mr-1 -mt-0.5" />Filed
                          </Badge>
                        ) : (
                          <Badge tone="warning">Draft</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setOpenVisit(v.id)}>
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
                              iconLeft={deleting !== v.id && <Trash2 size={13} />}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      )}

      {tab === "submissions" && (
      <div className="mt-5">
        <Panel
          padding={false}
          title="Component submissions"
          subtitle="Every component filed, newest first — what was inspected, when, and by whom"
          icon={<ListChecks size={15} />}
          actions={
            <div className="flex items-center gap-2">
              <Select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="min-w-[170px]">
                <option value="">All villages</option>
                {sites.map((s) => (
                  <option key={s.projectId} value={s.projectId}>{s.name}</option>
                ))}
              </Select>
              <Select value={filterComponent} onChange={(e) => setFilterComponent(e.target.value)} className="min-w-[180px]">
                <option value="">All components</option>
                {COMPONENT_FILTERS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </Select>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--border-default)]">
                  <Th>Filed</Th>
                  <Th>Village</Th>
                  <Th>Component</Th>
                  <Th>Condition</Th>
                  <Th>Photos</Th>
                  <Th>Engineer</Th>
                  <Th>Notes</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {loading ? (
                  <tr><td colSpan={8} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td></tr>
                ) : scopedSubmissions.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-8">
                    <EmptyState
                      icon={ListChecks}
                      title="Nothing filed yet"
                      description="Components appear here as engineers file them, one at a time."
                    />
                  </td></tr>
                ) : (
                  scopedSubmissions.map((x, i) => (
                    <tr key={`${x.visitId}-${x.component}-${i}`} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap text-[12.5px]">{fmtDate(x.submittedAt)}</td>
                      <td className="px-5 py-3 font-medium text-[var(--fg-primary)]">{x.projectName || "—"}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)]">{x.componentLabel}</td>
                      <td className="px-5 py-3">
                        <Badge tone={CONDITION_TONE[x.condition] || "neutral"}>
                          {CONDITION_LABEL[x.condition] || x.condition}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-[var(--fg-secondary)]">{x.photoCount}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)]">{x.engineerName || "—"}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)] max-w-[280px] truncate" title={x.notes || ""}>
                        {x.notes || "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setOpenVisit(x.visitId)}>Open</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      )}

      {openVisit && (
        <VisitEditor
          visitId={openVisit}
          isAdmin={isAdmin}
          onClose={() => setOpenVisit(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-5 py-2.5 text-label">{children}</th>;
}

function Stat({ label, value, tone }) {
  const color =
    tone === "danger" ? "text-[var(--brand)]"
    : tone === "warning" ? "text-[var(--warning-fg)]"
    : tone === "success" ? "text-[var(--success-fg)]"
    : "text-[var(--fg-primary)]";
  return (
    <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)]">
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--text-quaternary)]">{label}</div>
      <div className={`text-[22px] font-semibold tracking-tight mt-1 ${color}`}>{value}</div>
    </div>
  );
}
