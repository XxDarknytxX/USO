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
  Wrench, RefreshCw, Plus, ClipboardCheck, AlertTriangle, CheckCircle2, Camera, Lock,
} from "lucide-react";
import { maintenanceApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import { PageHeader, Panel, Button, Badge, EmptyState, Select } from "../components/ui";
import VisitEditor from "../components/maintenance/VisitEditor";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const CONDITION_TONE = { ok: "success", attention: "warning", faulty: "danger" };
const CONDITION_LABEL = { ok: "OK", attention: "Needs attention", faulty: "Faulty" };

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, v] = await Promise.all([
        maintenanceApi.schedule(),
        maintenanceApi.visits({ limit: 100, ...(filterProject ? { projectId: filterProject } : {}) }),
      ]);
      setSchedule(s);
      setVisits(v.visits || []);
    } catch (e) {
      toast.error("Failed to load maintenance: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [filterProject]);

  useEffect(() => { load(); }, [load]);

  const sites = useMemo(
    () => (schedule?.sites || []).filter((s) => isInScope(s.projectId)),
    [schedule, isInScope]
  );
  const scopedVisits = useMemo(
    () => visits.filter((v) => v.projectId == null || isInScope(v.projectId)),
    [visits, isInScope]
  );
  const overdue = useMemo(() => sites.filter((s) => s.overdue), [sites]);

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
                        <Button variant="ghost" size="sm" onClick={() => setOpenVisit(v.id)}>
                          {v.status === "submitted" ? "View" : "Continue"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

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
