// src/components/maintenance/VisitEditor.jsx
// One service report: the checklist, notes and photos for a single visit.
//
// Two modes, from the same component, because they are the same document:
//   draft     — the engineer fills it in and files it
//   submitted — read-only evidence; an admin may reopen it with a reason
//
// Drafts save on demand rather than on every keystroke: these are filed from
// village Wi-Fi, and an autosave firing per character would spend the whole
// visit retrying.

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ClipboardCheck, Camera, Send, Lock, Unlock, Save, AlertTriangle, CheckCircle2, X,
} from "lucide-react";
import { maintenanceApi, downscaleImage } from "../../services/api";
import { Modal, Button, Badge, Field, Textarea, Input } from "../ui";
import PhotoThumb from "./PhotoThumb";

const CONDITION_UI = {
  ok:        { label: "OK",             tone: "success", cls: "bg-[var(--success-fg)]" },
  attention: { label: "Needs attention", tone: "warning", cls: "bg-[var(--warning-fg)]" },
  faulty:    { label: "Faulty",          tone: "danger",  cls: "bg-[var(--brand)]" },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function VisitEditor({ visitId, isAdmin, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(null); // component key being uploaded
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);
  const pendingComponent = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await maintenanceApi.visit(visitId));
    } catch (e) {
      toast.error(e.message);
      onClose?.();
    } finally {
      setLoading(false);
    }
  }, [visitId, onClose]);

  useEffect(() => { load(); }, [load]);

  const visit = data?.visit;
  const readOnly = visit?.status === "submitted";

  function setCheck(key, patch) {
    setData((d) => ({
      ...d,
      checks: d.checks.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  }

  async function save({ quiet = false } = {}) {
    setSaving(true);
    try {
      await maintenanceApi.updateVisit(visitId, {
        visitDate: visit.visitDate ? String(visit.visitDate).slice(0, 10) : undefined,
        summary: visit.summary || "",
        checks: data.checks.map((c) => ({ key: c.key, condition: c.condition, notes: c.notes })),
      });
      if (!quiet) toast.success("Saved");
      onChanged?.();
      return true;
    } catch (e) {
      toast.error("Could not save: " + e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function pickPhoto(componentKey) {
    pendingComponent.current = componentKey;
    fileRef.current?.click();
  }

  async function onFile(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const componentKey = pendingComponent.current;
    setUploading(componentKey || "__general__");
    try {
      for (const file of files) {
        // Downscaled in the browser: a raw phone photo is several MB and these
        // are uploaded from the village, not the office.
        const { mimeType, dataBase64 } = await downscaleImage(file);
        await maintenanceApi.addPhoto(visitId, { componentKey, mimeType, dataBase64 });
      }
      toast.success(files.length === 1 ? "Photo added" : `${files.length} photos added`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(null);
    }
  }

  async function removePhoto(photoId) {
    try {
      await maintenanceApi.deletePhoto(photoId);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function submit() {
    // Save first: the server validates what it has stored, not what is on screen.
    if (!(await save({ quiet: true }))) return;
    setSubmitting(true);
    try {
      const r = await maintenanceApi.submitVisit(visitId);
      toast.success(`Report filed — overall condition: ${CONDITION_UI[r.overallCondition]?.label || r.overallCondition}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  async function reopen() {
    const reason = window.prompt("Why is this report being reopened? (recorded on the report)");
    if (!reason || !reason.trim()) return;
    try {
      await maintenanceApi.reopenVisit(visitId, reason.trim());
      toast.success("Report reopened");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const unanswered = (data?.checks || []).filter((c) => c.condition === "na").length;
  const photoTotal =
    (data?.generalPhotos?.length || 0) + (data?.checks || []).reduce((a, c) => a + c.photos.length, 0);

  return (
    <Modal open onClose={onClose} width="xl">
      <Modal.Header
        eyebrow={visit?.projectName || "Village"}
        title={readOnly ? "Service report" : "Service report (draft)"}
        subtitle={
          visit
            ? `${fmtDate(visit.visitDate)} · ${visit.engineerName || "unknown engineer"}${
                readOnly ? " · filed" : ""
              }`
            : "Loading…"
        }
        icon={ClipboardCheck}
        onClose={onClose}
      />
      <Modal.Body>
        {loading ? (
          <div className="py-10 text-center text-[var(--fg-muted)]">Loading…</div>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={onFile}
            />

            {readOnly && (
              <div className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px]">
                <Badge tone={CONDITION_UI[visit.overallCondition]?.tone || "neutral"}>
                  Overall: {CONDITION_UI[visit.overallCondition]?.label || "—"}
                </Badge>
                <span className="text-[var(--fg-muted)]">
                  Filed {fmtDate(visit.submittedAt)} · {photoTotal} photo{photoTotal === 1 ? "" : "s"}
                </span>
                {visit.reopenReason && (
                  <span className="text-[var(--warning-fg)]">
                    Previously reopened: {visit.reopenReason}
                  </span>
                )}
              </div>
            )}

            {!readOnly && (
              <div className="grid sm:grid-cols-2 gap-4 mb-5">
                <Field label="Date of visit" htmlFor="visit-date">
                  <Input
                    id="visit-date"
                    type="date"
                    value={visit?.visitDate ? String(visit.visitDate).slice(0, 10) : ""}
                    onChange={(e) => setData((d) => ({ ...d, visit: { ...d.visit, visitDate: e.target.value } }))}
                  />
                </Field>
                <Field label="Engineer">
                  <Input value={visit?.engineerName || ""} disabled />
                </Field>
              </div>
            )}

            <div className="space-y-3">
              {(data?.checks || []).map((c) => (
                <div
                  key={c.key}
                  className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-[var(--fg-primary)]">{c.label}</div>
                      <div className="text-[11.5px] text-[var(--fg-muted)] mt-0.5">{c.hint}</div>
                    </div>
                    {readOnly ? (
                      <Badge tone={CONDITION_UI[c.condition]?.tone || "neutral"}>
                        {CONDITION_UI[c.condition]?.label || "Not inspected"}
                      </Badge>
                    ) : (
                      <div className="inline-flex rounded-md p-0.5 bg-[var(--surface-raised)] border border-[var(--border-default)]">
                        {["ok", "attention", "faulty"].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setCheck(c.key, { condition: v })}
                            className={
                              "h-7 px-2.5 text-[11.5px] font-medium rounded transition-colors " +
                              (c.condition === v
                                ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
                            }
                          >
                            {CONDITION_UI[v].label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {(!readOnly || c.notes) && (
                    <div className="mt-3">
                      {readOnly ? (
                        <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap">{c.notes}</p>
                      ) : (
                        <Textarea
                          rows={2}
                          value={c.notes}
                          placeholder="What did you find? Anything replaced or adjusted?"
                          onChange={(e) => setCheck(c.key, { notes: e.target.value })}
                        />
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {c.photos.map((p) => (
                      <PhotoThumb
                        key={p.id}
                        photoId={p.id}
                        caption={p.caption}
                        onRemove={readOnly ? undefined : removePhoto}
                        onOpen={(url) => setLightbox({ url, caption: c.label })}
                      />
                    ))}
                    {!readOnly && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => pickPhoto(c.key)}
                        loading={uploading === c.key}
                        iconLeft={uploading !== c.key && <Camera size={13} />}
                      >
                        Add photo
                      </Button>
                    )}
                    {readOnly && c.photos.length === 0 && (
                      <span className="text-[11.5px] text-[var(--fg-muted)]">No photo</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <Field label="Overall summary" hint={readOnly ? undefined : "Anything the site needs, follow-up required, parts to order."}>
                {readOnly ? (
                  <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap">
                    {visit?.summary || "—"}
                  </p>
                ) : (
                  <Textarea
                    rows={3}
                    value={visit?.summary || ""}
                    onChange={(e) => setData((d) => ({ ...d, visit: { ...d.visit, summary: e.target.value } }))}
                  />
                )}
              </Field>
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11.5px] text-[var(--fg-muted)] uppercase tracking-wide">General photos</span>
                {(data?.generalPhotos || []).map((p) => (
                  <PhotoThumb
                    key={p.id}
                    photoId={p.id}
                    caption={p.caption}
                    onRemove={readOnly ? undefined : removePhoto}
                    onOpen={(url) => setLightbox({ url, caption: "General" })}
                  />
                ))}
                {!readOnly && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => pickPhoto(null)}
                    loading={uploading === "__general__"}
                    iconLeft={uploading !== "__general__" && <Camera size={13} />}
                  >
                    Add photo
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        {readOnly ? (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
              <Lock size={12} /> Filed reports are locked as evidence
            </span>
            {isAdmin && (
              <Button variant="secondary" onClick={reopen} iconLeft={<Unlock size={14} />}>
                Reopen
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
              {unanswered > 0 ? (
                <>
                  <AlertTriangle size={12} className="text-[var(--warning-fg)]" />
                  {unanswered} component{unanswered === 1 ? "" : "s"} still to inspect
                </>
              ) : photoTotal === 0 ? (
                <>
                  <AlertTriangle size={12} className="text-[var(--warning-fg)]" />
                  At least one photo is needed
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} className="text-[var(--success-fg)]" />
                  Ready to file
                </>
              )}
            </span>
            <Button variant="secondary" onClick={() => save()} loading={saving} iconLeft={!saving && <Save size={14} />}>
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={submitting}
              disabled={submitting || unanswered > 0 || photoTotal === 0}
              iconLeft={!submitting && <Send size={14} />}
            >
              File report
            </Button>
          </>
        )}
      </Modal.Footer>

      {lightbox && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={22} />
          </button>
          <img src={lightbox.url} alt={lightbox.caption} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </Modal>
  );
}
