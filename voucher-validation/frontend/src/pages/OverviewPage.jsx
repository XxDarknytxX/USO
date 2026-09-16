// src/pages/OverviewPage.jsx
//
// The NOC board: every village's live state on one screen, served from the
// background collector's snapshots and re-read every 30s.
//
// Rebuilt as a Lightning list page — four KPIs that answer "is the estate up?",
// a filter strip, then one dense table. The old version put "villages up" and
// "villages down" side by side as two of its four tiles, which spent half the
// summary restating the same fraction; the down count now rides on the villages
// tile and is one click away in the status filter, freeing a tile for the AP
// fleet, which is the number that actually explains a village being degraded.

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Globe, RefreshCw, Users, Activity, CheckCircle2, Wifi, MapPin, Network } from "lucide-react";
import { networkApi } from "../services/api";
import {
  PageShell,
  PageHeader,
  KpiGrid,
  StatCard,
  Panel,
  Button,
  Toolbar,
  SearchInput,
  Segmented,
  StatusPill,
  DataTable,
  Th,
  Td,
  TableMessage,
  RecordCell,
} from "../components/ui";
import { useSite } from "../hooks/useSite";

const fmtBytes = (b) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(b), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const timeAgo = (ts) => {
  if (!ts) return "never";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export default function OverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const navigate = useNavigate();
  const { isInScope } = useSite();
  const timer = useRef(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await networkApi.overview({ uptimeHours: 24 });
      setData(res);
    } catch (e) {
      if (!isRefresh) toast.error("Failed to load overview: " + e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Cheap poll: re-reads the stored snapshot only, no Ruijie calls.
    timer.current = setInterval(() => load(true), 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  // Refresh means COLLECT — go to Ruijie for every village and rewrite the
  // snapshots, then re-read. Without this the button only re-fetched the same
  // stored numbers, so a stale page stayed stale however often you pressed it.
  //
  // It is deliberately all-villages: the page compares villages side by side,
  // and refreshing one at a time would show them measured at different moments.
  // Takes the better part of a minute for ~30 villages (the Ruijie limiter
  // spaces every call), and is admin-only server-side.
  const [collecting, setCollecting] = useState(false);
  const collectAndReload = useCallback(async () => {
    setCollecting(true);
    const tid = toast.loading("Collecting every village from Ruijie… this takes a moment");
    try {
      const r = await networkApi.collectNow();
      toast.success(
        `${r.villagesUpdated ?? "?"}/${r.villagesTotal ?? "?"} villages refreshed` +
          (r.joinedExisting ? " (joined a run already in progress)" : ""),
        { id: tid, duration: 6000 }
      );
    } catch (e) {
      // Non-admins cannot collect; still give them the freshest stored numbers.
      toast.error(
        /403|forbidden|admin/i.test(e.message || "")
          ? "Only an admin can refresh from Ruijie — showing the last collected values."
          : `Collection failed: ${e.message}`,
        { id: tid, duration: 7000 }
      );
    } finally {
      await load(true);
      setCollecting(false);
    }
  }, [load]);

  // Follow the scope switcher: a single village → just that one; All Villages →
  // the configured scope set (Settings). Recompute the summary from the subset.
  const sites = useMemo(
    () => (data?.sites || []).filter((v) => isInScope(v.id)),
    [data, isInScope]
  );

  const sum = (f) => sites.reduce((a, v) => a + (Number(f(v)) || 0), 0);
  const s = data
    ? {
        villagesTotal: sites.length,
        villagesUp: sites.filter((v) => v.online === true).length,
        villagesDown: sites.filter((v) => v.online === false).length,
        villagesUnknown: sites.filter((v) => v.online == null).length,
        apsOnline: sum((v) => v.apsOnline),
        apsTotal: sum((v) => v.apsTotal),
        clients: sum((v) => v.clients),
        usageBytes: sum((v) => v.usageBytes),
      }
    : null;

  // The status filter keeps the "down" count one click away now that it no
  // longer has a KPI tile of its own.
  const statusOptions = [
    { value: "all", label: "All", count: sites.length },
    { value: "online", label: "Online", count: s?.villagesUp ?? 0 },
    { value: "down", label: "Down", count: s?.villagesDown ?? 0 },
    ...(s?.villagesUnknown ? [{ value: "unknown", label: "No data", count: s.villagesUnknown }] : []),
  ];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sites.filter((v) => {
      if (status === "online" && v.online !== true) return false;
      if (status === "down" && v.online !== false) return false;
      if (status === "unknown" && v.online != null) return false;
      if (!needle) return true;
      return (
        String(v.name || "").toLowerCase().includes(needle) ||
        String(v.hostname || "").toLowerCase().includes(needle)
      );
    });
  }, [sites, q, status]);

  const filtered = q.trim() !== "" || status !== "all";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Network"
        title="Overview"
        subtitle={`Every village at a glance${data?.lastCollected ? ` · updated ${timeAgo(data.lastCollected)}` : ""}`}
        icon={<Globe size={22} />}
        tone="navy"
        actions={
          <Button
            variant="secondary"
            size="md"
            onClick={collectAndReload}
            disabled={collecting}
            iconLeft={<RefreshCw size={14} className={collecting || refreshing ? "animate-spin" : ""} />}
          >
            {collecting ? "Collecting…" : "Refresh all"}
          </Button>
        }
      />

      <KpiGrid>
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Villages online"
          value={s ? `${s.villagesUp}/${s.villagesTotal}` : "—"}
          color="emerald"
          trend={s?.villagesDown ? "down" : undefined}
          trendValue={s?.villagesDown ? `${s.villagesDown} down` : undefined}
          sub={s?.villagesDown ? "needs attention" : "all villages reporting"}
        />
        <StatCard
          icon={<Wifi size={18} />}
          label="Access points online"
          value={s?.apsTotal ? `${s.apsOnline}/${s.apsTotal}` : "—"}
          color="blue"
          sub={s?.apsTotal ? `${s.apsTotal - s.apsOnline} offline across the estate` : "no APs reporting"}
        />
        <StatCard
          icon={<Users size={18} />}
          label="Clients online"
          value={s ? s.clients.toLocaleString() : "—"}
          color="indigo"
          sub="connected right now"
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Usage today"
          value={s ? fmtBytes(s.usageBytes) : "—"}
          color="violet"
          sub="all villages combined"
        />
      </KpiGrid>

      <Toolbar>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search villages…" />
        <Segmented options={statusOptions} value={status} onChange={setStatus} size="sm" />
        <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums">
          {filtered
            ? `${rows.length} of ${sites.length} villages`
            : `${sites.length} village${sites.length === 1 ? "" : "s"}`}
        </span>
      </Toolbar>

      <Panel
        title="Village status"
        subtitle="Collected every ~5 min · re-read every 30s"
        icon={<Network size={15} />}
        tone="navy"
        padding={false}
      >
        <DataTable>
          <thead>
            <tr>
              <Th>Village</Th>
              <Th>Status</Th>
              <Th>Internet</Th>
              <Th>Gateway</Th>
              <Th align="right">APs</Th>
              <Th align="right">Clients</Th>
              <Th align="right">Usage</Th>
              <Th align="right">Uptime 24h</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessage colSpan={8}>Loading…</TableMessage>
            ) : rows.length === 0 ? (
              <TableMessage colSpan={8}>
                <span className="block font-semibold text-[var(--fg-primary)] text-[13.5px]">
                  {filtered
                    ? "No village matches these filters"
                    : (data?.sites?.length ?? 0) > 0
                      ? "No villages in the current scope"
                      : "No villages yet"}
                </span>
                <span className="block mt-1">
                  {filtered
                    ? "Clear the search or pick a different status."
                    : (data?.sites?.length ?? 0) > 0
                      ? "Adjust the All Villages scope in Settings."
                      : "Add sites under Network."}
                </span>
              </TableMessage>
            ) : (
              rows.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => navigate("/network")}
                  className="cursor-pointer"
                >
                  <Td>
                    <RecordCell
                      tone="navy"
                      icon={<MapPin size={15} />}
                      title={v.name}
                      subtitle={v.hostname || `group ${v.groupId || "—"}`}
                      mono
                    />
                  </Td>
                  <Td><State state={v.online} up="Online" down="Down" /></Td>
                  <Td><State state={v.internetUp} up="Up" down="Down" /></Td>
                  <Td><State state={v.gatewayOnline} up="Online" down="Offline" /></Td>
                  <Td align="right" nowrap className="tabular-nums">
                    {v.apsTotal ? `${v.apsOnline}/${v.apsTotal}` : "—"}
                  </Td>
                  <Td align="right" nowrap className="tabular-nums">{v.clients ?? 0}</Td>
                  <Td align="right" nowrap className="tabular-nums">{fmtBytes(v.usageBytes)}</Td>
                  <Td align="right" nowrap><Uptime pct={v.uptimePct} /></Td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>

        {/* Footnote lives with the column it explains rather than under the page,
            where it read as an unrelated aside. */}
        {!loading && sites.some((v) => v.uptimePct == null) && (
          <p className="px-5 py-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--fg-muted)]">
            Uptime fills in as the background monitor collects samples (every ~5 min) — give it a little while
            after the first deploy.
          </p>
        )}
      </Panel>
    </PageShell>
  );
}

/** Tri-state cell: up / down / not reported. */
function State({ state, up = "Up", down = "Down" }) {
  if (state == null) return <StatusPill tone="neutral">No data</StatusPill>;
  return <StatusPill tone={state ? "success" : "danger"}>{state ? up : down}</StatusPill>;
}

function Uptime({ pct }) {
  if (pct == null) return <span className="text-[12px] text-[var(--fg-muted)]">collecting…</span>;
  const color = pct >= 99 ? "var(--success-fg)" : pct >= 90 ? "var(--warning-fg)" : "var(--danger-fg)";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {/* A bar as well as the figure: 97% and 99.9% are hard to tell apart as
          numbers when you are scanning thirty rows for the bad one. */}
      <span className="hidden lg:block w-14 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </span>
      <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>{pct}%</span>
    </span>
  );
}
