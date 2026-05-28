// src/components/vouchers/VoucherDetailModal.jsx
// Voucher inspection / edit modal. Wide centered modal (2xl) so we can
// breathe the user info into a real 2-column form and surface lifecycle
// activity without a cramped slide-out.

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
  ChevronDown,
  ChevronUp,
  Copy,
  Calendar,
  Shield,
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
  Section,
} from "../ui";

export default function VoucherDetailModal({
  uuid,
  onClose,
  onRefresh,
  readOnly = false,
}) {
  const [voucher, setVoucher] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);

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
        <Modal.Header
          eyebrow="Voucher"
          title="Loading…"
          icon={Ticket}
          onClose={onClose}
        />
        <Modal.Body>
          <div className="space-y-3">
            <div className="h-9 w-2/3 rounded-md skeleton bg-[var(--surface-sunken)]" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[78px] rounded-md skeleton bg-[var(--surface-sunken)]"
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 rounded-md skeleton bg-[var(--surface-sunken)]"
                />
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
        {/* ---- Header: code + status + actions ----------------------- */}
        <div className="relative px-7 pt-6 pb-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-[var(--text-tertiary)] block mb-1">
                Voucher
              </span>
              <button
                onClick={copyCode}
                title="Copy code"
                className={
                  "group inline-flex items-center gap-2 -ml-1 px-1 py-0.5 rounded " +
                  "hover:bg-[var(--surface-hover)] focus-ring transition-colors"
                }
              >
                <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)] font-mono truncate">
                  {voucher.voucher_code}
                </h2>
                <Copy
                  size={14}
                  className="text-[var(--text-quaternary)] group-hover:text-[var(--brand)] transition-colors shrink-0"
                />
              </button>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <StatusBadge status={voucher.status} />
                {isDisabled && <Badge tone="danger">Disabled</Badge>}
                {voucher.package_name && (
                  <Badge tone="outline">{voucher.package_name}</Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!readOnly && !editing && (
                <>
                  <IconButton onClick={startEdit} title="Edit" size="sm">
                    <Edit3 size={15} />
                  </IconButton>
                  <IconButton
                    onClick={handleToggle}
                    title={isDisabled ? "Enable" : "Disable"}
                    size="sm"
                  >
                    {isDisabled ? (
                      <ToggleRight size={15} />
                    ) : (
                      <ToggleLeft size={15} />
                    )}
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

        <Modal.Body>
          <div className="flex flex-col gap-7">
            {/* ---- Usage stats ---------------------------------------- */}
            <Section label="Usage">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={<Clock size={14} />}
                  label="Time used"
                  value={`${formatMin(voucher.used_time)} / ${formatMin(
                    voucher.time_period
                  )}`}
                  pct={pct(voucher.used_time, voucher.time_period)}
                />
                <StatCard
                  icon={<HardDrive size={14} />}
                  label="Data used"
                  value={`${formatMB(voucher.used_quota)} / ${formatMB(
                    voucher.quota
                  )}`}
                  pct={pct(voucher.used_quota, voucher.quota)}
                />
                <StatCard
                  icon={<Users size={14} />}
                  label="Clients"
                  value={`${voucher.current_clients} / ${voucher.max_clients}`}
                  pct={pct(voucher.current_clients, voucher.max_clients)}
                />
                <StatCard
                  icon={<Wifi size={14} />}
                  label="Rate limit"
                  value={`${voucher.download_rate_limit || 0} / ${
                    voucher.upload_rate_limit || 0
                  } Kbps`}
                />
              </div>
            </Section>

            {/* ---- User info ------------------------------------------ */}
            <Section label="User information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="First name"
                  value={voucher.first_name}
                  editing={editing}
                  editValue={editData.first_name || ""}
                  onChange={(v) =>
                    setEditData({ ...editData, first_name: v })
                  }
                />
                <EditableField
                  label="Last name"
                  value={voucher.last_name}
                  editing={editing}
                  editValue={editData.last_name || ""}
                  onChange={(v) =>
                    setEditData({ ...editData, last_name: v })
                  }
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
            </Section>

            {/* ---- Timestamps ----------------------------------------- */}
            <Section label="Timestamps">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <TimeField
                  icon={<Calendar size={12} />}
                  label="Created"
                  value={voucher.create_time}
                />
                <TimeField
                  icon={<Clock size={12} />}
                  label="First login"
                  value={voucher.login_time}
                />
                <TimeField
                  icon={<Shield size={12} />}
                  label="Expires"
                  value={voucher.expiry_time}
                />
              </div>
            </Section>

            {/* ---- Technical ------------------------------------------ */}
            <Section label="Technical">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <InfoField label="UUID" value={voucher.uuid} mono />
                <InfoField label="Tenant ID" value={voucher.tenant_id} mono />
                <InfoField
                  label="User group"
                  value={voucher.user_group_name || voucher.user_group_id}
                />
                <InfoField
                  label="Bind MAC"
                  value={voucher.bind_mac ? "Yes" : "No"}
                />
              </div>
            </Section>

            {/* ---- Activity timeline ---------------------------------- */}
            {events.length > 0 && (
              <Section label={`Activity (${events.length})`}>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {events.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex items-start gap-2.5 p-2.5 rounded-md bg-[var(--surface-sunken)] border border-[var(--border-subtle)]"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] mt-[7px] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[12.5px] font-medium text-[var(--text-secondary)] capitalize">
                          {evt.event_type.replace(/_/g, " ")}
                        </span>
                        {evt.notes && (
                          <span className="text-[12px] text-[var(--text-tertiary)] ml-1.5">
                            · {evt.notes}
                          </span>
                        )}
                        <p className="text-[11px] text-[var(--text-quaternary)] mt-0.5 font-mono">
                          {new Date(evt.event_timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ---- Raw JSON disclosure -------------------------------- */}
            <div>
              <button
                onClick={() => setRawOpen(!rawOpen)}
                className={
                  "inline-flex items-center gap-1.5 text-[11.5px] font-medium " +
                  "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
                }
              >
                {rawOpen ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                Raw JSON
              </button>
              {rawOpen && (
                <pre
                  className={
                    "mt-2 px-3 py-2.5 rounded-md text-[11px] " +
                    "bg-[var(--surface-sunken)] border border-[var(--border-subtle)] " +
                    "text-[var(--text-tertiary)] overflow-auto max-h-56 " +
                    "font-mono leading-relaxed"
                  }
                >
                  {JSON.stringify(voucher.raw_data || voucher, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </Modal.Body>

        {/* ---- Footer: edit save/cancel or close ---------------------- */}
        <Modal.Footer>
          {editing ? (
            <>
              <span className="mr-auto text-[12.5px] text-[var(--text-tertiary)]">
                Editing user details
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
              >
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

/* ------------ Stat card -------------------------------------------------- */
function StatCard({ icon, label, value, pct: percent }) {
  return (
    <div
      className={
        "rounded-lg p-3 bg-[var(--surface-sunken)] border border-[var(--border-subtle)]"
      }
    >
      <div className="flex items-center gap-1.5 text-[var(--text-tertiary)] mb-1.5">
        {icon}
        <span className="text-[12.5px] font-medium">
          {label}
        </span>
      </div>
      <p className="text-[13px] font-semibold text-[var(--text-primary)] font-mono">
        {value}
      </p>
      {percent !== undefined && (
        <div className="mt-2 h-1 bg-[var(--surface-raised)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--brand)] rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------ Editable field (read OR edit) ------------------------------ */
function EditableField({
  label,
  value,
  editing,
  editValue,
  onChange,
  multiline,
  type = "text",
}) {
  if (editing) {
    return (
      <Field label={label}>
        {multiline ? (
          <Textarea
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
          />
        ) : (
          <Input
            type={type}
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="text-[13px] text-[var(--text-primary)]">
        {value || (
          <span className="text-[var(--text-quaternary)]">—</span>
        )}
      </span>
    </div>
  );
}

/* ------------ Timestamp tile --------------------------------------------- */
function TimeField({ icon, label, value }) {
  return (
    <div
      className={
        "rounded-lg p-3 bg-[var(--surface-sunken)] border border-[var(--border-subtle)]"
      }
    >
      <div className="flex items-center gap-1 text-[var(--text-quaternary)] mb-1">
        {icon}
        <span className="text-[12px] font-medium">
          {label}
        </span>
      </div>
      <p className="text-[12.5px] text-[var(--text-secondary)] font-mono">
        {value ? new Date(Number(value)).toLocaleString() : "—"}
      </p>
    </div>
  );
}

/* ------------ Plain info field ------------------------------------------- */
function InfoField({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] font-medium text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className={`text-[12.5px] text-[var(--text-secondary)] break-all ${
          mono ? "font-mono" : ""
        }`}
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
