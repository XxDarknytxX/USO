// src/pages/PortalAuditLogPage.jsx
// Captive-portal audit log — payment, handshake, voucher, auth events.

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  X,
} from "lucide-react";

import { portalAuditApi } from "../services/api";
import Pagination from "../components/shared/Pagination";
import { Badge, EmptyState, PageHeader, Panel } from "../components/ui";

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
  system_error: "danger",
};

function formatEventLabel(eventType) {
  return eventType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
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
    return (
      <span className="text-[11.5px] text-[var(--text-quaternary)]">No data</span>
    );
  }
  return (
    <pre
      className={
        "text-[11px] leading-relaxed font-mono " +
        "bg-[var(--surface-sunken)] border border-[var(--border-subtle)] " +
        "text-[var(--text-secondary)] rounded-md p-3 overflow-x-auto max-h-80 " +
        "whitespace-pre-wrap break-words"
      }
    >
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
  const hasFilters =
    eventType || transactionId.trim() || sessionId.trim() || startDate || endDate;

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
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Portal"
        title="Portal Logs"
        subtitle={`${total.toLocaleString()} events`}
        icon={<FileText size={20} />}
      />

      <div className="mt-6 space-y-4">
        {/* Filters */}
        <Panel
          title="Filters"
          icon={<Filter size={15} />}
          actions={
            hasFilters ? (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-[11.5px] text-[var(--accent)] hover:text-[var(--brand-hover)] transition-colors"
              >
                <RotateCcw size={11} /> Clear all
              </button>
            ) : null
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Event type">
              <select
                value={eventType}
                onChange={(e) => {
                  setEventType(e.target.value);
                  setPage(1);
                }}
                className={filterClass()}
              >
                <option value="">All events</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {formatEventLabel(t)}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterSearch
              label="Transaction ID"
              placeholder="Search…"
              value={transactionId}
              onChange={(v) => {
                setTransactionId(v);
                setPage(1);
              }}
            />

            <FilterSearch
              label="Session ID"
              placeholder="Search…"
              value={sessionId}
              onChange={(v) => {
                setSessionId(v);
                setPage(1);
              }}
            />

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
        </Panel>

        {/* Table */}
        <Panel padding={false}>
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 rounded skeleton" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No audit events"
              description={hasFilters ? "Try widening the filters." : "Events will appear as portal traffic flows."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-surface)] text-left text-label border-b border-[var(--border-default)]">
                    <th className="px-3 py-2.5 w-8" />
                    <th className="px-3 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">Event</th>
                    <th className="px-3 py-2.5">Transaction</th>
                    <th className="px-3 py-2.5">Plan</th>
                    <th className="px-3 py-2.5">Voucher</th>
                    <th className="px-3 py-2.5">Amount</th>
                    <th className="px-3 py-2.5">Phone</th>
                    <th className="px-3 py-2.5">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
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
        </Panel>
      </div>
    </div>
  );
}

function LogRow({ log, isExpanded, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors"
      >
        <td className="px-3 py-2.5 text-[var(--text-quaternary)]">
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </td>
        <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-tertiary)] whitespace-nowrap">
          {formatTimestamp(log.event_timestamp)}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={EVENT_TONES[log.event_type] || "neutral"}>
            {formatEventLabel(log.event_type)}
          </Badge>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--brand-fg-on-soft)]">
          {log.transaction_id || "—"}
        </td>
        <td className="px-3 py-2.5 text-[12px] text-[var(--text-secondary)]">
          {log.plan_key || "—"}
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-primary)]">
          {log.voucher_code || "—"}
        </td>
        <td className="px-3 py-2.5 text-[12px] font-mono text-[var(--text-secondary)] whitespace-nowrap">
          {log.amount != null ? `$${Number(log.amount).toFixed(2)}` : "—"}
        </td>
        <td className="px-3 py-2.5 text-[12px] font-mono text-[var(--text-secondary)]">
          {log.customer_phone || "—"}
        </td>
        <td className="px-3 py-2.5 text-[12px] text-[var(--text-tertiary)]">
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
                <div className="px-6 py-4 bg-[var(--surface-sunken)] border-t border-[var(--border-subtle)]">
                  {log.event_data?.message && (
                    <div
                      className={
                        "mb-4 p-3 rounded-md " +
                        "bg-[var(--surface-raised)] border border-[var(--border-subtle)]"
                      }
                    >
                      <span className="text-[12px] font-medium text-[var(--text-tertiary)] block mb-1">
                        Summary
                      </span>
                      <p className="text-[13px] text-[var(--text-primary)]">
                        {log.event_data.message}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <DetailItem label="Event ID" value={log.id} />
                    <DetailItem label="Session ID" value={log.session_id} />
                    <DetailItem label="User Group ID" value={log.user_group_id} />
                    <DetailItem label="Source IP" value={log.source_ip} />
                    <DetailItem label="Client IP" value={log.event_data?.clientIp} />
                    <DetailItem label="User Agent" value={log.event_data?.userAgent} />
                    <DetailItem
                      label="Received at"
                      value={formatTimestamp(log.received_at)}
                    />
                    <DetailItem
                      label="Event timestamp"
                      value={formatTimestamp(log.event_timestamp)}
                    />
                    {log.event_data?.error && (
                      <DetailItem label="Error" value={log.event_data.error} />
                    )}
                  </div>

                  <div>
                    <span className="text-[12px] font-medium text-[var(--text-tertiary)] block mb-2">
                      Event data
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
      <span className="text-[12px] font-medium text-[var(--text-tertiary)]">
        {label}
      </span>
      <p className="text-[12.5px] text-[var(--text-secondary)] font-mono mt-0.5 break-all">
        {value || "—"}
      </p>
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
