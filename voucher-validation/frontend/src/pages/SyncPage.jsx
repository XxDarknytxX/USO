// src/pages/SyncPage.jsx
// Manual sync controls + history table.

import { useEffect, useRef, useState } from "react";
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

const LIMIT = 20;

export default function SyncPage() {
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all"); // all | manual | auto
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lastSync, setLastSync] = useState(null); // true most-recent, filter-independent

  // Mirrors typeFilter for stale-closure-safe reads: handleSync awaits the sync
  // poll (seconds) during which the user can change the filter, so the post-await
  // refetch must read the CURRENT filter, not the one captured when Sync was clicked.
  const typeFilterRef = useRef("all");

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    loadLogs({ page: 1, type: "all" });
    loadLastSync();
  }, []);

  async function loadLogs({ page: p = page, type: t = typeFilterRef.current } = {}) {
    setLoading(true);
    try {
      const data = await voucherApi.syncLogs({
        page: p,
        limit: LIMIT,
        ...(t !== "all" ? { type: t } : {}),
      });
      setSyncLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load sync logs");
    } finally {
      setLoading(false);
    }
  }

  // The "Last sync" card must reflect the true most-recent run regardless of the
  // table's filter/page, so it uses its own tiny unfiltered fetch.
  async function loadLastSync() {
    try {
      const data = await voucherApi.syncLogs({ page: 1, limit: 1 });
      setLastSync((data.logs || [])[0] || null);
    } catch {
      /* non-critical */
    }
  }

  function changeFilter(t) {
    typeFilterRef.current = t;
    setTypeFilter(t);
    setPage(1);
    loadLogs({ page: 1, type: t });
  }

  function goPage(p) {
    const next = Math.min(totalPages, Math.max(1, p));
    setPage(next);
    loadLogs({ page: next });
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const { syncId } = await voucherApi.sync();
      setPage(1);
      loadLogs({ page: 1 }); // jump to newest so the running row is visible
      const log = await voucherApi.waitForSync(syncId);
      if (!log) {
        toast("Sync is still running — see the log below.", { icon: "⏳" });
      } else if (log.status === "failed") {
        toast.error("Sync failed: " + (log.error_message || "unknown error"));
      } else {
        toast.success(
          `Sync complete · ${log.total_processed} processed (${log.total_new} new, ${log.total_updated} updated, ${log.total_archived || 0} archived)`
        );
      }
      setPage(1);
      loadLogs({ page: 1 }); // type defaults to the CURRENT filter (via ref)
      loadLastSync();
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
        {loading && syncLogs.length === 0 ? (
          <SkeletonTable rows={5} cols={9} />
        ) : (
          <Panel
            title="Sync history"
            icon={<Clock size={15} />}
            padding={false}
            actions={
              <div className="inline-flex rounded-md border border-[var(--border-default)] p-0.5">
                {[
                  { v: "all", label: "All" },
                  { v: "manual", label: "Manual" },
                  { v: "auto", label: "Automatic" },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => changeFilter(o.v)}
                    disabled={loading}
                    className={
                      "px-3 py-1 text-[12px] font-medium rounded transition-colors disabled:opacity-60 " +
                      (typeFilter === o.v
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)]")
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            }
          >
            {syncLogs.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={
                  typeFilter === "all"
                    ? "No sync history"
                    : `No ${typeFilter === "auto" ? "automatic" : "manual"} syncs`
                }
                description={
                  typeFilter === "all"
                    ? "Run a sync to populate this log."
                    : "Try a different filter."
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-label border-b border-[var(--border-default)]">
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3">Type</th>
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
                            <TypeBadge type={log.sync_type} />
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

                <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] text-[12px] text-[var(--fg-muted)]">
                  <span>
                    {total} total · page {page} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={loading || page <= 1}
                      onClick={() => goPage(page - 1)}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={loading || page >= totalPages}
                      onClick={() => goPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function TypeBadge({ type }) {
  const auto = type === "auto";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border " +
        (auto
          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
          : "bg-[var(--bg-surface)] text-[var(--fg-secondary)] border-[var(--border-default)]")
      }
    >
      {auto ? "Automatic" : "Manual"}
    </span>
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
