// src/components/vouchers/VoucherDetailModal.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { voucherApi } from "../../services/api";
import StatusBadge from "../shared/StatusBadge";
import ConfirmDialog from "../shared/ConfirmDialog";
import toast from "react-hot-toast";
import {
  X, Edit3, Save, Trash2, ToggleLeft, ToggleRight,
  Clock, Wifi, HardDrive, Users, ChevronDown, ChevronUp,
  Copy, Calendar, Shield,
} from "lucide-react";

export default function VoucherDetailModal({ uuid, onClose, onRefresh, readOnly = false }) {
  const [voucher, setVoucher] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => { loadDetail(); }, [uuid]);

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

  async function saveEdit() {
    setSaving(true);
    try {
      await voucherApi.update(uuid, editData);
      toast.success("Voucher updated");
      setEditing(false);
      loadDetail();
      onRefresh();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  function handleDelete() {
    setConfirm({
      title: "Delete Voucher",
      message: `Are you sure you want to delete ${voucher.voucher_code}? It will be archived.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await voucherApi.remove(uuid);
          toast.success("Voucher deleted");
          onClose();
          onRefresh();
        } catch (err) { toast.error(err.message); }
      },
    });
  }

  async function handleToggle() {
    try {
      await voucherApi.toggle(uuid);
      toast.success("Status toggled");
      loadDetail();
      onRefresh();
    } catch (err) { toast.error(err.message); }
  }

  function copyCode() {
    navigator.clipboard.writeText(voucher.voucher_code);
    toast.success("Copied to clipboard");
  }

  if (loading) {
    return (
      <Overlay onClose={onClose}>
        <Panel>
          <div className="flex items-center justify-center h-64">
            <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        </Panel>
      </Overlay>
    );
  }

  if (!voucher) return null;
  const isDisabled = Number(voucher.disable_status) === 1;

  return (
    <>
      <Overlay onClose={onClose}>
        <Panel>
          {/* Top accent */}
          <div className="h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400" />

          {/* Header */}
          <div className="p-6 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={copyCode}
                    className="group flex items-center gap-2 hover:bg-purple-50 rounded-lg px-2 py-1 -ml-2 transition-colors"
                    title="Copy code"
                  >
                    <h2 className="text-xl font-bold text-gray-900 font-mono truncate">
                      {voucher.voucher_code}
                    </h2>
                    <Copy size={14} className="text-gray-300 group-hover:text-purple-500 transition-colors shrink-0" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={voucher.status} />
                  {isDisabled && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold uppercase tracking-wide">
                      Disabled
                    </span>
                  )}
                  <span className="text-xs text-gray-400">|</span>
                  <span className="text-xs text-gray-500 font-medium">{voucher.package_name}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-3">
                {!readOnly && (
                  <>
                    {!editing ? (
                      <IconBtn onClick={startEdit} title="Edit" icon={<Edit3 size={15} />} />
                    ) : (
                      <IconBtn onClick={saveEdit} disabled={saving} title="Save" icon={<Save size={15} />} className="text-purple-600 hover:bg-purple-50" />
                    )}
                    <IconBtn
                      onClick={handleToggle}
                      title={isDisabled ? "Enable" : "Disable"}
                      icon={isDisabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    />
                    <IconBtn onClick={handleDelete} title="Delete" icon={<Trash2 size={15} />} className="text-red-500 hover:bg-red-50" />
                  </>
                )}
                <IconBtn onClick={onClose} title="Close" icon={<X size={15} />} />
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 px-6 pb-5">
            <StatCard icon={<Clock size={15} />} label="Time Used" value={`${formatMin(voucher.used_time)} / ${formatMin(voucher.time_period)}`} pct={pct(voucher.used_time, voucher.time_period)} color="purple" />
            <StatCard icon={<HardDrive size={15} />} label="Data Used" value={`${formatMB(voucher.used_quota)} / ${formatMB(voucher.quota)}`} pct={pct(voucher.used_quota, voucher.quota)} color="blue" />
            <StatCard icon={<Users size={15} />} label="Clients" value={`${voucher.current_clients} / ${voucher.max_clients}`} pct={pct(voucher.current_clients, voucher.max_clients)} color="green" />
            <StatCard icon={<Wifi size={15} />} label="Rate Limit" value={`${voucher.download_rate_limit || 0} / ${voucher.upload_rate_limit || 0} Kbps`} color="orange" />
          </div>

          {/* User info */}
          <SectionHeader title="User Information" className="px-6 pb-5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                { key: "first_name", label: "First Name" },
                { key: "last_name", label: "Last Name" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
              ].map(({ key, label }) => (
                <EditableField
                  key={key}
                  label={label}
                  value={voucher[key]}
                  editing={editing}
                  editValue={editData[key] || ""}
                  onChange={(v) => setEditData({ ...editData, [key]: v })}
                />
              ))}
              <div className="col-span-2">
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
          </SectionHeader>

          {/* Timestamps */}
          <SectionHeader title="Timestamps" className="px-6 pb-5">
            <div className="grid grid-cols-3 gap-3">
              <TimeField icon={<Calendar size={12} />} label="Created" value={voucher.create_time} />
              <TimeField icon={<Clock size={12} />} label="First Login" value={voucher.login_time} />
              <TimeField icon={<Shield size={12} />} label="Expires" value={voucher.expiry_time} />
            </div>
          </SectionHeader>

          {/* Technical */}
          <SectionHeader title="Technical" className="px-6 pb-5">
            <div className="grid grid-cols-2 gap-2">
              <InfoField label="UUID" value={voucher.uuid} mono />
              <InfoField label="Tenant ID" value={voucher.tenant_id} />
              <InfoField label="User Group" value={voucher.user_group_name || voucher.user_group_id} />
              <InfoField label="Bind MAC" value={voucher.bind_mac ? "Yes" : "No"} />
            </div>
          </SectionHeader>

          {/* Activity */}
          {events.length > 0 && (
            <SectionHeader title={`Activity (${events.length})`} className="px-6 pb-5">
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {events.map((evt) => (
                  <div key={evt.id} className="flex items-start gap-2.5 text-xs p-2.5 bg-gray-50/80 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-semibold text-gray-700 capitalize">{evt.event_type.replace(/_/g, " ")}</span>
                      {evt.notes && <span className="text-gray-400 ml-1">- {evt.notes}</span>}
                      <p className="text-gray-400 text-[10px] mt-0.5">{new Date(evt.event_timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionHeader>
          )}

          {/* Raw data */}
          <div className="px-6 pb-6">
            <button
              onClick={() => setRawOpen(!rawOpen)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium"
            >
              {rawOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Raw JSON
            </button>
            {rawOpen && (
              <pre className="mt-2 bg-gray-50 rounded-xl p-3 text-[11px] text-gray-500 overflow-auto max-h-48 font-mono leading-relaxed">
                {JSON.stringify(voucher.raw_data || voucher, null, 2)}
              </pre>
            )}
          </div>
        </Panel>
      </Overlay>

      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

// --- Sub-components ---

function Overlay({ children, onClose }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />
      {children}
    </motion.div>
  );
}

function Panel({ children }) {
  return (
    <motion.div
      className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 250 }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </motion.div>
  );
}

function IconBtn({ onClick, icon, title, disabled, className = "text-gray-400 hover:bg-gray-100 hover:text-gray-600" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${className}`}
    >
      {icon}
    </button>
  );
}

function StatCard({ icon, label, value, pct: percent, color }) {
  const colors = {
    purple: { bg: "bg-purple-50", icon: "text-purple-500", bar: "bg-purple-400" },
    blue: { bg: "bg-blue-50", icon: "text-blue-500", bar: "bg-blue-400" },
    green: { bg: "bg-green-50", icon: "text-green-500", bar: "bg-green-400" },
    orange: { bg: "bg-orange-50", icon: "text-orange-500", bar: "bg-orange-400" },
  };
  const c = colors[color];
  return (
    <div className={`${c.bg} rounded-2xl p-3.5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={c.icon}>{icon}</span>
        <span className="text-[11px] font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-sm font-bold text-gray-800">{value}</p>
      {percent !== undefined && (
        <div className="mt-2 h-1 bg-white/80 rounded-full overflow-hidden">
          <div className={`h-full ${c.bar} rounded-full transition-all duration-500`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, children, className = "" }) {
  return (
    <div className={className}>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EditableField({ label, value, editing, editValue, onChange, multiline }) {
  return (
    <div>
      <label className="text-[11px] text-gray-400 mb-0.5 block">{label}</label>
      {editing ? (
        multiline ? (
          <textarea
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition-all"
          />
        ) : (
          <input
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition-all"
          />
        )
      ) : (
        <p className="text-sm text-gray-800 font-medium">{value || "---"}</p>
      )}
    </div>
  );
}

function TimeField({ icon, label, value }) {
  return (
    <div className="bg-gray-50/80 rounded-xl p-2.5">
      <div className="flex items-center gap-1 text-gray-400 mb-1">{icon}<span className="text-[10px] font-medium">{label}</span></div>
      <p className="text-xs text-gray-700 font-medium">
        {value ? new Date(Number(value)).toLocaleString() : "---"}
      </p>
    </div>
  );
}

function InfoField({ label, value, mono }) {
  return (
    <div>
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
      <p className={`text-xs text-gray-700 mt-0.5 break-all ${mono ? "font-mono" : ""}`}>{value || "---"}</p>
    </div>
  );
}

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
  const u = Number(used || 0), t = Number(total || 0);
  if (t === 0) return 0;
  return Math.round((u / t) * 100);
}
