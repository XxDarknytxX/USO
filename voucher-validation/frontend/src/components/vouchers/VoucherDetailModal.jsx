// src/components/vouchers/VoucherDetailModal.jsx
//
// The voucher record — inspect, edit, toggle, delete.
//
// This is the most-opened surface in the console, and it used to be one long
// column of labelled rows: six sections, all weighted the same, so finding
// "how much data is left" meant reading the whole thing. It is now a Salesforce
// record page in miniature — an identity header that never scrolls away, then
// grouped panels (usage, customer, timeline, technical, activity) so each
// question has a place to look. Every field and every action is still here;
// they have addresses now.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Ticket,
  Edit3,
  Save,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Wifi,
  HardDrive,
  Users,
  Copy,
  Calendar,
  Shield,
  History,
  User,
  Gauge,
  X,
} from "lucide-react";

import { voucherApi } from "../../services/api";
import StatusBadge from "../shared/StatusBadge";
import {
  Modal,
  ConfirmDialog,
  Field,
  Input,
  Textarea,
  Button,
  IconButton,
  Badge,
  Panel,
  ObjectTile,
  Disclosure,
} from "../ui";

export default function VoucherDetailModal({ uuid, onClose, onRefresh, readOnly = false }) {
  const [voucher, setVoucher] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  async function loadDetail() {
    setLoading(true);
    try {
      const data = await voucherApi.detail(uuid);
      setVoucher(data.voucher);
      setEvents(data.lifecycleEvents || data.events || []);
    } catch (err) {
      toast.error("Failed to load voucher: " + err.message);
      onClose();
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    setEditData({
      first_name: voucher.first_name || "",
      last_name: voucher.last_name || "",
      email: voucher.email || "",
      phone: voucher.phone || "",
      comment: voucher.comment || "",
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditData({});
    setEditing(false);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await voucherApi.update(uuid, editData);
      toast.success("Voucher updated");
      setEditing(false);
      loadDetail();
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    setConfirm({
      title: "Delete voucher",
      message: `Delete ${voucher.voucher_code}? It will be archived and removed from the active list.`,
      confirmLabel: "Delete voucher",
      onConfirm: async () => {
        setConfirm(null);
        try {
          await voucherApi.remove(uuid);
          toast.success("Voucher deleted");
          onClose();
          onRefresh?.();
        } catch (err) {
          toast.error(err.message);
        }
      },
    });
  }

  async function handleToggle() {
    try {
      await voucherApi.toggle(uuid);
      toast.success("Status toggled");
      loadDetail();
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function copyCode() {
    if (!voucher?.voucher_code) return;
    navigator.clipboard.writeText(voucher.voucher_code);
    toast.success("Copied to clipboard");
  }

  /* ----- Loading state --------------------------------------------------- */
  if (loading) {
    return (
      <Modal open onClose={onClose} width="2xl">
        <Modal.Header eyebrow="Voucher" title="Loading…" icon={Ticket} onClose={onClose} />
        <Modal.Body>
          <div className="space-y-4">
            <div className="h-9 w-2/3 rounded-lg skeleton bg-[var(--bg-surface)]" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[86px] rounded-xl skeleton bg-[var(--bg-surface)]" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl skeleton bg-[var(--bg-surface)]" />
              ))}
            </div>
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  if (!voucher) return null;
  const isDisabled = Number(voucher.disable_status) === 1;

  return (
    <>
      <Modal open onClose={onClose} width="2xl">
        {/* ---- Identity: the code, what state it is in, what you can do to it ---- */}
        <div className="relative px-7 pt-6 pb-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <ObjectTile tone="indigo" size="lg" className="mt-0.5 shadow-[var(--shadow-xs)]">
                <Ticket size={20} />
              </ObjectTile>
              <div className="min-w-0">
                <span className="text-label block mb-1">Voucher</span>
                <button
                  onClick={copyCode}
                  title="Copy code"
                  className={
                    "group inline-flex items-center gap-2 -ml-1 px-1 py-0.5 rounded-md max-w-full " +
                    "hover:bg-[var(--bg-surface)] focus-ring transition-colors"
                  }
                >
                  <h2 className="text-[21px] font-semibold tracking-tight text-[var(--fg-primary)] font-mono truncate">
                    {voucher.voucher_code}
                  </h2>
                  <Copy
                    size={14}
                    className="text-[var(--fg-subtle)] group-hover:text-[var(--brand)] transition-colors shrink-0"
                  />
                </button>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <StatusBadge status={voucher.status} />
                  {isDisabled && <Badge tone="danger">Disabled</Badge>}
                  {voucher.package_name && <Badge tone="outline">{voucher.package_name}</Badge>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!readOnly && !editing && (
                <>
                  <IconButton onClick={startEdit} title="Edit" size="sm">
                    <Edit3 size={15} />
                  </IconButton>
                  <IconButton onClick={handleToggle} title={isDisabled ? "Enable" : "Disable"} size="sm">
                    {isDisabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                  </IconButton>
                  <IconButton
                    onClick={handleDelete}
                    title="Delete"
                    size="sm"
                    className="text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </>
              )}
              <IconButton onClick={onClose} title="Close" size="sm">
                <X size={15} />
              </IconButton>
            </div>
          </div>
        </div>

        <Modal.Body className="bg-[var(--bg-base)]">
          <div className="flex flex-col gap-4">
            {/* ---- Usage: what is left, which is why most people open this ---- */}
            <Panel title="Usage" subtitle="Consumption against the plan" icon={<Gauge size={15} />} tone="indigo">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <UsageTile
                  icon={<Clock size={13} />}
                  label="Time used"
                  value={`${formatMin(voucher.used_time)} / ${formatMin(voucher.time_period)}`}
                  pct={pct(voucher.used_time, voucher.time_period)}
                />
                <UsageTile
                  icon={<HardDrive size={13} />}
                  label="Data used"
                  value={`${formatMB(voucher.used_quota)} / ${formatMB(voucher.quota)}`}
                  pct={pct(voucher.used_quota, voucher.quota)}
                />
                <UsageTile
                  icon={<Users size={13} />}
                  label="Clients"
                  value={`${voucher.current_clients} / ${voucher.max_clients}`}
                  pct={pct(voucher.current_clients, voucher.max_clients)}
                />
                <UsageTile
                  icon={<Wifi size={13} />}
                  label="Rate limit"
                  value={`${voucher.download_rate_limit || 0} / ${voucher.upload_rate_limit || 0} Kbps`}
                />
              </div>
            </Panel>

            {/* ---- Customer: the only editable block on the record ---- */}
            <Panel
              title="Customer"
              subtitle={editing ? "Editing — unsaved" : "Details captured against this voucher"}
              icon={<User size={15} />}
              tone="teal"
              actions={
                !readOnly && !editing ? (
                  <Button variant="ghost" size="xs" onClick={startEdit} iconLeft={<Edit3 size={12} />}>
                    Edit
                  </Button>
                ) : null
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="First name"
                  value={voucher.first_name}
                  editing={editing}
                  editValue={editData.first_name || ""}
                  onChange={(v) => setEditData({ ...editData, first_name: v })}
                />
                <EditableField
                  label="Last name"
                  value={voucher.last_name}
                  editing={editing}
                  editValue={editData.last_name || ""}
                  onChange={(v) => setEditData({ ...editData, last_name: v })}
                />
                <EditableField
                  label="Email"
                  value={voucher.email}
                  editing={editing}
                  editValue={editData.email || ""}
                  onChange={(v) => setEditData({ ...editData, email: v })}
                  type="email"
                />
                <EditableField
                  label="Phone"
                  value={voucher.phone}
                  editing={editing}
                  editValue={editData.phone || ""}
                  onChange={(v) => setEditData({ ...editData, phone: v })}
                />
                <div className="md:col-span-2">
                  <EditableField
                    label="Comment"
                    value={voucher.comment}
                    editing={editing}
                    editValue={editData.comment || ""}
                    onChange={(v) => setEditData({ ...editData, comment: v })}
                    multiline
                  />
                </div>
              </div>
            </Panel>

            {/* Timeline and technical sit side by side: both are reference
                detail, and neither deserves a full-width band to itself. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Timeline" icon={<Calendar size={15} />} tone="blue">
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  <TimeRow icon={<Calendar size={12} />} label="Created" value={voucher.create_time} />
                  <TimeRow icon={<Clock size={12} />} label="First login" value={voucher.login_time} />
                  <TimeRow icon={<Shield size={12} />} label="Expires" value={voucher.expiry_time} />
                </div>
              </Panel>

              <Panel title="Technical" icon={<Shield size={15} />} tone="slate">
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  <InfoRow label="UUID" value={voucher.uuid} mono />
                  <InfoRow label="Tenant ID" value={voucher.tenant_id} mono />
                  <InfoRow label="User group" value={voucher.user_group_name || voucher.user_group_id} />
                  <InfoRow label="Bind MAC" value={voucher.bind_mac ? "Yes" : "No"} />
                </div>
              </Panel>
            </div>

            {/* ---- Lifecycle events ---- */}
            {events.length > 0 && (
              <Panel
                title="Activity"
                subtitle={`${events.length} event${events.length === 1 ? "" : "s"}`}
                icon={<History size={15} />}
                tone="slate"
                padding={false}
              >
                <div className="max-h-52 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                  {events.map((evt) => (
                    <div key={evt.id} className="flex items-start gap-2.5 px-5 py-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--tile-indigo)] mt-[7px] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[12.5px] font-semibold text-[var(--fg-secondary)] capitalize">
                          {evt.event_type.replace(/_/g, " ")}
                        </span>
                        {evt.notes && (
                          <span className="text-[12px] text-[var(--fg-muted)] ml-1.5">· {evt.notes}</span>
                        )}
                        <p className="text-[11px] text-[var(--fg-subtle)] mt-0.5 font-mono tabular-nums">
                          {new Date(evt.event_timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Raw payload stays collapsed — it is for the one support call a
                month where the mapped fields are not enough. */}
            <Disclosure summary="Raw JSON">
              <pre className="mt-1 px-3 py-2.5 rounded-lg bg-[var(--bg-surface)] text-[11px] text-[var(--fg-secondary)] overflow-auto max-h-56 font-mono leading-relaxed">
                {JSON.stringify(voucher.raw_data || voucher, null, 2)}
              </pre>
            </Disclosure>
          </div>
        </Modal.Body>

        {/* ---- Footer: edit save/cancel or close ---------------------- */}
        <Modal.Footer>
          {editing ? (
            <>
              <span className="mr-auto text-[12.5px] text-[var(--fg-muted)]">Editing customer details</span>
              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveEdit}
                loading={saving}
                iconLeft={!saving && <Save size={14} />}
              >
                Save changes
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          variant="danger"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/* ------------ Usage tile -------------------------------------------------- */
// The bar only turns red at 90%: red on every tile would make a healthy voucher
// look like an incident.
function UsageTile({ icon, label, value, pct: percent }) {
  const near = percent !== undefined && percent >= 90;
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-label truncate">{label}</span>
        <span className="text-[var(--fg-muted)] shrink-0">{icon}</span>
      </div>
      <p className="text-[14px] font-semibold text-[var(--fg-primary)] font-mono tabular-nums leading-none">
        {value}
      </p>
      {percent !== undefined && (
        <div className="mt-2.5 h-1.5 bg-[var(--bg-surface-hover)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(percent, 100)}%`,
              background: near ? "var(--danger-fg)" : "var(--tile-indigo)",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------ Editable field (read OR edit) ------------------------------ */
function EditableField({ label, value, editing, editValue, onChange, multiline, type = "text" }) {
  if (editing) {
    return (
      <Field label={label}>
        {multiline ? (
          <Textarea value={editValue} onChange={(e) => onChange(e.target.value)} rows={2} />
        ) : (
          <Input type={type} value={editValue} onChange={(e) => onChange(e.target.value)} />
        )}
      </Field>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-[var(--fg-muted)]">{label}</span>
      <span className="text-[13px] text-[var(--fg-primary)] break-words">
        {value || <span className="text-[var(--fg-subtle)]">—</span>}
      </span>
    </div>
  );
}

/* ------------ Timestamp row ----------------------------------------------- */
function TimeRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
        <span className="text-[var(--fg-subtle)]">{icon}</span>
        {label}
      </span>
      <span className="text-[12px] text-[var(--fg-primary)] font-mono tabular-nums text-right">
        {value ? new Date(Number(value)).toLocaleString() : "—"}
      </span>
    </div>
  );
}

/* ------------ Plain info row ---------------------------------------------- */
function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-[12.5px] text-[var(--fg-secondary)] shrink-0">{label}</span>
      <span
        className={`text-[12px] text-[var(--fg-primary)] break-all text-right ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

/* ------------ Formatters -------------------------------------------------- */
function formatMin(m) {
  const val = Number(m || 0);
  if (val < 60) return `${val}m`;
  if (val < 1440) return `${Math.round(val / 60)}h`;
  return `${Math.round(val / 1440)}d`;
}
function formatMB(mb) {
  const val = Number(mb || 0);
  if (val < 1024) return `${val}MB`;
  return `${(val / 1024).toFixed(1)}GB`;
}
function pct(used, total) {
  const u = Number(used || 0);
  const t = Number(total || 0);
  if (t === 0) return 0;
  return Math.round((u / t) * 100);
}
