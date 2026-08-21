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
} from "lucide-react";
import { maintenanceApi, openDocument } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { PageHeader, Panel, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal } from "../components/ui";
import PhotoThumb from "../components/maintenance/PhotoThumb";

const COND = {
  ok:        { label: "OK",              tone: "success", Icon: CheckCircle2 },
  attention: { label: "Needs attention", tone: "warning", Icon: AlertTriangle },
  faulty:    { label: "Faulty",          tone: "danger",  Icon: AlertTriangle },
  na:        { label: "N/A",             tone: "neutral", Icon: CircleDashed },
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtBytes = (n) => {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
};

export default function VillageProfilePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isEngineer } = useAuth();
  // Admins and engineers both service; nobody else reaches this route.
  const canService = isAdmin || isEngineer;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [lightbox, setLightbox] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await maintenanceApi.villageProfile(projectId));
    } catch (e) {
      toast.error("Could not load that village: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const components = data?.components || [];
  const active = useMemo(() => components.find((c) => c.key === tab), [components, tab]);
  const svc = data?.service;

  const tabs = [
    { key: "overview", label: "Overview" },
    ...components.map((c) => ({ key: c.key, label: c.label, condition: c.condition, never: c.neverInspected })),
    { key: "documents", label: "Documents", count: data?.documents?.length || 0 },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Village profile"
        title={data?.village?.name || "…"}
        subtitle={data?.village?.hostname || ""}
        icon={<MapPin size={20} />}
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
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Service status"
            value={svc.neverServiced ? "Never serviced" : svc.overdue ? "Overdue" : "In window"}
            tone={svc.neverServiced || svc.overdue ? "danger" : "success"} />
          <Tile label="Last serviced" value={fmtDate(svc.lastVisitDate)} sub={svc.lastEngineer || ""} />
          <Tile label="Next due" value={svc.neverServiced ? "—" : fmtDate(svc.nextDue)} sub={`every ${svc.intervalMonths} months`} />
          <Tile label="Components inspected"
            value={`${data.summary.inspected} / ${data.summary.total}`}
            sub={data.summary.faulty ? `${data.summary.faulty} faulty` : data.summary.attention ? `${data.summary.attention} need attention` : "all healthy"}
            tone={data.summary.faulty ? "danger" : data.summary.attention ? "warning" : "success"} />
        </div>
      )}

      {/* Tabs: one per line item, plus the paperwork. */}
      <div className="mt-5 flex flex-wrap items-center gap-1 rounded-md p-1 bg-[var(--surface-raised)] border border-[var(--border-default)]">
        {tabs.map((t) => {
          const C = t.condition ? COND[t.condition] : null;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "h-7 px-3 text-[12px] font-medium rounded transition-colors inline-flex items-center gap-1.5 " +
                (tab === t.key
                  ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
              }
            >
              {t.key !== "overview" && t.key !== "documents" && (
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (t.never ? "bg-[var(--text-quaternary)]"
                      : t.condition === "ok" ? "bg-[var(--success-fg)]"
                      : t.condition === "attention" ? "bg-[var(--warning-fg)]"
                      : t.condition === "faulty" ? "bg-[var(--brand)]"
                      : "bg-[var(--text-quaternary)]")
                  }
                  title={t.never ? "Never inspected" : COND[t.condition]?.label}
                />
              )}
              {t.label}
              {t.count != null && <span className="text-[var(--text-quaternary)]">({t.count})</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="mt-5 p-10 text-center text-[var(--fg-muted)]">Loading…</div>
      ) : tab === "overview" ? (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {components.map((c) => {
            const C = COND[c.condition];
            return (
              <button
                key={c.key}
                onClick={() => setTab(c.key)}
                className="text-left p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)] hover:border-[var(--brand)] transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">{c.label}</div>
                  {c.neverInspected ? (
                    <Badge tone="neutral">Never inspected</Badge>
                  ) : (
                    <Badge tone={C?.tone || "neutral"}>{C?.label || c.condition}</Badge>
                  )}
                </div>
                <div className="mt-2 text-[11.5px] text-[var(--fg-muted)] flex items-center gap-1.5">
                  <Clock size={11} />
                  {c.neverInspected ? "No inspection on record" : `${fmtDate(c.lastInspected)} · ${c.engineerName || "—"}`}
                </div>
                {c.notes && (
                  <p className="mt-2 text-[12px] text-[var(--fg-secondary)] line-clamp-2">{c.notes}</p>
                )}
                <div className="mt-3 flex items-center gap-1.5">
                  {c.photos.slice(0, 4).map((p) => (
                    <PhotoThumb key={p.id} photoId={p.id} onOpen={(url) => setLightbox({ url, caption: c.label })} />
                  ))}
                  {c.photos.length === 0 && (
                    <span className="text-[11px] text-[var(--fg-muted)] flex items-center gap-1">
                      <Camera size={11} /> No photos
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : tab === "documents" ? (
        <DocumentsTab
          projectId={projectId}
          documents={data?.documents || []}
          categories={data?.documentCategories || []}
          isAdmin={isAdmin}
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
          <img src={lightbox.url} alt={lightbox.caption} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function ComponentTab({ component: c, projectId, canService, onOpenPhoto, onChanged }) {
  const C = COND[c.condition];
  const draft = c.draft;
  // Serviceable unless this component was already filed on the CURRENT open
  // draft. No draft at all means nothing has been started, which is the most
  // serviceable state there is — not a filed one.
  const pending = !draft || draft.pending !== false;
  const [condition, setCondition] = useState(draft?.condition || "");
  const [notes, setNotes] = useState(draft?.notes || "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Re-seed when the tab switches to a different component.
  useEffect(() => {
    setCondition(c.draft?.condition || "");
    setNotes(c.draft?.notes || "");
  }, [c.key, c.draft?.condition, c.draft?.notes]);

  const draftPhotos = draft?.photos || [];
  const canFile = condition === "na" ? notes.trim().length > 0 : condition && draftPhotos.length > 0;

  // Every action needs a visit to hang off. createVisit reuses the engineer's
  // open draft for this village, so the visit stays an implementation detail —
  // the engineer services components, not "reports".
  async function ensureVisit() {
    if (draft?.visitId) return draft.visitId;
    const r = await maintenanceApi.createVisit({ projectId: Number(projectId) });
    return r.visitId;
  }

  async function saveWork(visitId) {
    await maintenanceApi.updateVisit(visitId, {
      checks: [{ key: c.key, condition: condition || "na", notes }],
    });
  }

  async function addPhotos(files) {
    if (!files.length) return;
    setUploading(true);
    try {
      const visitId = await ensureVisit();
      // Save first so a brand-new draft has this component's row before the
      // photos attach to it.
      await saveWork(visitId);
      for (const file of files) {
        const { mimeType, dataBase64 } = await downscaleImage(file);
        await maintenanceApi.addPhoto(visitId, { componentKey: c.key, mimeType, dataBase64 });
      }
      toast.success(files.length === 1 ? "Photo added" : `${files.length} photos added`);
      onChanged();
    } catch (e) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveWork(await ensureVisit());
      toast.success("Saved");
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function file() {
    setBusy(true);
    try {
      const visitId = await ensureVisit();
      await saveWork(visitId);
      const r = await maintenanceApi.submitCheck(visitId, c.key);
      toast.success(
        r.visitFinalised
          ? "Filed — that was the last component, the service is complete."
          : `Filed. ${r.submittedCount} of ${r.totalCount} components done.`,
        { duration: 6000 }
      );
      onChanged();
    } catch (e) {
      toast.error(e.message, { duration: 7000 });
    } finally {
      setBusy(false);
    }
  }

  async function removeDraftPhoto(id) {
    try {
      await maintenanceApi.deletePhoto(id);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    }
  }
  return (
    <div className="mt-5 space-y-4">
      <Panel
        title={c.label}
        subtitle={c.hint}
        icon={C ? <C.Icon size={15} /> : <CircleDashed size={15} />}
        actions={
          c.neverInspected ? (
            <Badge tone="neutral">Never inspected</Badge>
          ) : (
            <Badge tone={C?.tone || "neutral"}>{C?.label || c.condition}</Badge>
          )
        }
      >
        {c.neverInspected ? (
          <EmptyState
            icon={CircleDashed}
            title="No inspection on record"
            description={
              canService
                ? "Nothing filed for this component yet. Record it below."
                : "This component has not been filed at this village yet."
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
              <span className="text-[var(--fg-muted)]">Last inspected <span className="text-[var(--fg-primary)]">{fmtDate(c.lastInspected)}</span></span>
              <span className="text-[var(--fg-muted)]">Engineer <span className="text-[var(--fg-primary)]">{c.engineerName || "—"}</span></span>
              <span className="text-[var(--fg-muted)]">Visit date <span className="text-[var(--fg-primary)]">{fmtDate(c.lastVisitDate)}</span></span>
            </div>
            {c.notes && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-3">
                <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap">{c.notes}</p>
              </div>
            )}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-quaternary)] mb-2">
                Photos from this inspection
              </div>
              <div className="flex flex-wrap gap-2">
                {c.photos.length === 0 ? (
                  <span className="text-[12px] text-[var(--fg-muted)]">No photos on this inspection.</span>
                ) : (
                  c.photos.map((p) => (
                    <PhotoThumb key={p.id} photoId={p.id} caption={p.caption} onOpen={(url) => onOpenPhoto(url, c.label)} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {canService && pending && (
        <Panel
          title="Service this component"
          subtitle="Record what you found and file it. Each component files on its own — you do not have to do them all in one go."
          icon={<Camera size={15} />}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addPhotos(f); }}
          />
          <div className="space-y-4">
            <Field label="Condition">
              <div className="inline-flex rounded-md p-0.5 bg-[var(--surface-sunken)] border border-[var(--border-default)]">
                {["ok", "attention", "faulty", "na"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCondition(v)}
                    className={
                      "h-8 px-3 text-[12px] font-medium rounded transition-colors " +
                      (condition === v
                        ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
                    }
                  >
                    {COND[v].label}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Notes"
              hint={condition === "na" ? "Required — say why this does not apply at this village." : "What did you find? Anything replaced or adjusted?"}
            >
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            <Field label="Photos" hint="Taken on this visit. Required unless the component is N/A.">
              <div className="flex flex-wrap items-center gap-2">
                {draftPhotos.map((p) => (
                  <PhotoThumb key={p.id} photoId={p.id} onRemove={removeDraftPhoto} onOpen={(url) => onOpenPhoto(url, c.label)} />
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

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-default)] pt-4">
              <span className="text-[11.5px] text-[var(--fg-muted)]">
                {canFile
                  ? "Ready to file. Filing locks this component as evidence."
                  : condition === "na"
                    ? "Say why it is not applicable before filing."
                    : "Pick a condition and add at least one photo before filing."}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={save} loading={busy} disabled={busy} iconLeft={!busy && <Save size={14} />}>
                  Save
                </Button>
                <Button variant="primary" onClick={file} loading={busy} disabled={busy || !canFile} iconLeft={!busy && <Send size={14} />}>
                  File this component
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {canService && draft && !pending && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
          <Lock size={12} className="text-[var(--success-fg)]" />
          Filed on this visit. An admin can reopen it from the report if it needs revising.
        </div>
      )}

      {c.history.length > 1 && (
        <Panel title="History" subtitle="Every filed inspection of this component, newest first" icon={<History size={15} />} padding={false}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="px-5 py-2.5 text-label">Filed</th>
                <th className="px-5 py-2.5 text-label">Condition</th>
                <th className="px-5 py-2.5 text-label">Engineer</th>
                <th className="px-5 py-2.5 text-label">Photos</th>
                <th className="px-5 py-2.5 text-label">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {c.history.map((h, i) => (
                <tr key={`${h.visitId}-${i}`}>
                  <td className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap">{fmtDate(h.submittedAt)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={COND[h.condition]?.tone || "neutral"}>{COND[h.condition]?.label || h.condition}</Badge>
                  </td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">{h.engineerName || "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-[var(--fg-secondary)]">{h.photoCount}</td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)] max-w-[320px] truncate" title={h.notes || ""}>{h.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function DocumentsTab({ projectId, documents, categories, isAdmin, onChanged, uploadOpen, setUploadOpen }) {
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
    <div className="mt-5 space-y-4">
      <Panel
        title="Site documents"
        subtitle="Handover packs, as-builts, warranties and permits — the paperwork that belongs to the village rather than to any one visit."
        icon={<FileText size={15} />}
        actions={
          <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)} iconLeft={<Upload size={14} />}>
            Upload document
          </Button>
        }
      >
        {documents.length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" description="Upload the handover pack, as-built drawings, warranties or permits for this village." />
        ) : (
          <div className="space-y-5">
            {categories
              .filter((cat) => grouped[cat.key]?.length)
              .map((cat) => (
                <div key={cat.key}>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--text-quaternary)] mb-2">
                    {cat.label} ({grouped[cat.key].length})
                  </div>
                  <div className="space-y-1.5">
                    {grouped[cat.key].map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)]"
                      >
                        <FileText size={16} className="text-[var(--fg-muted)] shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[var(--fg-primary)] truncate">{d.title}</div>
                          <div className="text-[11.5px] text-[var(--fg-muted)]">
                            {d.fileName || "file"} · {fmtBytes(d.bytes)} · {fmtDate(d.uploadedAt)}
                            {d.notes ? ` · ${d.notes}` : ""}
                          </div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => open(d)} iconLeft={<Download size={13} />}>
                          Open
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="sm" onClick={() => remove(d)} title="Delete" iconLeft={<Trash2 size={13} />} />
                        )}
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
        <div className="space-y-4">
          <Field label="File" hint="PDF, image, Word or Excel. Up to 100 MB.">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-[12.5px] text-[var(--fg-secondary)] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[var(--border-default)] file:bg-[var(--surface-raised)] file:text-[var(--fg-primary)] file:text-[12px]"
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
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!file || busy}>Upload</Button>
      </Modal.Footer>
    </Modal>
  );
}

function Tile({ label, value, sub, tone }) {
  const color =
    tone === "danger" ? "text-[var(--brand)]"
    : tone === "warning" ? "text-[var(--warning-fg)]"
    : tone === "success" ? "text-[var(--success-fg)]"
    : "text-[var(--fg-primary)]";
  return (
    <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)]">
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--text-quaternary)]">{label}</div>
      <div className={`text-[17px] font-semibold tracking-tight mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--fg-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}
