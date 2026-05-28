// src/pages/TransactionFlowPage.jsx
// Per-transaction event timeline view.

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  GitBranch,
  Search,
  Filter,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Phone,
  Wifi,
  CreditCard,
  Tag,
  ArrowRight,
} from "lucide-react";

import { portalAuditApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import { Badge, EmptyState } from "../components/ui";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
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
  voucher_service_error: "danger",
  auth_attempted: "info",
  auth_success: "success",
  auth_failed: "danger",
  no_session_id: "warning",
  manual_assistance_created: "warning",
  case_creation_failed: "danger",
  system_error: "danger",
};

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

  const [transactionId, setTransactionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (transactionId.trim()) params.transactionId = transactionId.trim();
      if (sessionId.trim()) params.sessionId = sessionId.trim();
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
  }, [page, limit, transactionId, sessionId, status, startDate, endDate]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters =
    transactionId.trim() || sessionId.trim() || status || startDate || endDate;

  const clearFilters = () => {
    setTransactionId("");
    setSessionId("");
    setStatus("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <GitBranch size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Captive portal</span>
            <h1 className="page-title">Transaction Flows</h1>
            <p className="page-subtitle">
              {total.toLocaleString()} transaction{total !== 1 ? "s" : ""} — every step from
              payment to internet access.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-5 space-y-4">
        {/* Filters */}
        <div
          className={
            "rounded-lg p-4 space-y-3 " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "shadow-[var(--elev-1)]"
          }
        >
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
            <Filter size={12} className="text-[var(--text-quaternary)]" />
            Filters
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-[var(--brand)] hover:text-[var(--brand-hover)] transition-colors"
              >
                <RotateCcw size={11} /> Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterSearch
              label="Transaction ID"
              placeholder="Search txn…"
              value={transactionId}
              onChange={(v) => {
                setTransactionId(v);
                setPage(1);
              }}
            />
            <FilterSearch
              label="Session ID"
              placeholder="Search session…"
              value={sessionId}
              onChange={(v) => {
                setSessionId(v);
                setPage(1);
              }}
            />
            <FilterField label="Status">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className={filterClass()}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Start date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className={filterClass()}
              />
            </FilterField>
            <FilterField label="End date">
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className={filterClass()}
              />
            </FilterField>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div
            className={
              "rounded-lg p-4 space-y-2 " +
              "bg-[var(--surface-raised)] border border-[var(--border-default)]"
            }
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded skeleton" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div
            className={
              "rounded-md " +
              "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
              "shadow-[var(--elev-1)]"
            }
          >
            <EmptyState
              icon={GitBranch}
              title="No transactions"
              description={hasFilters ? "Try clearing filters." : "Transactions will appear as the portal processes payments."}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((txn) => (
              <TransactionCard
                key={txn.transactionId}
                txn={txn}
                isExpanded={expandedTxn === txn.transactionId}
                onToggle={() =>
                  setExpandedTxn((prev) =>
                    prev === txn.transactionId ? null : txn.transactionId
                  )
                }
              />
            ))}
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div
            className={
              "rounded-lg overflow-hidden " +
              "bg-[var(--surface-raised)] border border-[var(--border-default)]"
            }
          >
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionCard({ txn, isExpanded, onToggle }) {
  const cfg = STATUS_CFG[txn.overallStatus] || STATUS_CFG.in_progress;
  const Icon = cfg.icon;

  return (
    <div
      className={
        "rounded-lg overflow-hidden transition-colors " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-1)]"
      }
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface-hover)] transition-colors"
      >
        <span
          className={
            "h-9 w-9 rounded-md inline-flex items-center justify-center shrink-0 " +
            (cfg.tone === "success"
              ? "bg-[var(--success-soft)] text-[var(--success-fg)]"
              : cfg.tone === "warning"
                ? "bg-[var(--warning-soft)] text-[var(--warning-fg)]"
                : cfg.tone === "danger"
                  ? "bg-[var(--danger-soft)] text-[var(--danger-fg)]"
                  : "bg-[var(--info-soft)] text-[var(--info-fg)]")
          }
        >
          <Icon size={16} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">
              {txn.transactionId}
            </span>
            <Badge tone={cfg.tone}>{cfg.label}</Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-[var(--text-tertiary)] font-mono">
            {txn.planKey && (
              <span className="flex items-center gap-1">
                <Tag size={10} />
                {txn.planKey}
              </span>
            )}
            {txn.customerPhone && (
              <span className="flex items-center gap-1">
                <Phone size={10} />
                {txn.customerPhone}
              </span>
            )}
            {txn.amount != null && (
              <span className="flex items-center gap-1">
                <CreditCard size={10} />${Number(txn.amount).toFixed(2)}
              </span>
            )}
            {txn.sessionId && (
              <span className="flex items-center gap-1 truncate">
                <Wifi size={10} />
                {txn.sessionId.slice(0, 16)}…
              </span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0 mr-1">
          <p className="text-[11.5px] font-mono text-[var(--text-tertiary)]">
            {formatDate(txn.startedAt)}
          </p>
          <p className="text-[12px] font-medium text-[var(--text-tertiary)] mt-0.5">
            {txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}
          </p>
        </div>

        <span className="text-[var(--text-quaternary)] shrink-0">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
            <div className="border-t border-[var(--border-subtle)] px-5 py-5 bg-[var(--surface-sunken)]">
              <div className="flex items-center gap-1.5 mb-4 text-[12px] font-medium text-[var(--text-tertiary)]">
                <ArrowRight size={10} /> Event timeline
              </div>

              <div className="relative ml-3">
                <div className="absolute left-[6px] top-2 bottom-2 w-px bg-[var(--border-default)]" />
                {txn.events.map((ev, i) => (
                  <TimelineStep
                    key={ev.id || i}
                    event={ev}
                    isLast={i === txn.events.length - 1}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TimelineStep({ event, isLast }) {
  const [open, setOpen] = useState(false);
  const tone = STEP_TONE[event.event_type] || "neutral";
  const msg = event.event_data?.message;
  const hasError = event.event_data?.error;

  const dotClass =
    tone === "success"
      ? "bg-[var(--success-fg)]"
      : tone === "warning"
        ? "bg-[var(--warning-fg)]"
        : tone === "danger"
          ? "bg-[var(--brand)]"
          : tone === "info"
            ? "bg-[var(--info-fg)]"
            : tone === "brand"
              ? "bg-[var(--brand)]"
              : "bg-[var(--text-quaternary)]";

  return (
    <div className={`relative pl-7 ${isLast ? "" : "pb-5"}`}>
      <div
        className={
          "absolute left-0 top-1 w-[13px] h-[13px] rounded-full border-2 shadow-sm " +
          "border-[var(--surface-sunken)] " +
          dotClass
        }
      />

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
            {formatLabel(event.event_type)}
          </span>
          <span className="text-[10.5px] font-mono text-[var(--text-quaternary)]">
            {formatTs(event.event_timestamp)}
          </span>
          {event.voucher_code && (
            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
              {event.voucher_code}
            </span>
          )}
          {hasError && (
            <span className="text-[10.5px] font-medium text-[var(--brand)] flex items-center gap-0.5">
              <XCircle size={10} /> Error
            </span>
          )}
        </div>

        {msg && (
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
            {msg}
          </p>
        )}

        {event.event_data && (
          <button
            onClick={() => setOpen(!open)}
            className="text-[12px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] mt-1 transition-colors"
          >
            {open ? "Hide details" : "Show details"}
          </button>
        )}

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
                  "text-[10.5px] leading-relaxed font-mono mt-2 p-3 rounded-md " +
                  "bg-[var(--surface-raised)] border border-[var(--border-subtle)] " +
                  "text-[var(--text-secondary)] overflow-x-auto max-h-48 " +
                  "whitespace-pre-wrap break-words"
                }
              >
                {JSON.stringify(event.event_data, null, 2)}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-medium text-[var(--text-tertiary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function FilterSearch({ label, placeholder, value, onChange }) {
  return (
    <FilterField label={label}>
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
        />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={
            "h-8 pl-7 pr-7 text-[12.5px] rounded-md w-48 font-mono " +
            "bg-[var(--input-bg)] border border-[var(--input-border)] " +
            "text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] " +
            "hover:border-[var(--input-border-hover)] focus-input"
          }
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </FilterField>
  );
}

function filterClass() {
  return (
    "h-8 px-3 text-[12.5px] rounded-md " +
    "bg-[var(--input-bg)] border border-[var(--input-border)] " +
    "text-[var(--text-primary)] hover:border-[var(--input-border-hover)] focus-input"
  );
}
