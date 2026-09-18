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
import { usePhone } from "../components/ui/phone";
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
  ObjectTile,
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

/**
 * A session id cut to what fits beside the transaction id on a phone card.
 * Cut here rather than left to `text-overflow`, because a Ruijie token is one
 * unbroken 44-character word: the browser would lay the whole word out and
 * clip it, which is invisible to a reader and to anything measuring the page.
 * The desktop row does the same thing at 20 characters, where there is more
 * room for it.
 */
const shortSession = (id) => (id.length > 18 ? id.slice(0, 18) + "…" : id);

/** Phone card: the year and the seconds are noise on a line already carrying
 *  the plan, the number and the event count. */
function formatShortDate(iso) {
  try {
    return format(new Date(iso), "MMM d, HH:mm");
  } catch {
    return iso || "—";
  }
}

function formatLabel(s) {
  return (s || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function TransactionFlowPage() {
  // Below 640px a transaction is a card, not a table row, and the status
  // filter is a strip of chips rather than a select — different components,
  // which is not something a media query can choose between.
  const phone = usePhone();
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
  const [customerPhone, setCustomerPhone] = useState(() => searchParams.get("phone") || "");
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
      if (customerPhone.trim()) params.phone = customerPhone.trim();
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
  }, [page, limit, transactionId, sessionId, voucherCode, customerPhone, status, startDate, endDate]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters =
    transactionId.trim() || sessionId.trim() || voucherCode.trim() || customerPhone.trim() || status || startDate || endDate;
  const foldedActive = [sessionId.trim(), voucherCode.trim(), startDate, endDate].filter(Boolean).length;

  const clearFilters = () => {
    setTransactionId("");
    setSessionId("");
    setVoucherCode("");
    setCustomerPhone("");
    setStatus("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  return (
    <PageShell>
      {/* The app bar names the screen on a phone, and the count and Refresh sit
          on the list itself — so the hero would be a card of prose between the
          bar and the work. It stands down entirely. */}
      <PageHeader
        eyebrow="Portal"
        title="Txn Flows"
        subtitle={
          phone
            ? null
            : `${total.toLocaleString()} transaction${total !== 1 ? "s" : ""} — every step from payment to internet access.`
        }
        icon={<GitBranch size={22} />}
        tone="blue"
        actions={
          phone ? null : (
            <Button variant="secondary" size="sm" onClick={fetchFlows} iconLeft={<RefreshCw size={14} />}>
              Refresh
            </Button>
          )
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
          className="max-sm:order-1"
        />
        <div
          className={
            "contents " +
            (moreFilters ? "max-sm:flex max-sm:flex-col max-sm:gap-2.5 max-sm:order-4" : "max-sm:hidden")
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
        {/* `contents` on desktop, so the number search stays an ordinary item
            of the strip; on a phone it shares its row with the fold button. */}
        <div className="contents max-sm:flex max-sm:order-2 max-sm:items-center max-sm:gap-2">
          <SearchInput
            value={customerPhone}
            onChange={(e) => {
              setCustomerPhone(e.target.value);
              setPage(1);
            }}
            placeholder="Phone number…"
            width="w-44"
            className="max-sm:min-w-0 max-sm:flex-1"
          />
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
        {/* Eleven statuses in a select say nothing about what the list can be
            narrowed to. As a strip of chips they are readable at a glance and
            one tap away, which is how triage on a phone actually goes. */}
        {phone ? (
          <StatusChips
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        ) : (
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            style={{ ...PILL, width: 190 }}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <div className={moreFilters ? "contents max-sm:block max-sm:order-5" : "contents max-sm:hidden"}>
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
            className="max-sm:order-6"
          >
            Clear all
          </Button>
        )}
      </Toolbar>

      <Panel
        title="Transactions"
        subtitle={
          phone
            ? `${total.toLocaleString()} transaction${total !== 1 ? "s" : ""}, newest first`
            : "Open a row for its event timeline. An amber rail marks a payment with no voucher against it."
        }
        icon={<GitBranch size={15} />}
        tone="blue"
        padding={false}
        actions={
          phone ? (
            <Button variant="secondary" size="sm" onClick={fetchFlows} iconLeft={<RefreshCw size={13} />}>
              Refresh
            </Button>
          ) : null
        }
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
        ) : phone ? (
          <ul>
            {transactions.map((txn) => (
              <PhoneFlowRow
                key={txn.transactionId}
                txn={txn}
                isExpanded={expandedTxn === txn.transactionId}
                onToggle={() =>
                  setExpandedTxn((prev) => (prev === txn.transactionId ? null : txn.transactionId))
                }
              />
            ))}
          </ul>
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
      <tr onClick={onToggle} aria-expanded={isExpanded} className="cursor-pointer">
        {/* "Paid but no voucher" used to tint the whole card amber. A tinted row
            loses its tint to the table's hover rule, so the alert became a left
            rail — which survives hover and still reads down the column. A raw
            <td> here because the rail is an inline style and Td takes none;
            .sf-table still supplies the cell padding. */}
        <td
          className="text-[var(--fg-muted)]"
          style={txn.paidUnclaimed ? { boxShadow: "inset 3px 0 0 var(--warning-fg)" } : undefined}
        >
          <span>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        </td>
        <Td>
          <RecordCell
            tone={TONE_TILE[cfg.tone] || "slate"}
            icon={<Icon size={14} />}
            title={txn.transactionId}
            subtitle={txn.sessionId ? `${txn.sessionId.slice(0, 20)}…` : "No session"}
            mono
          />
        </Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1.5">
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
        <Td align="right" nowrap strong className="tabular-nums">
          {txn.amount != null ? `$${Number(txn.amount).toFixed(2)}` : "—"}
        </Td>
        <Td nowrap muted>
          {/* When it started and how much happened travel together. */}
          <span className="block">
            {formatDate(txn.startedAt)}
            <span className="block text-[11.5px] text-[var(--fg-muted)] tabular-nums">
              {txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}
            </span>
          </span>
        </Td>
      </tr>

      <AnimatePresence>
        {isExpanded && (
          <tr>
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
                <Timeline txn={txn} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * One transaction on a phone. Three lines: what it is and what it cost, how it
 * ended, and the customer details that identify it — instead of the six
 * labelled lines a stacked table gave each row, which made thirty of them four
 * thousand pixels of identical grey labels.
 *
 * Tapping opens the same timeline the table row opens.
 */
function PhoneFlowRow({ txn, isExpanded, onToggle }) {
  const cfg = STATUS_CFG[txn.overallStatus] || STATUS_CFG.in_progress;
  const Icon = cfg.icon;
  const meta = [txn.planKey, txn.customerPhone, formatShortDate(txn.startedAt)].filter(Boolean);

  return (
    <li className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        // The amber rail for a payment with no voucher against it, as on the
        // desktop row — an alert that survives being tapped.
        className={
          "w-full px-4 py-3 flex flex-col gap-2 text-left active:bg-[var(--bg-surface)] transition-colors " +
          (txn.paidUnclaimed ? "shadow-[inset_3px_0_0_var(--warning-fg)]" : "")
        }
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <ObjectTile tone={TONE_TILE[cfg.tone] || "slate"} size="sm">
            <Icon size={14} />
          </ObjectTile>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[13.5px] font-semibold text-[var(--fg-primary)] [overflow-wrap:anywhere]">
              {txn.transactionId}
            </span>
            {/* The session id, as on the desktop row — this page filters by it
                and other screens drill in on it, so the card cannot be the one
                place it is missing. Truncated rather than wrapped: a Ruijie
                token is 40-odd characters and the id above it is the line that
                earns the room. The word keeps it from reading as the rest of
                the transaction id. */}
            <span className="mt-0.5 block truncate text-[11px] leading-snug text-[var(--fg-muted)]">
              {txn.sessionId ? (
                <>
                  Session <span className="font-mono">{shortSession(txn.sessionId)}</span>
                </>
              ) : (
                "No session"
              )}
            </span>
          </span>
          <span className="shrink-0 text-[14px] font-semibold tabular-nums text-[var(--fg-primary)]">
            {txn.amount != null ? `$${Number(txn.amount).toFixed(2)}` : "—"}
          </span>
          <span className="shrink-0 text-[var(--fg-muted)]">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
          {txn.paidUnclaimed && (
            <StatusPill tone="warning" dot={false}>
              Paid · no voucher
            </StatusPill>
          )}
          {txn.claimed && (
            <Badge tone="brand" icon={<Ticket size={11} />}>
              {txn.voucherCode || "Voucher claimed"}
            </Badge>
          )}
        </span>

        {/* Each fact stays whole ("Sep 18, 09:12" does not split at its
            comma); the zero-width space after each dot is where the line may
            break instead, so a dot ends a line rather than opening one. */}
        <span className="text-[12px] leading-snug text-[var(--fg-muted)] [overflow-wrap:anywhere]">
          {[...meta, `${txn.eventCount} event${txn.eventCount !== 1 ? "s" : ""}`].map((part, i) => (
            <span key={part + i}>
              {i > 0 && <span className="px-1 opacity-60">·</span>}
              {i > 0 && "\u200B"}
              <span className="whitespace-nowrap">{part}</span>
            </span>
          ))}
        </span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <Timeline txn={txn} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** The opened transaction's steps, the same either side of the breakpoint. */
function Timeline({ txn }) {
  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-6 max-sm:px-4 max-sm:py-5 text-left">
      <p className="text-label mb-5 max-sm:mb-4">
        Event timeline · {txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}
      </p>

      <ol className="relative max-w-3xl">
        {txn.events.map((ev, i) => (
          <TimelineStep key={ev.id || i} event={ev} isLast={i === txn.events.length - 1} />
        ))}
      </ol>
    </div>
  );
}

/**
 * The status filter on a phone: every status as a chip, scrolling sideways.
 * Bleeds to the card's edges so the strip reads as something to flick, and so
 * the first chip still lines up with the search boxes above it.
 */
function StatusChips({ value, onChange }) {
  // Two boxes, because the Toolbar makes each of its children exactly its
  // width (w-full, !important): a strip that was itself the child could pull
  // its left edge out with a negative margin but not its right, so it stopped
  // a gutter short of the card and cut the last chip off in mid-air. The outer
  // box takes the row; the inner one, an ordinary block, is free to be 24px
  // wider than it.
  return (
    <div className="max-sm:order-3">
      <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-3 px-3">
        {STATUS_OPTIONS.map((o) => {
          const active = o.value === value;
          // Paid with no voucher is the one state on this page that costs a
          // customer money, and every chip selects in brand red — so selecting
          // the worst one looked like selecting "Success". It takes the amber it
          // already wears everywhere else on the page: the rail down the left of
          // such a row, and the "Paid · no voucher" pill on the row itself. A
          // second red would have been the same red at a glance.
          const alarm = o.value === "paid_unclaimed";
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              // The border colours need `!`: main.css paints every element's
              // border with an unlayered `* { border-color }`, which outranks
              // any layered utility — so without it the amber chip wore the
              // same grey ring as an unselected one.
              className={
                "shrink-0 h-9 px-3.5 rounded-full border text-[12.5px] font-semibold whitespace-nowrap transition-colors " +
                (active
                  ? alarm
                    ? "bg-[var(--warning-soft)] text-[var(--warning-fg)] border-[var(--warning-border)]!"
                    : "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border-transparent!"
                  : "bg-[var(--bg-surface)] text-[var(--fg-secondary)] border-[var(--border-default)]")
              }
            >
              {o.value === "" ? "All" : o.label}
            </button>
          );
        })}
      </div>
    </div>
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
