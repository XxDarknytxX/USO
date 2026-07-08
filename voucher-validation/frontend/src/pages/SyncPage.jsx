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
import {
  Button,
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  SkeletonTable,
} from "../components/ui";

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
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Operations"
        title="Sync"
        subtitle="Pull the latest voucher inventory from Ruijie Cloud."
        icon={<RefreshCw size={20} />}
        actions={
          <>
            <Button
              onClick={testConnection}
              variant="secondary"
              size="md"
              loading={testing}
              iconLeft={!testing && <Wifi size={14} />}
            >
              Test connection
            </Button>
            <Button
              onClick={handleSync}
              variant="primary"
              size="md"
              loading={syncing}
              iconLeft={!syncing && <RefreshCw size={14} />}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </>
        }
      />

      <div className="mt-6 space-y-5">
        {/* ----- Action cards ----- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel
            title="Sync vouchers"
            subtitle="Pull the latest inventory from Ruijie Cloud"
            icon={<ArrowDownCircle size={15} />}
          >
            <div className="flex flex-col gap-3">
              {lastSync && (
                <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">
                  Last sync · {formatDate(lastSync.sync_started_at)}
                  <br />
                  {lastSync.total_processed} processed · {lastSync.total_new} new
                  · {lastSync.total_updated} updated
                </p>
              )}
              <Button
                onClick={handleSync}
                variant="primary"
                size="md"
                loading={syncing}
                iconLeft={!syncing && <RefreshCw size={14} />}
                className="w-full"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </Panel>

          <Panel
            title="API connection"
            subtitle="Test Ruijie Cloud API connectivity"
            icon={<Wifi size={15} />}
          >
            <div className="flex flex-col gap-3">
              {connectionStatus && (
                <div
                  className={
                    "flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] font-medium border " +
                    (connectionStatus.success
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20")
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
                className="w-full"
              >
                Test connection
              </Button>
            </div>
          </Panel>
        </div>

        {/* ----- History table ----- */}
        {loading ? (
          <SkeletonTable rows={5} cols={8} />
        ) : (
          <Panel
            title="Sync history"
            icon={<Clock size={15} />}
            padding={false}
          >
            {syncLogs.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No sync history"
                description="Run a sync to populate this log."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-label border-b border-[var(--border-default)]">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Fetched</th>
                      <th className="px-5 py-3">Processed</th>
                      <th className="px-5 py-3">New</th>
                      <th className="px-5 py-3">Updated</th>
                      <th className="px-5 py-3">Archived</th>
                      <th className="px-5 py-3">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-default)]">
                    {syncLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-[var(--bg-surface)] transition-colors"
                      >
                        <td className="px-5 py-3 text-[12.5px] font-mono text-[var(--fg-secondary)]">
                          {formatDate(log.sync_started_at)}
                        </td>
                        <td className="px-5 py-3">
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
                        <td className="px-5 py-3 text-[12.5px] text-[var(--fg-muted)]">
                          {log.user_email || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Td({ children, accent }) {
  const color =
    accent === "success"
      ? "text-emerald-400"
      : accent === "info"
        ? "text-blue-400"
        : accent === "warning"
          ? "text-amber-400"
          : "text-[var(--fg-secondary)]";
  return (
    <td className={`px-5 py-3 text-[13px] font-semibold ${color}`}>
      {children}
    </td>
  );
}
