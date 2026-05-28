// src/pages/ActivityLogPage.jsx
// Voucher lifecycle event log.

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { History, Filter, X } from "lucide-react";

import { voucherApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import { Badge, EmptyState } from "../components/ui";

const EVENT_TYPES = [
  "created",
  "updated",
  "archived",
  "restored",
  "disabled",
  "enabled",
  "deleted",
  "synced",
  "bulk_operation",
  "field_updated",
];

const EVENT_TONES = {
  created: "success",
  enabled: "success",
  restored: "success",
  updated: "info",
  synced: "info",
  field_updated: "info",
  bulk_operation: "info",
  archived: "warning",
  disabled: "danger",
  deleted: "danger",
};

export default function ActivityLogPage() {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);

  const [eventType, setEventType] = useState("");
  const [voucherUuid, setVoucherUuid] = useState("");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (eventType) params.eventType = eventType;
      if (voucherUuid.trim()) params.voucherUuid = voucherUuid.trim();

      const data = await voucherApi.activity(params);
      setEvents(data.events || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("Failed to load activity: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, eventType, voucherUuid]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters = eventType || voucherUuid.trim();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <History size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Audit</span>
            <h1 className="page-title">Activity Log</h1>
            <p className="page-subtitle">{total.toLocaleString()} voucher events</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-8 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
        <div className="relative">
          <Filter
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
          />
          <select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            className={
              "h-8 pl-7 pr-3 text-[12.5px] font-medium rounded-md appearance-none cursor-pointer " +
              "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
              "text-[var(--text-secondary)] hover:border-[var(--input-border-hover)] focus-input"
            }
          >
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          placeholder="Filter by voucher UUID…"
          value={voucherUuid}
          onChange={(e) => {
            setVoucherUuid(e.target.value);
            setPage(1);
          }}
          className={
            "h-8 px-3 text-[12.5px] rounded-md w-64 font-mono " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] " +
            "hover:border-[var(--input-border-hover)] focus-input"
          }
        />

        {hasFilters && (
          <button
            onClick={() => {
              setEventType("");
              setVoucherUuid("");
              setPage(1);
            }}
            className="inline-flex items-center gap-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--brand)] transition-colors"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 px-8 py-5">
        <div
          className={
            "h-full flex flex-col rounded-lg " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "shadow-[var(--elev-1)] overflow-hidden"
          }
        >
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 rounded skeleton" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity events"
              description={hasFilters ? "Try clearing filters." : "Events will appear as vouchers change."}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--surface-sunken)] text-left text-[12px] font-medium text-[var(--text-tertiary)]">
                    <th className="px-4 py-2.5 font-medium">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium">Event</th>
                    <th className="px-4 py-2.5 font-medium">Voucher</th>
                    <th className="px-4 py-2.5 font-medium">Status change</th>
                    <th className="px-4 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr
                      key={evt.id}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-mono text-[var(--text-tertiary)] whitespace-nowrap">
                        {new Date(evt.event_timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={EVENT_TONES[evt.event_type] || "neutral"}>
                          {evt.event_type.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--brand-fg-on-soft)]">
                        {evt.voucher_uuid
                          ? evt.voucher_uuid.substring(0, 12) + "…"
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-mono text-[var(--text-secondary)]">
                        {evt.old_status && evt.new_status
                          ? `${evt.old_status} → ${evt.new_status}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[var(--text-tertiary)] max-w-[260px] truncate">
                        {evt.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && events.length > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
