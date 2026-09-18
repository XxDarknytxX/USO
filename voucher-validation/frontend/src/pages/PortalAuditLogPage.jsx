// src/pages/PortalAuditLogPage.jsx
//
// Captive-portal audit log — payment, handshake, voucher and auth events, in
// the order they happened.
//
// This is a forensic page: someone is here because a customer says they paid
// and got nothing. So it is a single list with the filters that narrow it in a
// Toolbar above, and every row opens to the raw event payload underneath. The
// detail stays inline rather than in a drawer, because the question is nearly
// always "what did the row above this one say".

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, ChevronDown, ChevronUp, RotateCcw, RefreshCw, SlidersHorizontal } from "lucide-react";

import { portalAuditApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import { usePhone } from "../components/ui/phone";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  PageShell,
  Toolbar,
  SearchInput,
  Select,
  Input,
  DataTable,
  Th,
  Td,
} from "../components/ui";

const EVENT_TYPES = [
  "payment_initiated",
  "payment_success",
  "payment_failed",
  "handshake_success",
  "handshake_failed",
  "handshake_error",
  "callback_received",
  "voucher_claimed",
  "voucher_claim_failed",
  "voucher_released",
  "voucher_service_error",
  "auth_attempted",
  "auth_success",
  "auth_failed",
  "no_session_id",
  "manual_assistance_created",
  "case_creation_failed",
  "receipt_email_sent",
  "receipt_email_failed",
  "receipt_email_skipped",
  "test_email_sent",
  "test_email_failed",
  "system_error",
];

const EVENT_TONES = {
  payment_initiated: "info",
  payment_success: "success",
  payment_failed: "danger",
  handshake_success: "success",
  handshake_failed: "warning",
  handshake_error: "danger",
  callback_received: "neutral",
  voucher_claimed: "brand",
  voucher_claim_failed: "warning",
  voucher_released: "info",
  voucher_service_error: "danger",
  auth_attempted: "info",
  auth_success: "success",
  auth_failed: "danger",
  no_session_id: "warning",
  manual_assistance_created: "warning",
  case_creation_failed: "danger",
  receipt_email_sent: "success",
  receipt_email_failed: "danger",
  receipt_email_skipped: "warning",
  test_email_sent: "info",
  test_email_failed: "danger",
  system_error: "danger",
};

// Toolbar controls are 36px pills; the Field primitives default to 40px and a
// small radius. Inline is the one override Tailwind's class ordering cannot
// undo, so the filter strip stays a single height.
const PILL = { height: 36, borderRadius: 999 };

const COLUMNS = 9;

function formatEventLabel(eventType) {
  return eventType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Phone card title: the year is noise on a log that is read the same week. */
function formatShortTimestamp(iso) {
  try {
    return format(new Date(iso), "MMM d, HH:mm:ss");
  } catch {
    return iso || "—";
  }
}

function formatTimestamp(iso) {
  try {
    return format(new Date(iso), "MMM dd, yyyy HH:mm:ss");
  } catch {
    return iso || "—";
  }
}

function JsonViewer({ data }) {
  if (!data || typeof data !== "object") {
    return <span className="text-[11.5px] text-[var(--fg-muted)]">No data</span>;
  }
  return (
    <pre
      className={
        "text-[11px] leading-relaxed font-mono " +
        "bg-[var(--bg-elevated)] border border-[var(--border-subtle)] " +
        "text-[var(--fg-secondary)] rounded-lg p-3 overflow-x-auto max-h-80 " +
        "whitespace-pre-wrap break-words"
      }
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function PortalAuditLogPage() {
  // Below 640px this page is a feed, not a table — a different component, not
  // a narrower one. Media queries cannot swap which markup renders.
  const phone = usePhone();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);

  const [eventType, setEventType] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Phone only: the session and date filters fold away behind a button, so the
  // log is not a screen and a half below the page header.
  const [moreFilters, setMoreFilters] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (eventType) params.eventType = eventType;
      if (transactionId.trim()) params.transactionId = transactionId.trim();
      if (sessionId.trim()) params.sessionId = sessionId.trim();
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const data = await portalAuditApi.list(params);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("Failed to load audit logs: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, eventType, transactionId, sessionId, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters =
    eventType || transactionId.trim() || sessionId.trim() || startDate || endDate;
  const foldedActive = [sessionId.trim(), startDate, endDate].filter(Boolean).length;

  const clearFilters = () => {
    setEventType("");
    setTransactionId("");
    setSessionId("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const toggleRow = (id) => setExpandedRow((p) => (p === id ? null : id));

  return (
    <PageShell>
      {/* On a phone the app bar already names the screen, and the count and
          Refresh live on the list itself — so the hero would be a card of
          prose between the bar and the work. It stands down entirely. */}
      <PageHeader
        eyebrow="Portal"
        title="Portal Logs"
        subtitle={
          phone
            ? null
            : `${total.toLocaleString()} event${total !== 1 ? "s" : ""} — every payment, handshake, voucher and auth step the portal recorded.`
        }
        icon={<FileText size={22} />}
        tone="blue"
        actions={
          phone ? null : (
            <Button variant="secondary" size="sm" onClick={fetchLogs} iconLeft={<RefreshCw size={14} />}>
              Refresh
            </Button>
          )
        }
      />

      <Toolbar>
        {/* `contents` on desktop, so the select stays an ordinary item of the
            filter strip. On a phone the select and the fold button share one
            row — the search above them is the control that gets a row of its
            own, because it is the one a forensic lookup starts with. */}
        <div className="contents max-sm:flex max-sm:order-1 max-sm:items-center max-sm:gap-2">
          {/* Select renders its own relative wrapper, and that wrapper is the
              flex item here — so the width has to be asked for on a box of
              ours around it, not on the <select>. */}
          <div className="contents max-sm:block max-sm:min-w-0 max-sm:flex-1">
          <Select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            style={{ ...PILL, width: 210 }}
            // !important outranks the inline pill width, so the box fills its row.
            className="max-sm:w-full! max-sm:h-10! max-sm:min-w-0 max-sm:flex-1"
            aria-label="Filter by event type"
          >
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatEventLabel(t)}
              </option>
            ))}
          </Select>
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="sm:hidden shrink-0 h-10!"
            iconLeft={<SlidersHorizontal size={13} />}
            onClick={() => setMoreFilters((v) => !v)}
            aria-expanded={moreFilters}
          >
            {moreFilters ? "Fewer" : `Filters${foldedActive ? ` · ${foldedActive}` : ""}`}
          </Button>
        </div>

        <SearchInput
          value={transactionId}
          onChange={(e) => {
            setTransactionId(e.target.value);
            setPage(1);
          }}
          placeholder="Transaction ID…"
          width="w-52"
        />

        {/* `contents` on desktop: these stay ordinary items of the filter strip.
            On a phone they are one foldable group. */}
        <div
          className={
            "contents " +
            (moreFilters ? "max-sm:flex max-sm:flex-col max-sm:gap-2.5 max-sm:order-2" : "max-sm:hidden")
          }
        >
          <SearchInput
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              setPage(1);
            }}
            placeholder="Session ID…"
            width="w-52"
            className="max-sm:w-full"
          />

          <DateRange>
            <DateFilter
              label="From"
              value={startDate}
              onChange={(v) => {
                setStartDate(v);
                setPage(1);
              }}
            />
            <DateFilter
              label="To"
              value={endDate}
              onChange={(v) => {
                setEndDate(v);
                setPage(1);
              }}
            />
          </DateRange>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<RotateCcw size={13} />}
            onClick={clearFilters}
            className="max-sm:order-3"
          >
            Clear all
          </Button>
        )}
      </Toolbar>

      <Panel
        title="Event log"
        subtitle={
          phone
            ? `${total.toLocaleString()} event${total !== 1 ? "s" : ""}, newest first`
            : "Newest first. Open a row for the full payload."
        }
        icon={<FileText size={15} />}
        tone="blue"
        padding={false}
        actions={
          phone ? (
            <Button variant="secondary" size="sm" onClick={fetchLogs} iconLeft={<RefreshCw size={13} />}>
              Refresh
            </Button>
          ) : null
        }
      >
        {loading ? (
          <div className="p-5 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg skeleton" style={{ opacity: 1 - i * 0.09 }} />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No audit events"
            description={hasFilters ? "Try widening the filters." : "Events will appear as portal traffic flows."}
          />
        ) : phone ? (
          <ul>
            {logs.map((log) => (
              <PhoneLogRow
                key={log.id}
                log={log}
                isExpanded={expandedRow === log.id}
                onToggle={() => toggleRow(log.id)}
              />
            ))}
          </ul>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th className="w-8" />
                <Th>Timestamp</Th>
                <Th>Event</Th>
                <Th>Transaction</Th>
                <Th>Plan</Th>
                <Th>Voucher</Th>
                <Th align="right">Amount</Th>
                <Th>Phone</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  isExpanded={expandedRow === log.id}
                  onToggle={() => toggleRow(log.id)}
                />
              ))}
            </tbody>
          </DataTable>
        )}

        <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </Panel>
    </PageShell>
  );
}

function LogRow({ log, isExpanded, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer" aria-expanded={isExpanded}>
        <Td>
          {/* Colour on a child, not on Td: two text-colour utilities on one
              element resolve by stylesheet order, which is not ours to pick. */}
          <span className="text-[var(--fg-muted)]">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </Td>
        <Td nowrap muted>
          {formatTimestamp(log.event_timestamp)}
        </Td>
        <Td>
          <Badge tone={EVENT_TONES[log.event_type] || "neutral"}>
            {formatEventLabel(log.event_type)}
          </Badge>
        </Td>
        <Td mono nowrap>
          <span className="text-[var(--brand-fg-on-soft)]">{log.transaction_id || "—"}</span>
        </Td>
        <Td nowrap>{log.plan_key || "—"}</Td>
        <Td mono strong nowrap>
          {log.voucher_code || "—"}
        </Td>
        <Td align="right" nowrap className="tabular-nums">
          {log.amount != null ? `$${Number(log.amount).toFixed(2)}` : "—"}
        </Td>
        <Td mono>{log.customer_phone || "—"}</Td>
        <Td muted>{log.source_system || "—"}</Td>
      </tr>

      <AnimatePresence>
        {isExpanded && (
          <tr>
            {/* sf-table pads every cell; the expansion supplies its own padding
                and must sit flush, and inline is the only padding the table's
                own rule cannot win back. */}
            <td colSpan={COLUMNS} style={{ padding: 0 }}>
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <LogDetail log={log} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * One event on a phone: two lines. What happened and when, then the
 * identifiers that make the event findable — transaction, plan, number — with
 * the amount opposite. Everything else is in the payload a tap opens.
 *
 * The stacked-table card put each of those on a labelled line of its own, so a
 * page of fifty events ran eleven thousand pixels and every row looked like
 * every other. A log is read by scanning down the event column, which is what
 * this restores.
 */
function PhoneLogRow({ log, isExpanded, onToggle }) {
  const meta = [log.transaction_id, log.plan_key, log.customer_phone].filter(Boolean);
  return (
    <li className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full px-4 py-3 flex flex-col gap-1.5 text-left active:bg-[var(--bg-surface)] transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Badge tone={EVENT_TONES[log.event_type] || "neutral"}>{formatEventLabel(log.event_type)}</Badge>
          <span className="ml-auto shrink-0 text-[11.5px] text-[var(--fg-muted)] tabular-nums">
            {formatShortTimestamp(log.event_timestamp)}
          </span>
          <span className="shrink-0 text-[var(--fg-muted)]">
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </span>

        <span className="flex items-baseline gap-3 min-w-0">
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--fg-muted)] [overflow-wrap:anywhere]">
            {/* Only the transaction id may break mid-word — an M-PAiSA
                reference can outrun the line. The plan and the number after it
                are each kept whole, so a long id pushes "monthly-1" to the next
                line instead of leaving "mo" on this one. The zero-width space
                after each dot is where that break goes, leaving the dot at the
                end of the line rather than opening the next. */}
            {meta.length ? (
              meta.map((part, i) =>
                i === 0 ? (
                  <span key={part + i} className="font-mono text-[var(--brand-fg-on-soft)]">
                    {part}
                  </span>
                ) : (
                  <span key={part + i}>
                    <span className="px-1 opacity-60">·</span>
                    {"\u200B"}
                    <span className="whitespace-nowrap">{part}</span>
                  </span>
                )
              )
            ) : (
              "No transaction against this event"
            )}
          </span>
          {log.amount != null && (
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--fg-primary)]">
              ${Number(log.amount).toFixed(2)}
            </span>
          )}
        </span>

        {log.voucher_code && (
          <span className="inline-flex w-fit items-center rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-[var(--brand-fg-on-soft)]">
            {log.voucher_code}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <LogDetail log={log} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** The opened event, identical either side of the breakpoint. */
function LogDetail({ log }) {
  return (
    <div className="px-6 py-5 max-sm:px-4 max-sm:py-4 text-left bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]">
      {log.event_data?.message && (
        <div className="mb-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
          <span className="text-label block mb-1">Summary</span>
          <p className="text-[13px] text-[var(--fg-primary)]">{log.event_data.message}</p>
        </div>
      )}

      {/* Two-up on a phone for the short identifiers; anything long (a session,
          a user agent, a date) takes the whole row. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-4 mb-5">
        <DetailItem label="Event ID" value={log.id} />
        <DetailItem label="Source" value={log.source_system} className="sm:hidden" />
        <DetailItem label="Session ID" value={log.session_id} wide />
        <DetailItem label="User Group ID" value={log.user_group_id} />
        <DetailItem label="Source IP" value={log.source_ip} />
        <DetailItem label="Client IP" value={log.event_data?.clientIp} />
        <DetailItem label="User Agent" value={log.event_data?.userAgent} wide />
        <DetailItem label="Received at" value={formatTimestamp(log.received_at)} wide />
        <DetailItem label="Event timestamp" value={formatTimestamp(log.event_timestamp)} wide />
        {log.event_data?.error && <DetailItem label="Error" value={log.event_data.error} wide />}
      </div>

      <div>
        <span className="text-label block mb-2">Event data</span>
        <JsonViewer data={log.event_data} />
      </div>
    </div>
  );
}

function DetailItem({ label, value, wide = false, className = "" }) {
  // A phone card leaves a line out rather than print "CLIENT IP —"; the opened
  // event follows the same rule, or half the panel is dashes.
  const phone = usePhone();
  if (phone && (value == null || value === "")) return null;
  return (
    <div className={`min-w-0 ${wide ? "max-md:col-span-2" : ""} ${className}`}>
      <span className="text-label">{label}</span>
      <p className="text-[12.5px] text-[var(--fg-secondary)] font-mono mt-1 break-all">{value || "—"}</p>
    </div>
  );
}

/** From/To as one pair. `contents` on desktop, so each bound is still its own
 *  item in the filter strip; on a phone the two sit side by side. */
function DateRange({ children }) {
  return <div className="contents max-sm:grid max-sm:grid-cols-2 max-sm:gap-2.5">{children}</div>;
}

/** A date bound in the Toolbar. The word carries the meaning; a stacked label
 *  would make the strip two rows tall for no gain — except on a phone, where
 *  the pair is half a row each and the word goes above the box. */
function DateFilter({ label, value, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 max-sm:flex max-sm:flex-col max-sm:items-stretch max-sm:gap-1 max-sm:min-w-0 font-display text-[11.5px] font-bold uppercase tracking-[0.07em] text-[var(--fg-muted)]">
      {label}
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...PILL, width: 152 }}
        className="font-sans text-[12.5px] normal-case tracking-normal max-sm:w-full! max-sm:h-10! max-sm:min-w-0"
      />
    </label>
  );
}
