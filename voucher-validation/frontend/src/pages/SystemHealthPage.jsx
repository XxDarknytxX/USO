// src/pages/SystemHealthPage.jsx
// The machine this console runs on.
//
// One VM carries thirty-three PM2 processes, MySQL, and — since telemetry
// landed — a job writing roughly 180,000 rows a day. A table growing quietly
// until the disk fills is the kind of failure that takes the whole estate down
// with no warning, so the point of this page is to make that visible early
// rather than to be a pretty system monitor.

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Server, Cpu, MemoryStick, HardDrive, Database, RefreshCw, Activity, Box,
} from "lucide-react";
import { api } from "../services/api";
import {
  PageShell, PageHeader, KpiGrid, MeterCard, StatCard, Panel, Button, Toolbar,
  DataTable, Th, Td, TableMessage, StatusPill, SkeletonKpis, SkeletonCard,
} from "../components/ui";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const fmtBytes = (b) => {
  if (b == null) return "—";
  if (b >= GB) return `${(b / GB).toFixed(1)} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  return `${Math.round(b / 1024)} KB`;
};

const fmtDuration = (s) => {
  if (s == null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

// Shared with the meters so a core, a disk and a table all read hot at the
// same thresholds — a page where 85% is amber in one place and red in another
// teaches an operator to distrust its own colours.
const heat = (pct) =>
  pct >= 90 ? "var(--danger-fg)" : pct >= 70 ? "var(--warning-fg)" : "var(--success-fg)";

export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setData(await api("/system/health", { auth: true }));
    } catch (e) {
      if (!isRefresh) toast.error("Could not read system health: " + e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 10s: fast enough that CPU is live, slow enough that the page is not
    // itself a meaningful load on the box it is measuring.
    timer.current = setInterval(() => load(true), 10000);
    return () => clearInterval(timer.current);
  }, [load]);

  const cpu = data?.cpu;
  const mem = data?.memory;
  // The fullest filesystem is the one that will take the service down, so that
  // is the one that gets the tile; the rest are listed below.
  const worstDisk = (data?.disks || []).reduce(
    (w, d) => (w == null || d.usedPct > w.usedPct ? d : w),
    null
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Server health"
        subtitle={
          data
            ? `${data.host.hostname} · ${data.host.platform} · up ${fmtDuration(data.host.uptimeSeconds)}`
            : "The machine this console runs on"
        }
        icon={<Server size={22} />}
        tone="navy"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => load(true)}
            loading={refreshing}
            iconLeft={!refreshing && <RefreshCw size={14} />}
          >
            Refresh
          </Button>
        }
      />

      {loading ? (
        <>
          <SkeletonKpis count={4} />
          <SkeletonCard height="h-[320px]" />
        </>
      ) : !data ? (
        <Panel title="Unavailable">
          <p className="text-[13px] text-[var(--fg-muted)]">
            System health could not be read. This page is admin-only and needs the
            server to be reachable.
          </p>
        </Panel>
      ) : (
        <>
          <KpiGrid cols={4}>
            <MeterCard
              label="Processor"
              used={cpu?.overallPct ?? 0}
              total={100}
              unit="%"
              showTotal={false}
              format={(n) => Number(n || 0).toFixed(0)}
              icon={<Cpu size={18} />}
              color="blue"
              sub={`${cpu?.count ?? "—"} cores · load ${cpu?.loadAvg?.[0] ?? "—"}`}
            />
            <MeterCard
              label="Memory"
              used={mem?.usedBytes ?? 0}
              total={mem?.totalBytes ?? null}
              unit=""
              format={fmtBytes}
              icon={<MemoryStick size={18} />}
              color="violet"
              sub={`${fmtBytes(mem?.freeBytes)} free`}
            />
            <MeterCard
              label={worstDisk ? `Disk · ${worstDisk.path}` : "Disk"}
              used={worstDisk?.usedBytes ?? 0}
              total={worstDisk?.totalBytes ?? null}
              unit=""
              format={fmtBytes}
              icon={<HardDrive size={18} />}
              color="orange"
              sub={`${fmtBytes(worstDisk?.freeBytes)} free`}
              noTotalNote="no filesystem reported"
            />
            <StatCard
              label="Database"
              value={fmtBytes(data.database?.totalBytes)}
              icon={<Database size={18} />}
              color="teal"
              sub={`${data.database?.tables?.length ?? 0} tables · node ${data.process?.nodeVersion}`}
            />
          </KpiGrid>

          {/* Per-core, because an average hides the case that matters: one core
              pinned at 100% while the rest idle is a stuck process, and it
              reads as a comfortable 12% on an eight-core average. */}
          <Panel
            title="Processor cores"
            subtitle={
              cpu?.model
                ? `${cpu.model} · load ${cpu.loadAvg?.join(" / ")} over 1/5/15 min`
                : undefined
            }
            icon={<Cpu size={15} />}
            tone="blue"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {(cpu?.cores || []).map((c) => (
                <div key={c.core} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[11px] text-[var(--fg-muted)]">#{c.core}</span>
                    <span className="text-[12.5px] font-semibold tabular-nums text-[var(--fg-primary)]">
                      {c.pct == null ? "—" : `${Math.round(c.pct)}%`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                    <span
                      className="block h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.min(c.pct ?? 0, 100)}%`,
                        background: heat(c.pct ?? 0),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {cpu?.loadPerCore != null && (
              <p className="mt-4 text-[12px] text-[var(--fg-muted)]">
                Load average is queue depth per core, not a percentage: {cpu.loadAvg?.[0]} across{" "}
                {cpu.count} cores is {cpu.loadPerCore}% of capacity. Sustained above 100% means
                work is waiting.
              </p>
            )}
          </Panel>

          {(data.disks || []).length > 1 && (
            <Panel title="Filesystems" icon={<HardDrive size={15} />} tone="orange" padding={false}>
              <DataTable>
                <thead>
                  <tr>
                    <Th>Mount</Th>
                    <Th align="right">Used</Th>
                    <Th align="right">Free</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Usage</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.disks.map((d) => (
                    <tr key={d.path}>
                      <Td mono>{d.path}</Td>
                      <Td align="right" className="tabular-nums">{fmtBytes(d.usedBytes)}</Td>
                      <Td align="right" className="tabular-nums">{fmtBytes(d.freeBytes)}</Td>
                      <Td align="right" className="tabular-nums">{fmtBytes(d.totalBytes)}</Td>
                      <Td align="right">
                        <span className="inline-flex items-center justify-end gap-2.5">
                          <span className="tabular-nums" style={{ color: heat(d.usedPct) }}>
                            {d.usedPct}%
                          </span>
                          <span className="hidden lg:block w-16 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${Math.min(d.usedPct, 100)}%`, background: heat(d.usedPct) }}
                            />
                          </span>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          )}

          <Panel
            title="Database tables"
            subtitle="Largest first. Row counts are InnoDB estimates, not exact totals."
            icon={<Database size={15} />}
            tone="teal"
            padding={false}
          >
            <DataTable maxHeight={320}>
              <thead>
                <tr>
                  <Th>Table</Th>
                  <Th align="right">Rows (approx)</Th>
                  <Th align="right">Size</Th>
                  <Th align="right">Share</Th>
                </tr>
              </thead>
              <tbody>
                {(data.database?.tables || []).length === 0 ? (
                  <TableMessage colSpan={4}>
                    {data.database?.error || "No table information available."}
                  </TableMessage>
                ) : (
                  data.database.tables.map((t) => {
                    const share = data.database.totalBytes
                      ? (t.bytes / data.database.totalBytes) * 100
                      : 0;
                    return (
                      <tr key={t.name}>
                        <Td mono>{t.name}</Td>
                        <Td align="right" className="tabular-nums">
                          {t.approxRows.toLocaleString()}
                        </Td>
                        <Td align="right" strong className="tabular-nums">{fmtBytes(t.bytes)}</Td>
                        <Td align="right" className="tabular-nums text-[var(--fg-muted)]">
                          {share < 1 ? "<1%" : `${Math.round(share)}%`}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
          </Panel>

          {data.pm2 && (
            <Panel
              title="Processes"
              subtitle={`${data.pm2.length} managed by PM2 · restarts climbing is the earliest sign of a crash loop`}
              icon={<Box size={15} />}
              tone="indigo"
              padding={false}
            >
              <DataTable maxHeight={320}>
                <thead>
                  <tr>
                    <Th>Process</Th>
                    <Th>Status</Th>
                    <Th align="right">CPU</Th>
                    <Th align="right">Memory</Th>
                    <Th align="right">Restarts</Th>
                    <Th align="right">Uptime</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.pm2.map((p) => (
                    <tr key={p.name}>
                      <Td mono>{p.name}</Td>
                      <Td>
                        <StatusPill tone={p.status === "online" ? "success" : "danger"}>
                          {p.status || "unknown"}
                        </StatusPill>
                      </Td>
                      <Td align="right" className="tabular-nums">{p.cpuPct}%</Td>
                      <Td align="right" className="tabular-nums">{fmtBytes(p.memoryBytes)}</Td>
                      <Td
                        align="right"
                        className="tabular-nums"
                        style={p.unstableRestarts > 0 ? { color: "var(--danger-fg)" } : undefined}
                      >
                        {p.restarts}
                        {p.unstableRestarts > 0 ? ` (${p.unstableRestarts} unstable)` : ""}
                      </Td>
                      <Td align="right" className="tabular-nums">{fmtDuration(p.uptimeSeconds)}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          )}

          <Panel title="This process" icon={<Activity size={15} />} tone="slate">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
              {[
                ["Node", data.process?.nodeVersion],
                ["Uptime", fmtDuration(data.process?.uptimeSeconds)],
                ["Resident memory", fmtBytes(data.process?.rssBytes)],
                ["Heap used", `${fmtBytes(data.process?.heapUsedBytes)} / ${fmtBytes(data.process?.heapTotalBytes)}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-label">{k}</p>
                  <p className="mt-1.5 text-[14px] font-semibold text-[var(--fg-primary)] tabular-nums">
                    {v ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </PageShell>
  );
}
