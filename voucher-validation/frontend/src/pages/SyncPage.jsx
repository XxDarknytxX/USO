// src/pages/SyncPage.jsx
// Manual sync controls + history table.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  RefreshCw,
  Wifi,
  CheckCircle,
  XCircle,
  Clock,
  ArrowDownCircle,
} from "lucide-react";

import { voucherApi } from "../services/api";
import { Button, Badge, EmptyState } from "../components/ui";

export default function SyncPage() {
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await voucherApi.syncLogs();
      setSyncLogs(data.logs || []);
    } catch {
      toast.error("Failed to load sync logs");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await voucherApi.sync();
      toast.success(
        `Sync complete · ${result.totalProcessed} processed (${result.newVouchers} new, ${result.updatedVouchers} updated, ${result.archivedVouchers || 0} archived)`
      );
      loadLogs();
    } catch (err) {
      toast.error("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await voucherApi.testConnection();
      setConnectionStatus(result);
      if (result.success) toast.success("Connection successful");
      else toast.error("Connection failed");
    } catch (err) {
      setConnectionStatus({ success: false, error: err.message });
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  function formatDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "—" : dt.toLocaleString();
  }

  const lastSync = syncLogs[0];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <RefreshCw size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Integration</span>
            <h1 className="page-title">Sync Management</h1>
            <p className="page-subtitle">
              Pull the latest voucher inventory from Ruijie Cloud.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">
        {/* ----- Action cards ----- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            icon={<ArrowDownCircle size={15} />}
            title="Sync vouchers"
            subtitle="Pull the latest inventory from Ruijie Cloud"
          >
            {lastSync && (
              <p className="text-[11.5px] font-mono text-[var(--text-tertiary)] leading-relaxed">
                Last sync · {formatDate(lastSync.sync_started_at)}
                <br />
                {lastSync.total_processed} processed · {lastSync.total_new} new ·{" "}
                {lastSync.total_updated} updated
              </p>
            )}
            <Button
              onClick={handleSync}
              variant="primary"
              size="md"
              loading={syncing}
              iconLeft={!syncing && <RefreshCw size={14} />}
              className="w-full mt-1"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </ActionCard>

          <ActionCard
            icon={<Wifi size={15} />}
            title="API connection"
            subtitle="Test Ruijie Cloud API connectivity"
          >
            {connectionStatus && (
              <div
                className={
                  "flex items-start gap-2 px-3 py-2 rounded-md text-[12px] font-medium border " +
                  (connectionStatus.success
                    ? "bg-[var(--success-soft)] text-[var(--success-fg)] border-transparent"
                    : "bg-[var(--danger-soft)] text-[var(--danger-fg)] border-[var(--brand-soft-hover)]")
                }
              >
                {connectionStatus.success ? (
                  <CheckCircle size={13} className="mt-[2px] shrink-0" />
                ) : (
                  <XCircle size={13} className="mt-[2px] shrink-0" />
                )}
                <span>
                  {connectionStatus.success
                    ? "Connected successfully"
                    : connectionStatus.error || "Connection failed"}
                </span>
              </div>
            )}
            <Button
              onClick={testConnection}
              variant="secondary"
              size="md"
              loading={testing}
              iconLeft={!testing && <Wifi size={14} />}
              className="w-full mt-1"
            >
              Test connection
            </Button>
          </ActionCard>
        </div>

        {/* ----- History table ----- */}
        <div
          className={
            "rounded-md " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "shadow-[var(--elev-1)] overflow-hidden"
          }
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
              Sync history
            </h3>
            <Clock size={14} className="text-[var(--text-quaternary)]" />
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 rounded skeleton" />
              ))}
            </div>
          ) : syncLogs.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No sync history"
              description="Run a sync to populate this log."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[var(--surface-sunken)] text-left text-[12px] font-medium text-[var(--text-tertiary)]">
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Fetched</th>
                    <th className="px-5 py-2.5 font-medium">Processed</th>
                    <th className="px-5 py-2.5 font-medium">New</th>
                    <th className="px-5 py-2.5 font-medium">Updated</th>
                    <th className="px-5 py-2.5 font-medium">Archived</th>
                    <th className="px-5 py-2.5 font-medium">User</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <td className="px-5 py-2.5 text-[12.5px] font-mono text-[var(--text-secondary)]">
                        {formatDate(log.sync_started_at)}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge
                          tone={
                            log.status === "completed"
                              ? "success"
                              : log.status === "failed"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {log.status}
                        </Badge>
                      </td>
                      <Td>{log.total_fetched}</Td>
                      <Td>{log.total_processed}</Td>
                      <Td accent="success">{log.total_new}</Td>
                      <Td accent="info">{log.total_updated}</Td>
                      <Td accent="warning">{log.total_archived || 0}</Td>
                      <td className="px-5 py-2.5 text-[12px] text-[var(--text-tertiary)] font-mono">
                        {log.user_email || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, subtitle, children }) {
  return (
    <div
      className={
        "p-5 rounded-lg flex flex-col gap-3 " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "shadow-[var(--elev-1)]"
      }
    >
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-8 rounded-md inline-flex items-center justify-center bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]">
          {icon}
        </span>
        <div className="flex flex-col">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
            {title}
          </h3>
          <p className="text-[11.5px] text-[var(--text-tertiary)]">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Td({ children, accent }) {
  const color =
    accent === "success"
      ? "text-[var(--success-fg)]"
      : accent === "info"
        ? "text-[var(--info-fg)]"
        : accent === "warning"
          ? "text-[var(--warning-fg)]"
          : "text-[var(--text-secondary)]";
  return (
    <td className={`px-5 py-2.5 text-[12.5px] font-mono font-medium ${color}`}>
      {children}
    </td>
  );
}
