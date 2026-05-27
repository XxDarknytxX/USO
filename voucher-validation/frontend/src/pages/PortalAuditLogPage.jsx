// src/pages/PortalAuditLogPage.jsx
import { useEffect, useState, useCallback } from "react";
import { portalAuditApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import toast from "react-hot-toast";
import {
  FileText,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const EVENT_TYPES = [
  // Payment lifecycle
  "payment_initiated",
  "payment_success",
  "payment_failed",
  // M-PAiSA handshake
  "handshake_success",
  "handshake_failed",
  "handshake_error",
  // Callback events
  "callback_received",
  // Voucher lifecycle
  "voucher_claimed",
  "voucher_claim_failed",
  "voucher_released",
  "voucher_service_error",
  // Authentication
  "auth_attempted",
  "auth_success",
  "auth_failed",
  // Session issues
  "no_session_id",
  // Manual assistance
  "manual_assistance_created",
  "case_creation_failed",
  // System
  "system_error",
];

const eventColors = {
  // Payment
  payment_initiated: "bg-blue-50 text-blue-700",
  payment_success: "bg-green-50 text-green-700",
  payment_failed: "bg-red-50 text-red-700",
  // Handshake
  handshake_success: "bg-teal-50 text-teal-700",
  handshake_failed: "bg-orange-50 text-orange-700",
  handshake_error: "bg-red-50 text-red-700",
  // Callback
  callback_received: "bg-slate-50 text-slate-700",
  // Voucher
  voucher_claimed: "bg-purple-50 text-purple-700",
  voucher_claim_failed: "bg-orange-50 text-orange-700",
  voucher_released: "bg-indigo-50 text-indigo-700",
  voucher_service_error: "bg-red-50 text-red-700",
  // Auth
  auth_attempted: "bg-blue-50 text-blue-700",
  auth_success: "bg-green-50 text-green-700",
  auth_failed: "bg-red-50 text-red-700",
  // Session
  no_session_id: "bg-amber-50 text-amber-700",
  // Manual assistance
  manual_assistance_created: "bg-amber-50 text-amber-700",
  case_creation_failed: "bg-red-100 text-red-800",
  // System
  system_error: "bg-red-100 text-red-800",
};

function formatEventLabel(eventType) {
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
    return <span className="text-gray-400 text-xs">No data</span>;
  }

  return (
    <pre className="text-xs leading-relaxed text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto max-h-80 whitespace-pre-wrap break-words font-mono">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function PortalAuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);

  // Filters
  const [eventType, setEventType] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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

  const hasActiveFilters =
    eventType || transactionId.trim() || sessionId.trim() || startDate || endDate;

  const clearFilters = () => {
    setEventType("");
    setTransactionId("");
    setSessionId("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const toggleRow = (id) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
          <FileText className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            Portal Audit Logs
          </h1>
          <p className="text-sm text-gray-500">{total} events</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
          <Filter size={14} className="text-gray-400" />
          Filters
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 transition-colors"
            >
              <RotateCcw size={12} />
              Clear all
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Event type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Event Type</label>
            <select
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value);
                setPage(1);
              }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Events</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatEventLabel(t)}
                </option>
              ))}
            </select>
          </div>

          {/* Transaction ID search */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Transaction ID</label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search transaction..."
                value={transactionId}
                onChange={(e) => {
                  setTransactionId(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {transactionId && (
                <button
                  onClick={() => {
                    setTransactionId("");
                    setPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Session ID search */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Session ID</label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search session..."
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {sessionId && (
                <button
                  onClick={() => {
                    setSessionId("");
                    setPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Start date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* End date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No audit log events found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 w-8" />
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Transaction ID</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Voucher Code</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Customer Phone</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    isExpanded={expandedRow === log.id}
                    onToggle={() => toggleRow(log.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}

function LogRow({ log, isExpanded, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="hover:bg-gray-50 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3 text-gray-400">
          {isExpanded ? (
            <ChevronUp size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </td>
        <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
          {formatTimestamp(log.event_timestamp)}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              eventColors[log.event_type] || "bg-gray-50 text-gray-600"
            }`}
          >
            {formatEventLabel(log.event_type)}
          </span>
        </td>
        <td className="px-4 py-3 font-mono text-purple-600 text-xs">
          {log.transaction_id || "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {log.plan_key || "—"}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-gray-700">
          {log.voucher_code || "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
          {log.amount != null ? `$${Number(log.amount).toFixed(2)}` : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {log.customer_phone || "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {log.source_system || "—"}
        </td>
      </tr>

      <AnimatePresence>
        {isExpanded && (
          <tr>
            <td colSpan={9} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100">
                  {/* Human-readable summary message */}
                  {log.event_data?.message && (
                    <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1">
                        Summary
                      </span>
                      <p className="text-sm text-gray-800">
                        {log.event_data.message}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <DetailItem label="Event ID" value={log.id} />
                    <DetailItem label="Session ID" value={log.session_id} />
                    <DetailItem
                      label="User Group ID"
                      value={log.user_group_id}
                    />
                    <DetailItem label="Source IP" value={log.source_ip} />
                    <DetailItem
                      label="Client IP"
                      value={log.event_data?.clientIp}
                    />
                    <DetailItem
                      label="User Agent"
                      value={log.event_data?.userAgent}
                    />
                    <DetailItem
                      label="Received At"
                      value={formatTimestamp(log.received_at)}
                    />
                    <DetailItem
                      label="Event Timestamp"
                      value={formatTimestamp(log.event_timestamp)}
                    />
                    {log.event_data?.error && (
                      <DetailItem
                        label="Error"
                        value={log.event_data.error}
                      />
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">
                      Event Data
                    </span>
                    <JsonViewer data={log.event_data} />
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <p className="text-sm text-gray-700 font-mono mt-0.5">
        {value || "—"}
      </p>
    </div>
  );
}
