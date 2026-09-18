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
import { usePhone } from "../components/ui/phone";

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
  const phone = usePhone();
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
  const activeUuid = voucherUuid.trim();
  const hasFilters = eventType || activeUuid;

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
        // On a phone this hero would be 130px of card carrying one sentence
        // that the panel directly below repeats word for number ("40 events ·
        // page 1 of 2"). With nothing else in it — no actions, no media — the
        // header collapses itself, and the app bar still names the screen.
        subtitle={
          phone
            ? null
            : `${total.toLocaleString()} voucher event${total === 1 ? "" : "s"}${
                hasFilters ? " matching the current filters" : ""
              }`
        }
        icon={<History size={22} />}
        tone="slate"
      />

      <Toolbar>
        <div className="w-52 max-sm:hidden!">
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

      {/* Phone: ten event types behind a dropdown is two taps and a scroll to
          answer "what was deleted today". As chips it is one tap, and which
          filter is on is visible without opening anything. The track scrolls
          sideways so the page never does. */}
      <div
        className="sm:hidden -mx-3 px-3 overflow-x-auto overscroll-x-contain scrollbar-none"
        role="group"
        aria-label="Filter by event type"
      >
        <div className="flex w-max items-center gap-2">
          {["", ...EVENT_TYPES].map((t) => {
            const active = eventType === t;
            return (
              <button
                key={t || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setEventType(t);
                  setPage(1);
                }}
                className={
                  // The event names stay as the log writes them — the same
                  // lower-case wording as the pill on every row below.
                  "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 " +
                  "text-[12.5px] font-semibold font-display transition-colors " +
                  (active
                    ? "border-transparent bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] active:bg-[var(--surface-pressed)]")
                }
              >
                {t ? t.replace("_", " ") : "All events"}
              </button>
            );
          })}
        </div>
      </div>

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
          {/* Phone: an event is a sentence, not five labelled lines. What
              happened and when on top, why underneath, and which voucher —
              still the tap that narrows the log to it — at the bottom, where
              a thumb reaches without covering the text above it. */}
          <ul className="sm:hidden divide-y divide-[var(--border-subtle)]">
            {events.map((evt) => {
              // The chip's whole job is "narrow the log to this voucher". Once
              // the log IS narrowed to it, every row carries the same chip and
              // every tap re-applies a filter that is already on — sixteen
              // identical buttons that do nothing. Leave it off; the filter
              // field above says which voucher, and clearing it is one tap.
              const showChip = evt.voucher_uuid && evt.voucher_uuid !== activeUuid;
              const showChange = evt.old_status && evt.new_status;
              return (
                <li key={evt.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusPill tone={EVENT_TONES[evt.event_type] || "neutral"}>
                      {evt.event_type.replace("_", " ")}
                    </StatusPill>
                    <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-[var(--fg-muted)]">
                      {shortStamp(evt.event_timestamp)}
                    </span>
                  </div>
                  {evt.notes && (
                    <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--fg-secondary)]">{evt.notes}</p>
                  )}
                  {(showChip || showChange || !evt.voucher_uuid) && (
                    <div className="mt-2 flex items-center gap-2">
                      {showChip && (
                        <button
                          onClick={() => {
                            setVoucherUuid(evt.voucher_uuid);
                            setPage(1);
                          }}
                          aria-label={`Show only events for voucher ${evt.voucher_uuid}`}
                          className="inline-flex h-9 items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 font-mono text-[12px] font-semibold text-[var(--fg-primary)] active:bg-[var(--surface-pressed)]"
                        >
                          {evt.voucher_uuid.substring(0, 12)}…
                        </button>
                      )}
                      {!evt.voucher_uuid && (
                        <span className="text-[12px] text-[var(--fg-muted)]">No voucher</span>
                      )}
                      {showChange && (
                        <span className="ml-auto shrink-0 text-[12px] text-[var(--fg-secondary)]">
                          {statusName(evt.old_status)} → {statusName(evt.new_status)}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <DataTable className="max-sm:hidden!">
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
                  <Td muted nowrap className="tabular-nums">
                    {new Date(evt.event_timestamp).toLocaleString()}
                  </Td>
                  <Td>
                    <StatusPill tone={EVENT_TONES[evt.event_type] || "neutral"}>
                      {evt.event_type.replace("_", " ")}
                    </StatusPill>
                  </Td>
                  <Td nowrap>
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
                        className="font-mono text-[12px] font-semibold text-[var(--fg-primary)] hover:text-[var(--brand)] transition-colors"
                      >
                        {evt.voucher_uuid.substring(0, 12)}…
                      </button>
                    ) : (
                      <span className="text-[var(--fg-muted)]">—</span>
                    )}
                  </Td>
                  <Td mono nowrap>
                    {evt.old_status && evt.new_status ? `${evt.old_status} → ${evt.new_status}` : "—"}
                  </Td>
                  <Td muted>
                    <span className="block max-w-[320px] truncate" title={evt.notes || ""}>
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

/* ------------ Local helpers ------------------------------------------------ */

// Ruijie's voucher status codes. "1 → 2" is a fact about the database; on a
// phone card, where there is no header row to read it against, it is said in
// the words the rest of the console uses.
const STATUS_NAMES = { 0: "Inactive", 1: "Unused", 2: "Active", 3: "Expired" };
function statusName(code) {
  return STATUS_NAMES[String(code)] || String(code);
}

/** "Sep 17, 3:36 pm" — the full locale stamp does not fit beside a pill. */
function shortStamp(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}
