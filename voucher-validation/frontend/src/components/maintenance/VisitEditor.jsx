// src/components/maintenance/VisitEditor.jsx
// One service report: the checklist, notes and photos for a single visit.
//
// Each COMPONENT is filed on its own. An engineer inspects the access points
// today and the gateway when that information is to hand; there is no reason to
// hold seven findings hostage to the last one. Filing a component locks it, and
// the visit finalises by itself once all seven are in — so there is no separate
// "submit the report" step to forget.
//
// Drafts save on demand rather than on every keystroke: these are filed from
// village Wi-Fi, and an autosave firing per character would spend the whole
// visit retrying.

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ClipboardCheck, Camera, Send, Lock, Unlock, Save, AlertTriangle, CheckCircle2,
  X, Check, CircleDashed, Images,
} from "lucide-react";
import { maintenanceApi, downscaleImage } from "../../services/api";
import { Modal, Button, Field, Textarea, Input, StatusPill, ObjectTile, Segmented } from "../ui";
import PhotoThumb from "./PhotoThumb";

const CONDITION_UI = {
  ok:        { label: "OK",              tone: "success", tile: "green",  Icon: CheckCircle2 },
  attention: { label: "Needs attention", tone: "warning", tile: "orange", Icon: AlertTriangle },
  faulty:    { label: "Faulty",          tone: "danger",  tile: "red",    Icon: AlertTriangle },
  // Not every village has every component. N/A is a real finding, but it has to
  // say why — there is no photograph to speak for it.
  na:        { label: "N/A",             tone: "neutral", tile: "slate",  Icon: CircleDashed },
};

const CONDITION_OPTIONS = ["ok", "attention", "faulty", "na"].map((v) => ({
  value: v,
  label: CONDITION_UI[v].label,
}));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

// On a phone the condition picker spans the card and each option is a
// thumb-height target; from sm up it is the compact pill it always was.
const PHONE_SEGMENTED = "max-sm:flex max-sm:w-full max-sm:[&>button]:grow max-sm:[&>button]:justify-center max-sm:[&>button]:h-9";
// Photos are the evidence an engineer is checking before filing, so they are a
// size larger on a phone, where there is no hover to preview them.
const PHONE_THUMB = "max-sm:h-20 max-sm:w-20";

export default function VisitEditor({ visitId, isAdmin, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null); // component key being uploaded
  const [filing, setFiling] = useState(null);      // component key being filed
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

  // Save first: the server validates what it has STORED, not what is on screen,
  // so an unsaved condition or note would be judged against the old values.
  async function fileComponent(key) {
    if (!(await save({ quiet: true }))) return;
    setFiling(key);
    try {
      const r = await maintenanceApi.submitCheck(visitId, key);
      if (r.visitFinalised) {
        toast.success("Last component filed — the report is complete and locked.", { duration: 6000 });
      } else {
        toast.success(`Filed. ${r.submittedCount} of ${r.totalCount} done — still to do: ${r.remaining.join(", ")}`, { duration: 6000 });
      }
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message, { duration: 7000 });
    } finally {
      setFiling(null);
    }
  }

  async function reopenComponent(key) {
    const reason = window.prompt("Why is this component being reopened? (recorded on the report)");
    if (!reason || !reason.trim()) return;
    try {
      await maintenanceApi.reopenCheck(visitId, key, reason.trim());
      toast.success("Component reopened");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
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

  const filedCount = (data?.checks || []).filter((c) => c.status === "submitted").length;
  const totalCount = (data?.checks || []).length;
  const photoTotal =
    (data?.generalPhotos?.length || 0) + (data?.checks || []).reduce((a, c) => a + c.photos.length, 0);
  const progressPct = totalCount ? Math.round((filedCount / totalCount) * 100) : 0;

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
          <div className="py-10 text-center text-[13px] text-[var(--fg-muted)]">Loading…</div>
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

            {readOnly ? (
              <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
                <StatusPill tone={CONDITION_UI[visit.overallCondition]?.tone || "neutral"}>
                  Overall: {CONDITION_UI[visit.overallCondition]?.label || "—"}
                </StatusPill>
                <span className="text-[12.5px] text-[var(--fg-muted)]">
                  Filed {fmtDate(visit.submittedAt)} · {photoTotal} photo{photoTotal === 1 ? "" : "s"}
                </span>
                {visit.reopenReason && (
                  <span className="text-[12.5px] text-[var(--warning-fg)]">
                    Previously reopened: {visit.reopenReason}
                  </span>
                )}
              </div>
            ) : (
              /* Progress is stated once, at the top: an engineer filing component
                 by component needs to know how much of the report is still open
                 without counting locks down the list. */
              <div className="mb-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-label">Components filed</span>
                  <span className="text-[12.5px] font-semibold tabular-nums text-[var(--fg-primary)] font-display">
                    {filedCount} / {totalCount}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-surface-hover)] overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-[var(--success-fg)] transition-[width] duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
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
                {/* On a phone the header's subtitle already names the engineer;
                    a disabled box repeating it is a screen of scroll for nothing. */}
                <Field label="Engineer" className="max-sm:hidden">
                  <Input value={visit?.engineerName || ""} disabled />
                </Field>
              </div>
            )}

            <div className="space-y-3">
              {(data?.checks || []).map((c) => {
                const ui = CONDITION_UI[c.condition];
                const locked = readOnly || c.status === "submitted";
                const CondIcon = ui?.Icon || CircleDashed;
                return (
                  <div
                    key={c.key}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-xs)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0">
                        <ObjectTile tone={ui?.tile || "slate"} size="sm" className="mt-0.5">
                          <CondIcon size={15} />
                        </ObjectTile>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold text-[var(--fg-primary)] flex items-center gap-1.5 font-display">
                            {c.label}
                            {c.status === "submitted" && (
                              <span title={`Filed ${fmtDate(c.submittedAt)}`}>
                                <Lock size={11} className="text-[var(--success-fg)]" />
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-[var(--fg-muted)] mt-0.5">{c.hint}</div>
                          {c.reopenReason && (
                            <div className="text-[11px] text-[var(--warning-fg)] mt-0.5">
                              Reopened: {c.reopenReason}
                            </div>
                          )}
                        </div>
                      </div>
                      {locked ? (
                        <StatusPill tone={ui?.tone || "neutral"}>
                          {ui?.label || "Not inspected"}
                        </StatusPill>
                      ) : (
                        <Segmented
                          size="sm"
                          className={PHONE_SEGMENTED}
                          options={CONDITION_OPTIONS}
                          value={c.condition}
                          onChange={(v) => setCheck(c.key, { condition: v })}
                        />
                      )}
                    </div>

                    {(!locked || c.notes) && (
                      <div className="mt-3">
                        {locked ? (
                          <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap leading-relaxed">{c.notes}</p>
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
                          size="sm"
                          className={PHONE_THUMB}
                          onRemove={locked ? undefined : removePhoto}
                          onOpen={(url) => setLightbox({ url, caption: c.label })}
                        />
                      ))}
                      {!locked && (
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
                      {locked && c.photos.length === 0 && (
                        <span className="text-[11.5px] text-[var(--fg-muted)]">No photo</span>
                      )}

                      {/* On a phone the filing control gets a line of its own:
                          "File this" is the action the card is for. */}
                      <span className="ml-auto flex items-center gap-2 max-sm:ml-0 max-sm:w-full max-sm:justify-between">
                        {c.status === "submitted" ? (
                          <>
                            <span className="text-[11.5px] text-[var(--success-fg)] flex items-center gap-1">
                              <Check size={12} /> Filed {fmtDate(c.submittedAt)}
                            </span>
                            {isAdmin && !readOnly && (
                              <Button variant="ghost" size="sm" onClick={() => reopenComponent(c.key)} iconLeft={<Unlock size={12} />}>
                                Reopen
                              </Button>
                            )}
                          </>
                        ) : (
                          !readOnly && (
                            <Button
                              variant="primary"
                              size="sm"
                              className="max-sm:w-full"
                              onClick={() => fileComponent(c.key)}
                              loading={filing === c.key}
                              disabled={
                                filing === c.key ||
                                (c.condition === "na"
                                  ? !String(c.notes || "").trim()
                                  : c.photos.length === 0)
                              }
                              iconLeft={filing !== c.key && <Send size={12} />}
                              title={
                                c.condition === "na"
                                  ? "Not applicable — say why in the notes"
                                  : "Needs a condition and at least one photo"
                              }
                            >
                              File this
                            </Button>
                          )
                        )}
                      </span>
                      {/* Why "File this" is greyed out. On desktop the button's
                          tooltip says it; a finger never hovers, so a phone
                          gets the reason in words under the button. */}
                      {!locked && filing !== c.key &&
                        (c.condition === "na" ? !String(c.notes || "").trim() : c.photos.length === 0) && (
                          <span className="w-full text-center text-[11.5px] text-[var(--fg-muted)] sm:hidden">
                            {c.condition === "na"
                              ? "Say why it is not applicable in the notes to file it."
                              : "Add at least one photo to file this."}
                          </span>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              <Field label="Overall summary" hint={readOnly ? undefined : "Anything the site needs, follow-up required, parts to order."}>
                {readOnly ? (
                  <p className="text-[12.5px] text-[var(--fg-secondary)] whitespace-pre-wrap leading-relaxed">
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

            {/* General photos are the ones that belong to the visit rather than
                to any one component — site access, the approach road, the mess
                someone left behind. */}
            <div className="mt-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Images size={13} className="text-[var(--fg-muted)]" />
                <span className="text-label">General photos</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(data?.generalPhotos || []).map((p) => (
                  <PhotoThumb
                    key={p.id}
                    photoId={p.id}
                    caption={p.caption}
                    size="sm"
                    className={PHONE_THUMB}
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
                {readOnly && (data?.generalPhotos || []).length === 0 && (
                  <span className="text-[11.5px] text-[var(--fg-muted)]">No general photos</span>
                )}
              </div>
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        {readOnly ? (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)] max-sm:basis-full">
              <Lock size={12} /> Filed reports are locked as evidence
            </span>
            {isAdmin && (
              <Button variant="secondary" className="max-sm:grow" onClick={reopen} iconLeft={<Unlock size={14} />}>
                Reopen report
              </Button>
            )}
            <Button variant="primary" className="max-sm:grow" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            {/* No all-or-nothing step: each component files itself, and the
                report completes when the last one is in. */}
            {/* On a phone: the status on its own line, the two buttons
                sharing the row beneath it. */}
            <span className="mr-auto flex items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)] max-sm:basis-full">
              {filedCount === totalCount ? (
                <>
                  <CheckCircle2 size={12} className="text-[var(--success-fg)]" />
                  All {totalCount} components filed
                </>
              ) : (
                <>
                  <AlertTriangle size={12} className="text-[var(--warning-fg)]" />
                  {filedCount} of {totalCount} components filed — file each one as you go
                </>
              )}
            </span>
            <Button variant="secondary" className="max-sm:grow" onClick={() => save()} loading={saving} iconLeft={!saving && <Save size={14} />}>
              Save draft
            </Button>
            <Button variant="primary" className="max-sm:grow" onClick={onClose}>Done for now</Button>
          </>
        )}
      </Modal.Footer>

      {lightbox && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white pointer-coarse:top-[max(0.75rem,env(safe-area-inset-top))] pointer-coarse:right-3 pointer-coarse:p-2.5 pointer-coarse:rounded-full pointer-coarse:bg-black/40"
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
