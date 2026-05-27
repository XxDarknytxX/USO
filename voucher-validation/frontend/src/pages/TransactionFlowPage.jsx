// src/pages/TransactionFlowPage.jsx
// Visual timeline view — shows every transaction as a tree of ordered events
import { useEffect, useState, useCallback } from "react";
import { portalAuditApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
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
  Shield,
  Tag,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "success", label: "Success" },
  { value: "payment_failed", label: "Payment Failed" },
  { value: "auth_failed", label: "Auth Failed" },
  { value: "manual_assistance", label: "Manual Assistance" },
  { value: "handshake_failed", label: "Handshake Failed" },
  { value: "voucher_failed", label: "Voucher Failed" },
  { value: "no_session", label: "No Session" },
  { value: "system_error", label: "System Error" },
  { value: "in_progress", label: "In Progress" },
];

const statusStyles = {
  success: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", icon: CheckCircle2, label: "Success" },
  payment_failed: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: XCircle, label: "Payment Failed" },
  auth_failed: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: XCircle, label: "Auth Failed" },
  manual_assistance: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: AlertTriangle, label: "Manual Assistance" },
  handshake_failed: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: XCircle, label: "Handshake Failed" },
  voucher_failed: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: XCircle, label: "Voucher Failed" },
  no_session: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: AlertTriangle, label: "No Session" },
  system_error: { bg: "bg-red-100", border: "border-red-300", text: "text-red-800", icon: XCircle, label: "System Error" },
  in_progress: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: Clock, label: "In Progress" },
};

/* ------------------------------------------------------------------ */
/*  Event step config (dot color on the timeline)                      */
/* ------------------------------------------------------------------ */
const stepColor = {
  // payment
  payment_initiated: "bg-blue-400",
  handshake_success: "bg-teal-400",
  handshake_failed: "bg-orange-400",
  handshake_error: "bg-red-400",
  // callback
  callback_received: "bg-slate-400",
  payment_success: "bg-green-500",
  payment_failed: "bg-red-500",
  // voucher
  voucher_claimed: "bg-purple-500",
  voucher_claim_failed: "bg-orange-500",
  voucher_released: "bg-indigo-400",
  voucher_service_error: "bg-red-500",
  // auth
  auth_attempted: "bg-blue-500",
  auth_success: "bg-green-600",
  auth_failed: "bg-red-600",
  // session
  no_session_id: "bg-amber-500",
  // assistance
  manual_assistance_created: "bg-amber-600",
  case_creation_failed: "bg-red-700",
  // system
  system_error: "bg-red-700",
};

function formatTs(iso) {
  try { return format(new Date(iso), "HH:mm:ss"); } catch { return iso || "—"; }
}
function formatDate(iso) {
  try { return format(new Date(iso), "MMM dd, yyyy HH:mm:ss"); } catch { return iso || "—"; }
}
function formatLabel(s) {
  return (s || "").split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* ================================================================== */
/*  Main page                                                          */
/* ================================================================== */
export default function TransactionFlowPage() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [expandedTxn, setExpandedTxn] = useState(null);

  // Filters
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

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters = transactionId.trim() || sessionId.trim() || status || startDate || endDate;

  const clearFilters = () => {
    setTransactionId(""); setSessionId(""); setStatus(""); setStartDate(""); setEndDate(""); setPage(1);
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <GitBranch className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Transaction Flows</h1>
          <p className="text-sm text-gray-500">
            {total} transaction{total !== 1 ? "s" : ""} &mdash; visual timeline of every step
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
          <Filter size={14} className="text-gray-400" />
          Filters
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors">
              <RotateCcw size={12} /> Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {/* Transaction ID */}
          <FilterInput label="Transaction ID" placeholder="Search txn..." value={transactionId} onChange={v => { setTransactionId(v); setPage(1); }} />
          {/* Session ID */}
          <FilterInput label="Session ID" placeholder="Search session..." value={sessionId} onChange={v => { setSessionId(v); setPage(1); }} />
          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Status</label>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Start Date</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">End Date</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
      </div>

      {/* Transaction list */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm text-center py-20 text-gray-400 text-sm">
            No transactions found
          </div>
        ) : (
          transactions.map(txn => (
            <TransactionCard
              key={txn.transactionId}
              txn={txn}
              isExpanded={expandedTxn === txn.transactionId}
              onToggle={() => setExpandedTxn(prev => prev === txn.transactionId ? null : txn.transactionId)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {!loading && transactions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Transaction card — collapsed = summary row, expanded = timeline    */
/* ================================================================== */
function TransactionCard({ txn, isExpanded, onToggle }) {
  const st = statusStyles[txn.overallStatus] || statusStyles.in_progress;
  const StIcon = st.icon;

  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-all ${st.border}`}>
      {/* Summary row */}
      <button onClick={onToggle} className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors">
        {/* Status icon */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${st.bg}`}>
          <StIcon size={18} className={st.text} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-gray-800">{txn.transactionId}</span>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${st.bg} ${st.text}`}>
              {st.label}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
            {txn.planKey && <span className="flex items-center gap-1"><Tag size={10} />{txn.planKey}</span>}
            {txn.customerPhone && <span className="flex items-center gap-1"><Phone size={10} />{txn.customerPhone}</span>}
            {txn.amount != null && <span className="flex items-center gap-1"><CreditCard size={10} />${Number(txn.amount).toFixed(2)}</span>}
            {txn.sessionId && <span className="flex items-center gap-1 font-mono"><Wifi size={10} />{txn.sessionId.slice(0, 16)}...</span>}
          </div>
        </div>

        {/* Right side */}
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-500">{formatDate(txn.startedAt)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{txn.eventCount} event{txn.eventCount !== 1 ? "s" : ""}</p>
        </div>

        <div className="text-gray-400 shrink-0">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Expanded timeline */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-5 py-5 bg-gray-50/30">
              {/* Flow direction hint */}
              <div className="flex items-center gap-2 mb-4 text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
                <ArrowRight size={10} /> Event Timeline
              </div>

              {/* Timeline */}
              <div className="relative ml-4">
                {/* Vertical line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200 rounded-full" />

                {txn.events.map((ev, i) => (
                  <TimelineStep key={ev.id || i} event={ev} isLast={i === txn.events.length - 1} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  Single timeline step                                               */
/* ================================================================== */
function TimelineStep({ event, isLast }) {
  const [open, setOpen] = useState(false);
  const dotClass = stepColor[event.event_type] || "bg-gray-400";
  const msg = event.event_data?.message;
  const hasError = event.event_data?.error;

  return (
    <div className={`relative pl-7 ${isLast ? "" : "pb-5"}`}>
      {/* Dot */}
      <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 border-white shadow-sm ${dotClass}`} />

      {/* Content */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-800">{formatLabel(event.event_type)}</span>
          <span className="text-[10px] text-gray-400">{formatTs(event.event_timestamp)}</span>
          {event.voucher_code && (
            <span className="text-[10px] font-mono bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{event.voucher_code}</span>
          )}
          {hasError && (
            <span className="text-[10px] font-medium text-red-600 flex items-center gap-0.5">
              <XCircle size={10} /> Error
            </span>
          )}
        </div>

        {msg && (
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{msg}</p>
        )}

        {/* Expandable raw data */}
        {event.event_data && (
          <button onClick={() => setOpen(!open)} className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-1 transition-colors">
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
              <pre className="text-[10px] leading-relaxed text-gray-600 bg-white border border-gray-200 rounded-lg p-3 mt-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(event.event_data, null, 2)}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Reusable filter text input                                         */
/* ================================================================== */
function FilterInput({ label, placeholder, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder={placeholder} value={value}
          onChange={e => onChange(e.target.value)}
          className="border border-gray-200 rounded-lg pl-8 pr-8 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        {value && (
          <button onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
