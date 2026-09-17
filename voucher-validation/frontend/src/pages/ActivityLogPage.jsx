// src/pages/ActivityLogPage.jsx
//
// The voucher lifecycle log — every create, sync, archive and bulk operation,
// newest first.
//
// Same shape as the Vouchers list: a toolbar of filters over one table, so the
// two pages an operator moves between read the same way. There is deliberately
// no KPI row here — every number this page could show would be computed from
// the twenty-five rows currently on screen, and a tile that changes when you
// page is a liar. The one honest figure, the total event count, is in the
// header.

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { History, X } from "lucide-react";

import { voucherApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  SkeletonTable,
  Select,
  PageShell,
  Toolbar,
  SearchInput,
  StatusPill,
  DataTable,
  Th,
  Td,
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

  function clearFilters() {
    setEventType("");
    setVoucherUuid("");
    setPage(1);
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Audit"
        title="Activity"
        subtitle={`${total.toLocaleString()} voucher event${total === 1 ? "" : "s"}${
          hasFilters ? " matching the current filters" : ""
        }`}
        icon={<History size={22} />}
        tone="slate"
      />

      <Toolbar>
        <div className="w-52">
          <Select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            aria-label="Event type filter"
            className="h-9! rounded-full! bg-[var(--bg-surface)]!"
          >
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>

        {/* Mono, because a UUID is the only thing you paste in here. */}
        <SearchInput
          value={voucherUuid}
          onChange={(e) => {
            setVoucherUuid(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by voucher UUID…"
          width="w-80"
          className="font-mono"
        />

        {hasFilters && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearFilters} iconLeft={<X size={13} />}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      {loading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : events.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={History}
            title="No activity events"
            description={hasFilters ? "Try clearing filters." : "Events will appear as vouchers change."}
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clearFilters} iconLeft={<X size={13} />}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <Panel
          title="Event log"
          subtitle={`${total.toLocaleString()} event${total === 1 ? "" : "s"} · page ${page} of ${Math.max(
            1,
            totalPages
          )}`}
          icon={<History size={15} />}
          tone="slate"
          padding={false}
        >
          <DataTable>
            <thead>
              <tr>
                <Th>Timestamp</Th>
                <Th>Event</Th>
                <Th>Voucher</Th>
                <Th>Status change</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id}>
                  <Td muted nowrap className="tabular-nums max-sm:items-center! max-sm:text-[var(--fg-primary)]! max-sm:font-semibold">
                    {new Date(evt.event_timestamp).toLocaleString()}
                    {/* Phone: what happened rides on the title line. */}
                    <span className="sm:hidden! max-sm:ml-auto shrink-0 font-normal">
                      <StatusPill tone={EVENT_TONES[evt.event_type] || "neutral"}>
                        {evt.event_type.replace("_", " ")}
                      </StatusPill>
                    </span>
                  </Td>
                  <Td className="max-sm:hidden!">
                    <StatusPill tone={EVENT_TONES[evt.event_type] || "neutral"}>
                      {evt.event_type.replace("_", " ")}
                    </StatusPill>
                  </Td>
                  <Td nowrap className="max-sm:items-center!">
                    {evt.voucher_uuid ? (
                      // Clicking a UUID filters the log to that voucher — the
                      // question this table always prompts next.
                      <button
                        onClick={() => {
                          setVoucherUuid(evt.voucher_uuid);
                          setPage(1);
                        }}
                        title={`Show only ${evt.voucher_uuid}`}
                        aria-label={`Show only events for voucher ${evt.voucher_uuid}`}
                        // Phone: a chip with a real, thumb-sized hit area.
                        className="font-mono text-[12px] font-semibold text-[var(--fg-primary)] hover:text-[var(--brand)] transition-colors max-sm:inline-flex max-sm:items-center max-sm:h-9 max-sm:px-3.5 max-sm:rounded-full max-sm:border max-sm:border-[var(--border-default)] max-sm:bg-[var(--bg-surface)] max-sm:active:bg-[var(--surface-pressed)]"
                      >
                        {evt.voucher_uuid.substring(0, 12)}…
                      </button>
                    ) : (
                      <span className="text-[var(--fg-muted)]">—</span>
                    )}
                  </Td>
                  {/* Phone: empty lines are dropped from the card rather than
                      shown as a label and a dash. */}
                  <Td mono nowrap className={evt.old_status && evt.new_status ? "" : "max-sm:hidden!"}>
                    {evt.old_status && evt.new_status ? `${evt.old_status} → ${evt.new_status}` : "—"}
                  </Td>
                  {/* Phone: prose reads left-aligned under its label, not
                      squeezed flush-right beside it. */}
                  <Td
                    muted
                    className={
                      "max-sm:flex-col! max-sm:gap-1! max-sm:text-left! " + (evt.notes ? "" : "max-sm:hidden!")
                    }
                  >
                    <span className="block max-w-[320px] truncate max-sm:max-w-none max-sm:ml-0!" title={evt.notes || ""}>
                      {evt.notes || "—"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </Panel>
      )}
    </PageShell>
  );
}
