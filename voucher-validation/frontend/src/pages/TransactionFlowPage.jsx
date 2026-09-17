// src/pages/TransactionFlowPage.jsx
//
// One row per transaction, opening onto the full event timeline — payment,
// handshake, voucher claim, auth — for that one customer.
//
// The old build made every transaction a card, so thirty transactions were
// thirty headings and nothing lined up; you could not compare two amounts or
// spot the run of failures at 14:05. It is a list now, and the timeline that
// was the good part of the card moved inside the expanded row, where it reads
// as an actual timeline: one rail, one dot per step, coloured from the shared
// STATUS_COLORS so "failed" is the same red it is in every chart on the site.

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  GitBranch,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Ticket,
  Mail,
  SlidersHorizontal,
} from "lucide-react";

import { portalAuditApi, portalConfigApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Modal,
  PageShell,
  Toolbar,
  SearchInput,
  Select,
  Input,
  StatusPill,
  DataTable,
  Th,
  Td,
  RecordCell,
  STATUS_COLORS,
  CHART_COLORS,
} from "../components/ui";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "paid_unclaimed", label: "⚠ Paid · no voucher" },
  { value: "success", label: "Success" },
  { value: "payment_failed", label: "Payment failed" },
  { value: "auth_failed", label: "Auth failed" },
  { value: "manual_assistance", label: "Manual assistance" },
  { value: "handshake_failed", label: "Handshake failed" },
  { value: "voucher_failed", label: "Voucher failed" },
  { value: "no_session", label: "No session" },
  { value: "system_error", label: "System error" },
  { value: "in_progress", label: "In progress" },
];

const STATUS_CFG = {
  success: { tone: "success", icon: CheckCircle2, label: "Success" },
  payment_failed: { tone: "danger", icon: XCircle, label: "Payment failed" },
  auth_failed: { tone: "danger", icon: XCircle, label: "Auth failed" },
  manual_assistance: { tone: "warning", icon: AlertTriangle, label: "Manual assistance" },
  handshake_failed: { tone: "warning", icon: XCircle, label: "Handshake failed" },
  voucher_failed: { tone: "warning", icon: XCircle, label: "Voucher failed" },
  no_session: { tone: "warning", icon: AlertTriangle, label: "No session" },
  system_error: { tone: "danger", icon: XCircle, label: "System error" },
  in_progress: { tone: "info", icon: Clock, label: "In progress" },
};

const STEP_TONE = {
  payment_initiated: "info",
  handshake_success: "success",
  handshake_failed: "warning",
  handshake_error: "danger",
  callback_received: "neutral",
  payment_success: "success",
  payment_failed: "danger",
  voucher_claimed: "brand",
  voucher_claim_failed: "warning",
  voucher_released: "info",
  voucher_reserved_manual: "warning",
  voucher_service_error: "danger",
  auth_attempted: "info",
  auth_success: "success",
  auth_failed: "danger",
  manual_auth_success: "success",
  manual_auth_failed: "danger",
  no_session_id: "warning",
  manual_assistance_created: "warning",
  case_creation_failed: "danger",
  system_error: "danger",
};

/** Tile colour for the row's status glyph. */
const TONE_TILE = {
  success: "green",
  warning: "orange",
  danger: "red",
  info: "blue",
  brand: "brand",
  neutral: "slate",
};

/** Timeline dot colour. Taken from the chart kit so a failed step is the same
 *  red as a failed slice, rather than a hex invented on this page. */
const TONE_DOT = {
  success: STATUS_COLORS.success,
  warning: STATUS_COLORS.warning,
  danger: STATUS_COLORS.failed,
  info: STATUS_COLORS.unused,
  brand: CHART_COLORS.brand, // a claimed voucher is the one on-brand moment
  neutral: STATUS_COLORS.unknown,
};

// Toolbar controls are 36px pills; the Field primitives default to 40px and a
// small radius. Inline is the one override Tailwind's class ordering cannot
// undo, so the filter strip stays a single height.
const PILL = { height: 36, borderRadius: 999 };

const COLUMNS = 8;

function formatTs(iso) {
  try {
    return format(new Date(iso), "HH:mm:ss");
  } catch {
    return iso || "—";
  }
}

function formatDate(iso) {
  try {
    return format(new Date(iso), "MMM dd, yyyy HH:mm:ss");
  } catch {
    return iso || "—";
  }
}

/** A session id short enough for a phone card's subtitle line. */
function shortSession(id) {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

function formatLabel(s) {
  return (s || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function TransactionFlowPage() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [expandedTxn, setExpandedTxn] = useState(null);

  // Filters prefill from the URL so a dashboard card can drill straight in
  // (e.g. "Sold this month" → /portal-flows?startDate=YYYY-MM-01).
  const [searchParams] = useSearchParams();
  const [transactionId, setTransactionId] = useState(() => searchParams.get("transactionId") || "");
  const [sessionId, setSessionId] = useState(() => searchParams.get("sessionId") || "");
  const [voucherCode, setVoucherCode] = useState(() => searchParams.get("voucherCode") || "");
  const [phone, setPhone] = useState(() => searchParams.get("phone") || "");
  const [status, setStatus] = useState(() => searchParams.get("status") || "");
  const [startDate, setStartDate] = useState(() => searchParams.get("startDate") || "");
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") || "");
  // Phone only: the less-used filters fold away behind a button. A drill-in
  // that arrives with one of them already set opens the fold, so the filter
  // narrowing the list is on screen rather than hidden.
  const [moreFilters, setMoreFilters] = useState(() =>
    ["sessionId", "voucherCode", "startDate", "endDate"].some((k) => searchParams.get(k))
  );

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (transactionId.trim()) params.transactionId = transactionId.trim();
      if (sessionId.trim()) params.sessionId = sessionId.trim();
      if (voucherCode.trim()) params.voucherCode = voucherCode.trim();
      if (phone.trim()) params.phone = phone.trim();
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const data = await portalAuditApi.transactionFlows(params);
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("Failed to load transaction flows: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, transactionId, sessionId, voucherCode, phone, status, startDate, endDate]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters =
    transactionId.trim() || sessionId.trim() || voucherCode.trim() || phone.trim() || status || startDate || endDate;
  const foldedActive = [sessionId.trim(), voucherCode.trim(), startDate, endDate].filter(Boolean).length;

  const clearFilters = () => {
    setTransactionId("");
    setSessionId("");
    setVoucherCode("");
    setPhone("");
    setStatus("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Portal"
        title="Txn Flows"
        subtitle={`${total.toLocaleString()} transaction${total !== 1 ? "s" : ""} — every step from payment to internet access.`}
        icon={<GitBranch size={22} />}
        tone="blue"
        actions={
          <Button variant="secondary" size="sm" onClick={fetchFlows} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      {/* Desktop keeps its single strip. On a phone the everyday filters —
          transaction, phone number, status — stay out, and the rest fold into
          one group behind "More filters". The `contents` wrapper leaves the
          desktop strip's items exactly where they were. */}
      <Toolbar>
        <SearchInput
          value={transactionId}
          onChange={(e) => {
            setTransactionId(e.target.value);
            setPage(1);
          }}
          placeholder="Transaction ID…"
          width="w-48"
        />
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
            width="w-48"
            className="max-sm:w-full"
          />
          <SearchInput
            value={voucherCode}
            onChange={(e) => {
              setVoucherCode(e.target.value);
              setPage(1);
            }}
            placeholder="Voucher ID…"
            width="w-44"
            className="max-sm:w-full"
          />
        </div>
        <SearchInput
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPage(1);
          }}
          placeholder="Phone number…"
          width="w-44"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          style={{ ...PILL, width: 190 }}
          // !important outranks the inline pill width, so the box fills its row.
          className="max-sm:w-full! max-sm:h-10!"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <div className={moreFilters ? "contents max-sm:block max-sm:order-2" : "contents max-sm:hidden"}>
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
        <Button
          variant="secondary"
          size="sm"
          className="sm:hidden max-sm:order-1"
          iconLeft={<SlidersHorizontal size={13} />}
          onClick={() => setMoreFilters((v) => !v)}
          aria-expanded={moreFilters}
        >
          {moreFilters ? "Fewer filters" : `More filters${foldedActive ? ` · ${foldedActive}` : ""}`}
        </Button>
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
        title="Transactions"
        subtitle="Open a row for its event timeline. An amber rail marks a payment with no voucher against it."
        icon={<GitBranch size={15} />}
        tone="blue"
        padding={false}
      >
        {loading ? (
          <div className="p-5 space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg skeleton" style={{ opacity: 1 - i * 0.12 }} />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No transactions"
            description={hasFilters ? "Try clearing filters." : "Transactions will appear as the portal processes payments."}
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th className="w-8" />
                <Th>Transaction</Th>
                <Th>Status</Th>
                <Th>Voucher</Th>
                <Th>Plan</Th>
                <Th>Phone</Th>
                <Th align="right">Amount</Th>
                {/* When it started and how much happened travel together, as
                    they did on the old card — and eight columns fit where nine
                    pushed the last one off the right edge. */}
                <Th>Started</Th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <TransactionRow
                  key={txn.transactionId}
                  txn={txn}
                  isExpanded={expandedTxn === txn.transactionId}
                  onToggle={() =>
                    setExpandedTxn((prev) => (prev === txn.transactionId ? null : txn.transactionId))
                  }
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

function TransactionRow({ txn, isExpanded, onToggle }) {
  const cfg = STATUS_CFG[txn.overallStatus] || STATUS_CFG.in_progress;
  const Icon = cfg.icon;

  return (
    <>
      {/* On a phone the row is a card. Its first cell — the chevron here — is
          the card's title, so it carries the transaction, its amount and the
          event count, and the Transaction and Amount rows stand down. The
          amber rail moves from that cell to the whole card's left edge. */}
      <tr
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={
          "cursor-pointer" + (txn.paidUnclaimed ? " max-sm:shadow-[inset_3px_0_0_var(--warning-fg)]" : "")
        }
      >
        {/* "Paid but no voucher" used to tint the whole card amber. A tinted row
            loses its tint to the table's hover rule, so the alert became a left
            rail — which survives hover and still reads down the column. A raw
            <td> here because the rail is an inline style and Td takes none;
            .sf-table still supplies the cell padding. */}
        <td
          className="text-[var(--fg-muted)] max-sm:shadow-none!"
          style={txn.paidUnclaimed ? { boxShadow: "inset 3px 0 0 var(--warning-fg)" } : undefined}
        >
          <span className="max-sm:hidden">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
          <span className="sm:hidden flex w-full items-center gap-3 min-w-0">
            <span className="min-w-0 flex-1">
              <RecordCell
                tone={TONE_TILE[cfg.tone] || "slate"}
                icon={<Icon size={14} />}
                title={txn.transactionId}
                subtitle={`${txn.sessionId ? shortSession(txn.sessionId) : "No session"} · ${txn.eventCount} event${
                  txn.eventCount !== 1 ? "s" : ""
                }`}
                mono
              />
            </span>
            <span className="shrink-0 font-semibold text-[14px] text-[var(--fg-primary)] tabular-nums">
              {txn.amount != null ? `$${Number(txn.amount).toFixed(2)}` : "—"}
            </span>
            {isExpanded ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
          </span>
        </td>
        <Td className="max-sm:hidden!">
          <RecordCell
            tone={TONE_TILE[cfg.tone] || "slate"}
            icon={<Icon size={14} />}
            title={txn.transactionId}
            subtitle={txn.sessionId ? `${txn.sessionId.slice(0, 20)}…` : "No session"}
            mono
          />
        </Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1.5 max-sm:justify-end">
            <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
            {txn.paidUnclaimed && (
              <StatusPill tone="warning" dot={false}>
                Paid · no voucher
              </StatusPill>
            )}
          </div>
        </Td>
        <Td>
          {txn.claimed && txn.voucherCode ? (
            <Badge tone="brand" icon={<Ticket size={11} />}>
              {txn.voucherCode}
            </Badge>
          ) : txn.claimed ? (
            <Badge tone="brand" icon={<Ticket size={11} />}>
              Voucher claimed
            </Badge>
          ) : (
            <span className="text-[var(--fg-muted)]">—</span>
          )}
        </Td>
        <Td>{txn.planKey || "—"}</Td>
        <Td mono>{txn.customerPhone || "—"}</Td>
        <Td align="right" nowrap strong className="tabular-nums max-sm:hidden!">
          {txn.amount != null ? `$${Number(txn.amount).toFixed(2)}` : "—"}
        </Td>
        <Td nowrap muted>
          {/* One wrapper: a phone card would otherwise spread the date and the
              count to opposite ends of the line. The count is in the card's
              title there. */}
          <span className="block">
            {formatDate(txn.startedAt)}
            <span className="block text-[11.5px] text-[var(--fg-muted)] tabular-nums max-sm:hidden">
              {txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}
            </span>
          </span>
        </Td>
      </tr>

      <AnimatePresence>
        {isExpanded && (
          // A phone card pads its row; the timeline sits flush under the card.
          <tr className="max-sm:p-0!">
            {/* sf-table pads every cell; the timeline supplies its own padding
                and must sit flush, and inline is the only padding the table's
                own rule cannot win back. */}
            <td colSpan={COLUMNS} style={{ padding: 0 }}>
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                {/* text-left: a phone card centres a full-width cell. */}
                <div className="border-t border-[var(--border-subtle)] max-sm:border-t-0 bg-[var(--bg-surface)] px-6 py-6 max-sm:px-4 max-sm:py-5 text-left">
                  <p className="text-label mb-5">
                    Event timeline · {txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}
                  </p>

                  <ol className="relative max-w-3xl">
                    {txn.events.map((ev, i) => (
                      <TimelineStep key={ev.id || i} event={ev} isLast={i === txn.events.length - 1} />
                    ))}
                  </ol>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function TimelineStep({ event, isLast }) {
  const [open, setOpen] = useState(false);
  const tone = STEP_TONE[event.event_type] || "neutral";
  const color = TONE_DOT[tone] || TONE_DOT.neutral;
  const msg = event.event_data?.message;
  const hasError = event.event_data?.error;

  // Only a SENT email has something to show. The preview is re-rendered from
  // this row, so it is pinned to the voucher that was actually in that email.
  const isSentEmail = /_email_sent$/.test(event.event_type || "") && event.id != null;
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const openPreview = async () => {
    setLoadingPreview(true);
    try {
      setPreview(await portalConfigApi.emailPreview(event.id));
    } catch (e) {
      toast.error("Could not load the email: " + e.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <li className={`relative pl-8 ${isLast ? "" : "pb-6"}`}>
      {/* The rail stops at the last dot rather than running past it — a line
          that continues into nothing reads as "more steps coming". */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[5.5px] top-[18px] bottom-0 w-[2px] rounded-full bg-[var(--border-default)]"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute left-0 top-[4px] h-[13px] w-[13px] rounded-full"
        style={{ background: color, boxShadow: "0 0 0 3px var(--bg-surface)" }}
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[13px] font-semibold text-[var(--fg-primary)]">
            {formatLabel(event.event_type)}
          </span>
          <span className="text-[11.5px] font-mono text-[var(--fg-muted)]">
            {formatTs(event.event_timestamp)}
          </span>
          {event.voucher_code && (
            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
              {event.voucher_code}
            </span>
          )}
          {hasError && (
            <span className="text-[11px] font-semibold text-[var(--brand)] flex items-center gap-0.5">
              <XCircle size={11} /> Error
            </span>
          )}
        </div>

        {msg && <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1 leading-relaxed">{msg}</p>}

        {/* On a touch screen the two text buttons grow to a thumb's height
            (the negative margin keeps the rhythm of the timeline). */}
        <div className="flex items-center gap-4 mt-1.5 pointer-coarse:gap-5 pointer-coarse:-my-1">
          {event.event_data && (
            <button
              onClick={() => setOpen(!open)}
              className="text-[12px] font-semibold text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors font-display pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-9"
            >
              {open ? "Hide details" : "Show details"}
            </button>
          )}
          {isSentEmail && (
            <button
              onClick={openPreview}
              disabled={loadingPreview}
              className="text-[12px] font-semibold text-[var(--brand)] hover:opacity-80 transition-opacity inline-flex items-center gap-1 disabled:opacity-50 font-display pointer-coarse:min-h-9"
            >
              <Mail size={11} />
              {loadingPreview ? "Loading…" : "View email"}
            </button>
          )}
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <pre
                className={
                  "text-[10.5px] leading-relaxed font-mono mt-2 p-3 rounded-lg " +
                  "bg-[var(--bg-elevated)] border border-[var(--border-subtle)] " +
                  "text-[var(--fg-secondary)] overflow-x-auto max-h-48 " +
                  "whitespace-pre-wrap break-words"
                }
              >
                {JSON.stringify(event.event_data, null, 2)}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {preview && (
        <Modal open onClose={() => setPreview(null)} width="xl">
          <Modal.Header
            eyebrow={preview.template === "manual_assist" ? "Manual assistance" : "Purchase receipt"}
            title="Email sent to the customer"
            subtitle={
              <span className="break-all">{`${preview.to || "unknown recipient"} · ${formatTs(preview.sentAt)}`}</span>
            }
            icon={Mail}
            onClose={() => setPreview(null)}
          />
          <Modal.Body>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-[12.5px] [overflow-wrap:anywhere]">
              <span className="text-[var(--fg-muted)]">
                Subject <span className="text-[var(--fg-primary)]">{preview.subject}</span>
              </span>
              {preview.voucherCode && (
                <span className="text-[var(--fg-muted)]">
                  Voucher{" "}
                  <span className="font-mono font-semibold text-[var(--fg-primary)]">
                    {preview.voucherCode}
                  </span>
                </span>
              )}
              {preview.bcc && (
                <span className="text-[var(--fg-muted)]">
                  Bcc <span className="text-[var(--fg-primary)]">{preview.bcc}</span>
                </span>
              )}
            </div>
            {/* Sandboxed: the email is rendered markup, and it must not be able
                to run script or navigate the admin portal. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="w-full h-[60vh] max-sm:h-[62dvh] rounded-lg border border-[var(--border-default)] bg-white"
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPreview(null)} className="max-sm:flex-1">
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </li>
  );
}

/** From/To as one pair. `contents` on desktop, so each bound is still its own
 *  item in the filter strip; on a phone the two sit side by side. */
function DateRange({ children }) {
  return <div className="contents max-sm:grid max-sm:grid-cols-2 max-sm:gap-2.5">{children}</div>;
}

/** A date bound in the Toolbar. The word carries the meaning; a stacked label
 *  would make the strip a row taller for no gain — except on a phone, where
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
