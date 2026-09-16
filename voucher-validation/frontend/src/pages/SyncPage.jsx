// src/pages/SyncPage.jsx
//
// Pull the voucher inventory from Ruijie Cloud, and the log of every run.
//
// The page used to say everything twice: two action cards repeated the two
// header buttons, and the last run's counts were prose inside one of them. Now
// the actions live once, in the header, the last run is a KPI row (so "did the
// overnight sync work" is answerable without reading the table), and the
// connection test reports into a single strip that only exists once you have
// run it. Nothing was dropped — it moved.

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  RefreshCw,
  Wifi,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  PlusCircle,
} from "lucide-react";

import { voucherApi } from "../services/api";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  SkeletonTable,
  PageShell,
  KpiGrid,
  StatCard,
  Toolbar,
  Segmented,
  StatusPill,
  DataTable,
  Th,
  Td,
} from "../components/ui";

const LIMIT = 20;

// Sync outcomes, said in colour once so the KPI tile and the table agree.
const STATUS_FG = {
  completed: "var(--success-fg)",
  failed: "var(--danger-fg)",
  running: "var(--warning-fg)",
};

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

  // The "Last sync" KPIs must reflect the true most-recent run regardless of the
  // table's filter/page, so they use their own tiny unfiltered fetch.
  async function loadLastSync() {
    try {
      const data = await voucherApi.syncLogs({ page: 1, limit: 1 });
      setLastSync((data.logs || [])[0] || null);
    } catch {
      /* non-critical */
    }
  }

  function changeFilter(t) {
    if (loading) return; // the strip stays visible while a page is in flight
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

  const lastStatus = lastSync?.status;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Sync"
        subtitle="Pull the latest voucher inventory from Ruijie Cloud."
        icon={<RefreshCw size={22} />}
        tone="teal"
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

      {/* The last run, which is the only thing anyone opens this page to check.
          The headline is the age of the run; the exact timestamp and outcome stay
          on the sub-line, because "did it work" is read before "when". */}
      <KpiGrid cols={4}>
        <StatCard
          label="Last sync"
          value={lastSync ? relativeTime(lastSync.sync_started_at) : "Never"}
          sub={
            lastSync ? (
              <>
                <span className="font-semibold" style={{ color: STATUS_FG[lastStatus] || "var(--fg-secondary)" }}>
                  {lastStatus}
                </span>
                {` · ${lastSync.sync_type === "auto" ? "Automatic" : "Manual"} · ${formatDate(
                  lastSync.sync_started_at
                )}`}
              </>
            ) : (
              "Run a sync to populate this log"
            )
          }
          icon={<Clock size={17} />}
          color="cyan"
        />
        <StatCard
          label="Processed"
          value={lastSync ? Number(lastSync.total_processed || 0).toLocaleString() : "—"}
          sub={lastSync ? `${Number(lastSync.total_fetched || 0).toLocaleString()} fetched from Ruijie` : undefined}
          icon={<Database size={17} />}
          color="blue"
        />
        <StatCard
          label="New vouchers"
          value={lastSync ? Number(lastSync.total_new || 0).toLocaleString() : "—"}
          sub="Added on the last run"
          icon={<PlusCircle size={17} />}
          color="emerald"
        />
        <StatCard
          label="Updated"
          value={lastSync ? Number(lastSync.total_updated || 0).toLocaleString() : "—"}
          sub={lastSync ? `${Number(lastSync.total_archived || 0).toLocaleString()} archived` : undefined}
          icon={<RefreshCw size={17} />}
          color="indigo"
        />
      </KpiGrid>

      {/* Connection test result — only on screen once you have asked for it. */}
      {connectionStatus && (
        <div
          role="status"
          className={
            "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[12.5px] font-medium " +
            (connectionStatus.success
              ? "bg-[var(--success-soft)] border-[var(--success-border)] text-[var(--success-fg)]"
              : "bg-[var(--danger-soft)] border-[var(--danger-border)] text-[var(--danger-fg)]")
          }
        >
          {connectionStatus.success ? (
            <CheckCircle size={14} className="mt-[1px] shrink-0" />
          ) : (
            <XCircle size={14} className="mt-[1px] shrink-0" />
          )}
          <span className="min-w-0">
            {connectionStatus.success
              ? "Connected to the Ruijie Cloud API successfully."
              : connectionStatus.error || "Connection failed"}
          </span>
        </div>
      )}

      <Toolbar>
        <Segmented
          value={typeFilter}
          onChange={changeFilter}
          options={[
            { value: "all", label: "All runs" },
            { value: "manual", label: "Manual" },
            { value: "auto", label: "Automatic" },
          ]}
          className={loading ? "opacity-60" : ""}
        />
        <span className="text-[12.5px] text-[var(--fg-muted)] ml-auto tabular-nums">
          {total.toLocaleString()} run{total === 1 ? "" : "s"} · page {page} of {totalPages}
        </span>
      </Toolbar>

      {loading && syncLogs.length === 0 ? (
        <SkeletonTable rows={5} cols={9} />
      ) : (
        <Panel title="Sync history" subtitle="Every run, manual and scheduled" icon={<Clock size={15} />} tone="teal" padding={false}>
          {syncLogs.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={typeFilter === "all" ? "No sync history" : `No ${typeFilter === "auto" ? "automatic" : "manual"} syncs`}
              description={typeFilter === "all" ? "Run a sync to populate this log." : "Try a different filter."}
              action={
                typeFilter === "all" ? (
                  <Button
                    onClick={handleSync}
                    variant="primary"
                    size="sm"
                    loading={syncing}
                    iconLeft={!syncing && <RefreshCw size={13} />}
                  >
                    {syncing ? "Syncing…" : "Sync now"}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => changeFilter("all")}>
                    Show all runs
                  </Button>
                )
              }
            />
          ) : (
            <>
              <DataTable>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th align="right">Fetched</Th>
                    <Th align="right">Processed</Th>
                    <Th align="right">New</Th>
                    <Th align="right">Updated</Th>
                    <Th align="right">Archived</Th>
                    <Th>User</Th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log) => (
                    <tr key={log.id}>
                      <Td mono nowrap>
                        {formatDate(log.sync_started_at)}
                      </Td>
                      <Td>
                        <StatusPill tone={log.sync_type === "auto" ? "info" : "neutral"}>
                          {log.sync_type === "auto" ? "Automatic" : "Manual"}
                        </StatusPill>
                      </Td>
                      <Td>
                        <StatusPill
                          tone={log.status === "completed" ? "success" : log.status === "failed" ? "danger" : "warning"}
                        >
                          {log.status}
                        </StatusPill>
                      </Td>
                      <CountCell value={log.total_fetched} />
                      <CountCell value={log.total_processed} />
                      <CountCell value={log.total_new} tone="var(--success-fg)" />
                      <CountCell value={log.total_updated} tone="var(--info-fg)" />
                      <CountCell value={log.total_archived || 0} tone="var(--warning-fg)" />
                      <Td muted nowrap>
                        {log.user_email || "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>

              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[12.5px] text-[var(--fg-muted)]">
                <span className="tabular-nums">
                  {total} total · page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" disabled={loading || page <= 1} onClick={() => goPage(page - 1)}>
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
    </PageShell>
  );
}

/* ------------ Local helpers ------------------------------------------------ */

/** A count column: tabular, and tinted only where the number carries meaning. */
function CountCell({ value, tone }) {
  return (
    <Td align="right" nowrap className="tabular-nums font-semibold">
      <span style={tone ? { color: tone } : undefined}>{Number(value || 0).toLocaleString()}</span>
    </Td>
  );
}

/** "12 min ago" — the exact timestamp still ships as the tile's sub-line. */
function relativeTime(value) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
