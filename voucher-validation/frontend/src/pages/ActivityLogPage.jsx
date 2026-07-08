// src/pages/ActivityLogPage.jsx
// Voucher lifecycle event log.

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { History, Filter, X } from "lucide-react";

import { voucherApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  SkeletonTable,
  Select,
  Input,
} from "../components/ui";

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
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Audit"
        title="Activity"
        subtitle={`${total.toLocaleString()} voucher events`}
        icon={<History size={20} />}
      />

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-48">
          <Filter
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 z-10 text-[var(--fg-muted)] pointer-events-none"
          />
          <Select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          >
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>

        <Input
          type="text"
          mono
          placeholder="Filter by voucher UUID…"
          value={voucherUuid}
          onChange={(e) => {
            setVoucherUuid(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-64"
        />

        {hasFilters && (
          <button
            onClick={() => {
              setEventType("");
              setVoucherUuid("");
              setPage(1);
            }}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--fg-muted)] hover:text-[var(--accent)] transition-colors"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="mt-6">
        {loading ? (
          <SkeletonTable rows={8} cols={5} />
        ) : events.length === 0 ? (
          <Panel padding={false}>
            <EmptyState
              icon={History}
              title="No activity events"
              description={hasFilters ? "Try clearing filters." : "Events will appear as vouchers change."}
            />
          </Panel>
        ) : (
          <Panel padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left border-b border-[var(--border-default)]">
                    <th className="text-label px-5 py-3">Timestamp</th>
                    <th className="text-label px-5 py-3">Event</th>
                    <th className="text-label px-5 py-3">Voucher</th>
                    <th className="text-label px-5 py-3">Status change</th>
                    <th className="text-label px-5 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {events.map((evt) => (
                    <tr
                      key={evt.id}
                      className="hover:bg-[var(--bg-surface)] transition-colors"
                    >
                      <td className="px-5 py-3 text-[12.5px] text-[var(--fg-secondary)] whitespace-nowrap">
                        {new Date(evt.event_timestamp).toLocaleString()}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={EVENT_TONES[evt.event_type] || "neutral"}>
                          {evt.event_type.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-[var(--accent)]">
                        {evt.voucher_uuid
                          ? evt.voucher_uuid.substring(0, 12) + "…"
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-[12px] font-mono text-[var(--fg-secondary)]">
                        {evt.old_status && evt.new_status
                          ? `${evt.old_status} → ${evt.new_status}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-[12px] text-[var(--fg-muted)] max-w-[260px] truncate">
                        {evt.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!loading && events.length > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPageChange={setPage}
              />
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
