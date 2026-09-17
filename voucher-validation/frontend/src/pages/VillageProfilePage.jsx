// src/pages/VillageProfilePage.jsx
// A village as a THING, not as a stack of reports.
//
// The report view answers "what happened on this attendance". This answers the
// question people actually ask about a site: what condition is the gear in
// right now, when was that last established, and where is the paperwork. Each
// component is a tab; its current state is the most recent filed inspection,
// with the photographs from that same visit so the picture always matches the
// condition beside it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft, RefreshCw, FileText, Upload, Download, Trash2, Camera,
  AlertTriangle, CheckCircle2, CircleDashed, MapPin, Clock, History,
  Send, Lock, Save, ShieldCheck, CalendarCheck, CalendarClock, ListChecks, X,
} from "lucide-react";
import { maintenanceApi, openDocument, downscaleImage } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import {
  PageShell, PageHeader, KpiGrid, StatCard, Panel, Tabs, Segmented,
  DataTable, Th, Td, StatusPill, ObjectTile,
  Button, EmptyState, Field, Input, Select, Textarea, Modal,
} from "../components/ui";
import PhotoThumb from "../components/maintenance/PhotoThumb";

const COND = {
  ok:        { label: "OK",              tone: "success", tile: "green",  Icon: CheckCircle2 },
  attention: { label: "Needs attention", tone: "warning", tile: "orange", Icon: AlertTriangle },
  faulty:    { label: "Faulty",          tone: "danger",  tile: "red",    Icon: AlertTriangle },
  na:        { label: "N/A",             tone: "neutral", tile: "slate",  Icon: CircleDashed },
};

const CONDITION_OPTIONS = ["ok", "attention", "faulty", "na"].map((v) => ({ value: v, label: COND[v].label }));

// Short names for the tab strip only. The server's full component labels head
// every card and report; these exist purely so eight tabs fit on one line.
const TAB_LABELS = {
  gateway: "Gateway",
  aps: "Access points",
  starlink: "Starlink",
  power: "Power",
  enclosure: "Enclosure",
  site: "Site & safety",
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
// On a phone the condition picker spans its field with thumb-height options;
// from sm up it is the compact pill it always was.
const PHONE_SEGMENTED = "max-sm:flex max-sm:w-full max-sm:[&>button]:grow max-sm:[&>button]:justify-center";

const fmtBytes = (n) => {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
};

/** The health dot that rides on each component tab. */
function ConditionDot({ condition, never }) {
  const bg = never
    ? "bg-[var(--fg-subtle)]"
    : condition === "ok"
      ? "bg-[var(--success-fg)]"
      : condition === "attention"
        ? "bg-[var(--warning-fg)]"
        : condition === "faulty"
          ? "bg-[var(--danger-fg)]"
          : "bg-[var(--fg-subtle)]";
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${bg}`}
      title={never ? "Never inspected" : COND[condition]?.label || "Not inspected"}
    />
  );
}

/** A component's current condition, said the same way on every surface. */
function ComponentPill({ component: c }) {
  if (c.neverInspected) return <StatusPill tone="neutral">Never inspected</StatusPill>;
  const C = COND[c.condition];
  return <StatusPill tone={C?.tone || "neutral"}>{C?.label || c.condition}</StatusPill>;
}

export default function VillageProfilePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isEngineer } = useAuth();
  // Admins and engineers both service; nobody else reaches this route.
  const canService = isAdmin || isEngineer;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("overview");
  const [lightbox, setLightbox] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const tabsRef = useRef(null);

  // On a phone the tabs sit a screen and a half down, under the header and the
  // service tiles. Opening a component from a card further down the overview
  // would otherwise leave the reader looking at the bottom of a shorter page,
  // with the tab they opened scrolled away above them. Only then, and only on
  // a phone, bring the strip back to the top.
  const selectTab = useCallback((next) => {
    setTab(next);
    const el = tabsRef.current;
    if (!el || !window.matchMedia?.("(max-width: 639px)").matches) return;
    window.requestAnimationFrame(() => {
      const scroller = el.closest("main");
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      if (el.getBoundingClientRect().top < top) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setData(await maintenanceApi.villageProfile(projectId));
    } catch (e) {
      // Reachable by typing a URL: villages are scoped now, and one that was
      // never assigned to this account answers "no such village". Held in
      // state rather than only toasted — a toast disappears and leaves a page
      // that looks broken rather than one that says what happened.
      setData(null);
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const components = data?.components || [];
  const active = useMemo(() => components.find((c) => c.key === tab), [components, tab]);
  const svc = data?.service;

  // One tab per line item, plus the paperwork. The dot carries the component's
  // condition so the strip doubles as the village's status at a glance — which
  // is the whole reason this page is tabbed rather than stacked.
  //
  // The strip uses a short label: eight full names ("Power (solar / battery /
  // PSU)") overrun the content width and clip the last tab. The full name is
  // never lost — it heads the card the tab opens, and the overview grid.
  const tabs = [
    { value: "overview", label: "Overview" },
    ...components.map((c) => ({
      value: c.key,
      label: TAB_LABELS[c.key] || c.label,
      icon: <ConditionDot condition={c.condition} never={c.neverInspected} />,
    })),
    { value: "documents", label: "Documents", count: data?.documents?.length || 0 },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Village profile"
        title={data?.village?.name || "…"}
        subtitle={data?.village?.hostname || ""}
        icon={<MapPin size={22} />}
        tone="navy"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/maintenance")} iconLeft={<ArrowLeft size={14} />}>
              All villages
            </Button>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading} iconLeft={<RefreshCw size={14} />}>
              Refresh
            </Button>
          </>
        }
      />

      {/* Service standing, stated once at the top rather than inferred from the tabs. */}
      {svc && (
        <KpiGrid>
          <StatCard
            label="Service status"
            value={svc.neverServiced ? "Never serviced" : svc.overdue ? "Overdue" : "In window"}
            sub={
              svc.neverServiced
                ? "no report has ever been filed"
                : svc.overallCondition
                  ? `last overall: ${COND[svc.overallCondition]?.label || svc.overallCondition}`
                  : `${svc.intervalMonths}-month cycle`
            }
            icon={svc.neverServiced || svc.overdue ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
            color={svc.neverServiced || svc.overdue ? "red" : "green"}
          />
          <StatCard
            label="Last serviced"
            value={fmtDate(svc.lastVisitDate)}
            sub={svc.lastEngineer || ""}
            icon={<CalendarCheck size={18} />}
            color="navy"
          />
          <StatCard
            label="Next due"
            value={svc.neverServiced ? "—" : fmtDate(svc.nextDue)}
            sub={`every ${svc.intervalMonths} months`}
            icon={<CalendarClock size={18} />}
            color="indigo"
          />
          <StatCard
            label="Components inspected"
            value={`${data.summary.inspected} / ${data.summary.total}`}
            sub={
              data.summary.faulty
                ? `${data.summary.faulty} faulty`
                : data.summary.attention
                  ? `${data.summary.attention} need attention`
                  : "all healthy"
            }
            icon={<ListChecks size={18} />}
            color={data.summary.faulty ? "red" : data.summary.attention ? "orange" : "green"}
          />
        </KpiGrid>
      )}

      <div ref={tabsRef} className="scroll-mt-3">
        <Tabs tabs={tabs} value={tab} onChange={selectTab} variant="underline" size="sm" />
      </div>

      {loading ? (
        <Panel padding={false}>
          <div className="py-16 text-center text-[13px] text-[var(--fg-muted)]">Loading…</div>
        </Panel>
      ) : err ? (
        <Panel padding={false}>
          <EmptyState
            icon={AlertTriangle}
            title="This village is not on your list"
            description={`${err} If you have been sent to this site, ask an administrator to add it to your account.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate("/maintenance")} iconLeft={<ArrowLeft size={14} />}>
                Back to villages
              </Button>
            }
          />
        </Panel>
      ) : tab === "overview" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {components.map((c) => {
            const C = COND[c.condition];
            const CardIcon = c.neverInspected ? CircleDashed : C?.Icon || CircleDashed;
            return (
              /* The card body is the button and the photo strip is its sibling:
                 a thumbnail is itself a button, and nesting one inside another
                 is invalid markup that swallows the inner click. */
              <div
                key={c.key}
                className="group flex flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] transition-[box-shadow,border-color] duration-200 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-card-hover)]"
              >
                <button
                  onClick={() => selectTab(c.key)}
                  className="text-left p-4 focus-ring rounded-t-xl"
                  title={`Open ${c.label}`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ObjectTile tone={c.neverInspected ? "slate" : C?.tile || "slate"} size="sm">
                        <CardIcon size={15} />
                      </ObjectTile>
                      <span className="text-[13.5px] font-semibold text-[var(--fg-primary)] truncate max-sm:whitespace-normal font-display group-hover:text-[var(--brand)] transition-colors">
                        {c.label}
                      </span>
                    </div>
                    <ComponentPill component={c} />
                  </div>
                  <div className="mt-2.5 text-[11.5px] text-[var(--fg-muted)] flex items-center gap-1.5">
                    <Clock size={11} />
                    {c.neverInspected ? "No inspection on record" : `${fmtDate(c.lastInspected)} · ${c.engineerName || "—"}`}
                  </div>
                  {c.notes && (
                    <p className="mt-2 text-[12px] text-[var(--fg-secondary)] leading-relaxed line-clamp-2">{c.notes}</p>
                  )}
                </button>

                <div className="mt-auto px-4 pb-4 pt-3 border-t border-[var(--border-subtle)] flex items-center gap-1.5">
                  {c.photos.length === 0 ? (
                    <span className="text-[11px] text-[var(--fg-muted)] flex items-center gap-1.5">
                      <Camera size={11} /> No photos
                    </span>
                  ) : (
                    <>
                      {c.photos.slice(0, 4).map((p) => (
                        <PhotoThumb
                          key={p.id}
                          photoId={p.id}
                          size="xs"
                          onOpen={(url) => setLightbox({ url, caption: c.label })}
                        />
                      ))}
                      {c.photos.length > 4 && (
                        <span className="h-14 px-2 inline-flex items-center rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface)] text-[11px] font-semibold tabular-nums text-[var(--fg-muted)]">
                          +{c.photos.length - 4}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === "documents" ? (
        <DocumentsTab
          projectId={projectId}
          documents={data?.documents || []}
          categories={data?.documentCategories || []}
          isAdmin={isAdmin}
          canUpload={canService}
          onChanged={load}
          uploadOpen={uploadOpen}
          setUploadOpen={setUploadOpen}
        />
      ) : active ? (
        <ComponentTab
          component={active}
          projectId={projectId}
          canService={canService}
          onOpenPhoto={(url, caption) => setLightbox({ url, caption })}
          onChanged={load}
        />
      ) : null}

      {lightbox && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white pointer-coarse:top-[max(0.75rem,env(safe-area-inset-top))] pointer-coarse:right-3 pointer-coarse:p-2.5 pointer-coarse:rounded-full pointer-coarse:bg-black/40"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={22} />
          </button>
          <img src={lightbox.url} alt={lightbox.caption} className="max-h-full max-w-full rounded-xl shadow-[var(--shadow-xl)]" />
          {lightbox.caption && (
            <span className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-[12px] text-white/90 max-sm:max-w-[calc(100%-2rem)] max-sm:truncate max-sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]">
              {lightbox.caption}
            </span>
          )}
        </div>
      )}
    </PageShell>
  );
}

function ComponentTab({ component: c, projectId, canService, onOpenPhoto, onChanged }) {
  const C = COND[c.condition];
  const draft = c.draft;
  // Serviceable unless this component was already filed on the CURRENT open
  // draft. No draft at all means nothing has been started, which is the most
  // serviceable state there is — not a filed one.
  const pending = !draft || draft.pending !== false;
  const [servicing, setServicing] = useState(false);
  const draftPhotos = draft?.photos || [];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={c.label}
        subtitle={c.hint}
        icon={C ? <C.Icon size={15} /> : <CircleDashed size={15} />}
        tone={c.neverInspected ? "slate" : C?.tile || "slate"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ComponentPill component={c} />
            {canService && pending && (
              <Button variant="primary" size="sm" onClick={() => setServicing(true)} iconLeft={<Camera size={14} />}>
                {draft && (draft.condition || draftPhotos.length) ? "Continue inspection" : "Record inspection"}
              </Button>
            )}
          </div>
        }
      >
        {c.neverInspected ? (
          <EmptyState
            icon={CircleDashed}
            title="No inspection on record"
            description={
              canService
                ? "Nothing filed for this component yet. Record one to start."
                : "This component has not been filed at this village yet."
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Provenance for the condition above: three facts, on one line. */}
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-xl overflow-hidden border border-[var(--border-default)] bg-[var(--border-subtle)]">
              <Fact label="Last inspected" value={fmtDate(c.lastInspected)} />
              <Fact label="Engineer" value={c.engineerName || "—"} />
              <Fact label="Visit date" value={fmtDate(c.lastVisitDate)} />
            </dl>

            {c.notes && (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
                <p className="text-label mb-1.5">Engineer's note</p>
                <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap leading-relaxed">{c.notes}</p>
              </div>
            )}

            <div>
              <p className="text-label mb-2.5">Photos from this inspection</p>
              {c.photos.length === 0 ? (
                <span className="text-[12px] text-[var(--fg-muted)]">No photos on this inspection.</span>
              ) : (
                /* The only real imagery in the console, so it gets a composed
                   mosaic rather than a row of stamps: the first frame leads and
                   the rest sit around it. Below three photos the lead frame
                   would just leave a hole in the grid, so it stays a plain row. */
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {c.photos.map((p, i) => (
                    <div
                      key={p.id}
                      className={`relative aspect-square ${i === 0 && c.photos.length >= 3 ? "sm:col-span-2 sm:row-span-2" : ""} ${
                        // Two to a row on a phone: an odd count would strand the
                        // last frame alone, so the first one takes the full row.
                        i === 0 && c.photos.length % 2 === 1 && c.photos.length >= 3 ? "max-sm:col-span-2" : ""
                      }`}
                    >
                      <PhotoThumb
                        photoId={p.id}
                        caption={p.caption}
                        size="fill"
                        onOpen={(url) => onOpenPhoto(url, c.label)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* Work in progress is surfaced on the tab, but editing it happens in the
          modal — the tab stays a view of the village, not a form. */}
      {canService && pending && draft && (draft.condition || draftPhotos.length > 0) && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)]">
          <AlertTriangle size={14} className="text-[var(--warning-fg)] shrink-0" />
          <span className="text-[12.5px] text-[var(--fg-secondary)] min-w-0 flex-1">
            You have an unfiled inspection for this component
            {draft.condition ? ` (${COND[draft.condition]?.label})` : ""}
            {draftPhotos.length ? ` · ${draftPhotos.length} photo${draftPhotos.length === 1 ? "" : "s"}` : ""}.
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setServicing(true)}>
            Open
          </Button>
        </div>
      )}

      {canService && draft && !pending && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--fg-muted)] px-1 max-sm:items-start">
          <Lock size={12} className="text-[var(--success-fg)] shrink-0 max-sm:mt-0.5" />
          Filed on this visit. An admin can reopen it from the report if it needs revising.
        </div>
      )}

      {c.history.length > 1 && (
        <Panel
          title="History"
          subtitle="Every filed inspection of this component, newest first"
          icon={<History size={15} />}
          tone="slate"
          padding={false}
        >
          <DataTable>
            <thead>
              <tr>
                <Th>Filed</Th>
                <Th>Condition</Th>
                <Th>Engineer</Th>
                <Th align="right">Photos</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {c.history.map((h, i) => (
                <tr key={`${h.visitId}-${i}`}>
                  <Td nowrap className="max-sm:font-semibold max-sm:text-[var(--fg-primary)]">{fmtDate(h.submittedAt)}</Td>
                  <Td>
                    <StatusPill tone={COND[h.condition]?.tone || "neutral"}>
                      {COND[h.condition]?.label || h.condition}
                    </StatusPill>
                  </Td>
                  <Td>{h.engineerName || "—"}</Td>
                  <Td align="right" className="tabular-nums">{h.photoCount}</Td>
                  {/* One truncated line in the table; a phone card shows the whole
                      note, left-aligned under its label, or drops an empty one. */}
                  <Td
                    className={`sm:max-w-[320px] sm:truncate max-sm:flex-col max-sm:gap-1! max-sm:text-left! ${h.notes ? "" : "max-sm:hidden!"}`}
                  >
                    <span title={h.notes || ""} className="max-sm:ml-0!">{h.notes || "—"}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {servicing && (
        <ServiceComponentModal
          component={c}
          projectId={projectId}
          onClose={() => setServicing(false)}
          onChanged={onChanged}
          onOpenPhoto={onOpenPhoto}
        />
      )}
    </div>
  );
}

/** One cell of the provenance strip. */
function Fact({ label, value }) {
  return (
    // A phone stacks the three facts, so each is one line — label left, value
    // right — rather than three two-line boxes.
    <div className="bg-[var(--bg-elevated)] px-4 py-3 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-2.5">
      <dt className="text-label">{label}</dt>
      <dd className="text-[13px] font-medium text-[var(--fg-primary)] mt-1 max-sm:mt-0 max-sm:text-right">{value}</dd>
    </div>
  );
}

/**
 * Record one component's inspection. A modal for the same reason the document
 * upload is one: it is a task with a beginning and an end, and it should not
 * turn the village page into a form you have to scroll past to read the site.
 */
function ServiceComponentModal({ component: c, projectId, onClose, onChanged, onOpenPhoto }) {
  const draft = c.draft;
  const [condition, setCondition] = useState(draft?.condition || "");
  const [notes, setNotes] = useState(draft?.notes || "");
  const [photos, setPhotos] = useState(draft?.photos || []);
  const [visitId, setVisitId] = useState(draft?.visitId || null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const canFile = condition === "na" ? notes.trim().length > 0 : Boolean(condition) && photos.length > 0;

  // Every action needs a visit to hang off. createVisit reuses this engineer's
  // open draft for the village, so the visit stays an implementation detail —
  // they service components, not "reports".
  async function ensureVisit() {
    if (visitId) return visitId;
    const r = await maintenanceApi.createVisit({ projectId: Number(projectId) });
    setVisitId(r.visitId);
    return r.visitId;
  }

  async function saveWork(id) {
    await maintenanceApi.updateVisit(id, {
      checks: [{ key: c.key, condition: condition || "na", notes }],
    });
  }

  async function addPhotos(files) {
    if (!files.length) return;
    setUploading(true);
    try {
      const id = await ensureVisit();
      // Save first so a brand-new draft has this component's row before photos
      // attach to it.
      await saveWork(id);
      const added = [];
      for (const file of files) {
        const { mimeType, dataBase64 } = await downscaleImage(file);
        const r = await maintenanceApi.addPhoto(id, { componentKey: c.key, mimeType, dataBase64 });
        added.push({ id: r.photoId, caption: null });
      }
      // Track locally so the modal reflects the upload without a full reload
      // (which would close nothing but would discard unsaved notes).
      setPhotos((p) => [...p, ...added]);
      toast.success(files.length === 1 ? "Photo added" : `${files.length} photos added`);
    } catch (e) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(id) {
    try {
      await maintenanceApi.deletePhoto(id);
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveWork(await ensureVisit());
      toast.success("Saved — you can come back to this");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function file() {
    setBusy(true);
    try {
      const id = await ensureVisit();
      await saveWork(id);
      const r = await maintenanceApi.submitCheck(id, c.key);
      toast.success(
        r.visitFinalised
          ? "Filed — that was the last component, the service is complete."
          : `Filed. ${r.submittedCount} of ${r.totalCount} components done.`,
        { duration: 6000 }
      );
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e.message, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} width="lg">
      <Modal.Header
        eyebrow="Inspection"
        title={c.label}
        subtitle={c.hint}
        icon={Camera}
        onClose={busy ? undefined : onClose}
      />
      <Modal.Body>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addPhotos(f); }}
        />
        <div className="flex flex-col gap-5">
          <Field label="Condition">
            <Segmented options={CONDITION_OPTIONS} value={condition} onChange={setCondition} className={PHONE_SEGMENTED} />
          </Field>

          <Field
            label="Notes"
            hint={condition === "na" ? "Required — say why this does not apply at this village." : "What did you find? Anything replaced or adjusted?"}
          >
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <Field label="Photos" hint="Taken on this visit. Required unless the component is N/A.">
            <div className="flex flex-wrap items-center gap-2.5">
              {photos.map((p) => (
                <PhotoThumb
                  key={p.id}
                  photoId={p.id}
                  onRemove={removePhoto}
                  onOpen={(url) => onOpenPhoto?.(url, c.label)}
                />
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
                loading={uploading}
                iconLeft={!uploading && <Camera size={13} />}
              >
                Add photo
              </Button>
            </div>
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        {/* On a phone: the reason on its own line, both buttons on the row under it. */}
        <span className="mr-auto text-[11.5px] text-[var(--fg-muted)] max-sm:basis-full">
          {canFile
            ? "Filing locks this component as evidence."
            : condition === "na"
              ? "Say why it is not applicable before filing."
              : "Pick a condition and add at least one photo before filing."}
        </span>
        <Button variant="secondary" className="max-sm:grow" onClick={save} loading={busy} disabled={busy} iconLeft={!busy && <Save size={14} />}>
          Save for later
        </Button>
        <Button variant="primary" className="max-sm:grow" onClick={file} loading={busy} disabled={busy || !canFile} iconLeft={!busy && <Send size={14} />}>
          File this component
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function DocumentsTab({ projectId, documents, categories, isAdmin, canUpload, onChanged, uploadOpen, setUploadOpen }) {
  const grouped = useMemo(() => {
    const m = {};
    for (const d of documents) (m[d.category] ||= []).push(d);
    return m;
  }, [documents]);

  async function remove(d) {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    try {
      await maintenanceApi.deleteDocument(d.id);
      toast.success("Document deleted");
      onChanged();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function open(d) {
    try { await openDocument(d.id); } catch (e) { toast.error("Could not open: " + e.message); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Site documents"
        subtitle="Handover packs, as-builts, warranties and permits — the paperwork that belongs to the village rather than to any one visit."
        icon={<FileText size={15} />}
        tone="navy"
        // Viewers read site paperwork but cannot add to it — the server refuses
        // the upload, so the button is not offered.
        actions={
          canUpload ? (
            <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)} iconLeft={<Upload size={14} />}>
              Upload document
            </Button>
          ) : null
        }
      >
        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description={
              canUpload
                ? "Upload the handover pack, as-built drawings, warranties or permits for this village."
                : "Nothing has been filed for this village yet."
            }
          />
        ) : (
          /* Grouped by category rather than listed flat: the paperwork is looked
             for by kind ("where is the handover pack"), never by date. */
          <div className="flex flex-col gap-6">
            {categories
              .filter((cat) => grouped[cat.key]?.length)
              .map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center gap-3 mb-2.5">
                    <span className="text-label">{cat.label}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-[var(--fg-muted)] rounded-full bg-[var(--bg-surface)] px-1.5">
                      {grouped[cat.key].length}
                    </span>
                    <span className="flex-1 h-px bg-[var(--border-subtle)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    {grouped[cat.key].map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center gap-3 p-3 max-sm:items-start rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-sm)]"
                      >
                        <ObjectTile tone="navy" size="sm">
                          <FileText size={15} />
                        </ObjectTile>
                        {/* A phone wraps the title and file details instead of
                            cutting both to a few characters, and puts the
                            buttons on their own full-width line underneath. */}
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-[var(--fg-primary)] truncate max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] font-display">{d.title}</div>
                          <div className="text-[11.5px] text-[var(--fg-muted)] truncate max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">
                            {d.fileName || "file"} · {fmtBytes(d.bytes)} · {fmtDate(d.uploadedAt)}
                            {d.notes ? ` · ${d.notes}` : ""}
                          </div>
                        </div>
                        <div className="contents max-sm:flex max-sm:w-full max-sm:items-center max-sm:gap-2">
                          <Button variant="secondary" size="sm" className="max-sm:flex-1" onClick={() => open(d)} iconLeft={<Download size={13} />}>
                            Open
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(d)}
                              title="Delete"
                              aria-label={`Delete ${d.title}`}
                              iconLeft={<Trash2 size={13} />}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Panel>

      {uploadOpen && (
        <UploadDocumentModal
          projectId={projectId}
          categories={categories}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function UploadDocumentModal({ projectId, categories, onClose, onDone }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("handover");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return toast.error("Choose a file first");
    setBusy(true);
    try {
      await maintenanceApi.addDocument(projectId, file, {
        category,
        // Default the title to the filename: forcing a title on someone
        // uploading "Handover_Vunisei.pdf" is friction for nothing.
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        notes: notes.trim(),
      });
      toast.success("Document uploaded");
      onDone();
    } catch (e) {
      toast.error(e.message, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} width="md">
      <Modal.Header eyebrow="Site documents" title="Upload a document" icon={Upload} onClose={busy ? undefined : onClose} />
      <Modal.Body>
        <div className="flex flex-col gap-5">
          <Field label="File" hint="PDF, image, Word or Excel. Up to 100 MB.">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-[12.5px] text-[var(--fg-secondary)] max-sm:file:py-2.5 max-sm:file:px-4 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-[var(--border-default)] file:bg-[var(--surface)] file:text-[var(--fg-primary)] file:text-[12px] file:font-semibold"
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Title" hint="Defaults to the file name.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file ? file.name.replace(/\.[^.]+$/, "") : "Handover pack"} />
          </Field>
          <Field label="Notes" hint="Optional — version, who supplied it, what it covers.">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" className="max-sm:flex-1" onClick={submit} loading={busy} disabled={!file || busy}>Upload</Button>
      </Modal.Footer>
    </Modal>
  );
}
