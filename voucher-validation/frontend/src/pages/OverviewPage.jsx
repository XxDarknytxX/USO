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
import { Globe, RefreshCw, Users, Activity, CheckCircle2, Wifi, MapPin, Network, ChevronRight } from "lucide-react";
import { networkApi } from "../services/api";
import {
  PageShell,
  PageHeader,
  KpiGrid,
  StatCard,
  MeterCard,
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
import { useAuth } from "../hooks/useAuth";

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
  const { isInScope, setActiveSiteId } = useSite();
  const { isAdmin } = useAuth();

  // Selecting the scope and routing to /dashboard are one action from the
  // user's point of view, so they are one function here. The scope has to be
  // set first: DashboardRouter reads it to decide which dashboard to render.
  const openVillage = useCallback(
    (v) => {
      setActiveSiteId(v.id);
      navigate("/dashboard");
    },
    [setActiveSiteId, navigate]
  );
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
        // Computed from the scoped subset like everything else here, NOT taken
        // from the server summary — otherwise the meter would keep reporting
        // the whole estate while every figure beside it followed the scope.
        starlinkUsedGb: sum((v) => v.starlink?.usedGb),
        // Villages Starlink publishes no cap for are SKIPPED rather than added
        // as zero: counting them would inflate the denominator's credibility
        // and make the estate look further from its limit than it is. Null when
        // nothing in scope has a cap, so the card says so instead of showing a
        // meter against nothing.
        starlinkAllowanceGb: sites.some((v) => v.starlink?.allowanceGb != null)
          ? sum((v) => v.starlink?.allowanceGb)
          : null,
        villagesWithTelemetry: sites.filter((v) => v.starlink?.configured).length,
        // "No village has reported usage" and "the collector has never run"
        // look identical in the numbers and are completely different problems.
        usageCollected: data.summary?.usageCollected ?? sites.some((v) => v.starlink?.usedGb != null),
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
            // Collecting from Ruijie is admin-only on the server. Anyone else
            // gets the freshest STORED values instead of a button that errors.
            onClick={isAdmin ? collectAndReload : () => load(true)}
            disabled={collecting || (!isAdmin && refreshing)}
            iconLeft={<RefreshCw size={14} className={collecting || refreshing ? "animate-spin" : ""} />}
          >
            {collecting ? "Collecting…" : isAdmin ? "Refresh all" : "Reload"}
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
          // Half a phone's width fits the red "2 down" or its gloss, not both.
          sub={
            s?.villagesDown ? <span className="max-sm:hidden">needs attention</span> : "all villages reporting"
          }
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
        {/* Starlink data for the cycle, against the plan. Replaced a Ruijie
            "usage today" byte counter: the dish meters the actual backhaul and
            is the figure the villages are billed on, and unlike the Ruijie
            number it still works where a gateway does not report flow.
            The allowance total deliberately skips villages Starlink publishes
            no cap for rather than counting them as zero, which would make the
            estate look closer to its limit than it is. */}
        {s && !s.usageCollected ? (
          // Never render 0 GB here. Before the usage collector has run, zero is
          // not a measurement — it is the absence of one, and showing it as a
          // figure sends someone hunting for missing traffic that was never
          // missing. Say what is actually wrong and where to fix it.
          <StatCard
            icon={<Activity size={18} />}
            // Two tiles share a phone's width; the cycle is implied.
            label={<>Starlink data<span className="max-sm:hidden"> · this cycle</span></>}
            value="—"
            color="slate"
            sub="usage collection is off — enable it in Settings"
          />
        ) : (
          <MeterCard
            icon={<Activity size={18} />}
            // On a phone this tile keeps its glyph beside a half-width label.
            label={<>Starlink<span className="max-sm:hidden"> data · this cycle</span></>}
            used={s?.starlinkUsedGb ?? 0}
            total={s?.starlinkAllowanceGb ?? null}
            unit="GB"
            format={(n) => Math.round(Number(n || 0)).toLocaleString()}
            color="violet"
            sub={
              s?.villagesWithTelemetry != null
                ? `across ${s.villagesWithTelemetry} linked ${s.villagesWithTelemetry === 1 ? "kit" : "kits"}`
                : "all villages combined"
            }
            noTotalNote="Starlink publishes no plan cap"
          />
        )}
      </KpiGrid>

      <Toolbar>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search villages…" />
        <Segmented
          options={statusOptions}
          value={status}
          onChange={setStatus}
          size="sm"
          // Full width on a phone: the options share it rather than huddling left.
          className="max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
        />
        {/* Unfiltered, the "All" pill already carries the count on a phone. */}
        <span className={`ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums${filtered ? "" : " max-sm:hidden"}`}>
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
              {/* Two layers, each carrying its own uptime beneath its state.
                  Status is the village's actual internet, measured from the
                  Starlink dish. Gateway is the Ruijie box on the ground. They
                  can disagree, and when they do that disagreement is the useful
                  part — a dish up behind a dead gateway is a site visit, a
                  gateway up behind a dark dish is a Starlink problem.

                  The old "Local link" column was the gateway's own opinion of
                  its WAN, which is a third answer to a question the other two
                  already cover, and mostly just tracked Gateway. */}
              <Th>Status</Th>
              <Th>Gateway</Th>
              <Th align="right">Starlink GB</Th>
              <Th align="right">Link quality</Th>
              <Th align="right">APs</Th>
              <Th align="right">Clients</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessage colSpan={7}>Loading…</TableMessage>
            ) : rows.length === 0 ? (
              <TableMessage colSpan={7}>
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
                  // Opens THIS village's dashboard. /dashboard is one route in
                  // two modes (DashboardRouter): with a village in scope it
                  // renders that village's SiteDashboard, so selecting the
                  // scope IS the navigation. It used to drop you on /network,
                  // which answered a different question from the one a row
                  // click asks.
                  onClick={() => openVillage(v)}
                  title={`Open ${v.name}`}
                  className="cursor-pointer"
                >
                  <Td>
                    {/* On a phone the row is a card; the chevron says it opens. */}
                    <div className="max-sm:flex max-sm:w-full max-sm:items-center max-sm:justify-between max-sm:gap-3">
                      <RecordCell
                        tone="navy"
                        icon={<MapPin size={15} />}
                        title={v.name}
                        subtitle={v.hostname || `group ${v.groupId || "—"}`}
                        mono
                      />
                      <ChevronRight size={16} aria-hidden="true" className="sm:hidden shrink-0 text-[var(--fg-subtle)]" />
                    </div>
                  </Td>
                  <Td>
                    <StateWithUptime
                      pill={<OnlineState site={v} />}
                      pct={v.starlink?.uptimePct}
                      title="Share of the time the Starlink dish was reporting"
                    />
                  </Td>
                  <Td>
                    <StateWithUptime
                      pill={<State state={v.gatewayOnline} up="Online" down="Offline" />}
                      pct={v.uptimePct}
                      title="Share of collector samples with the gateway's WAN up"
                    />
                  </Td>
                  {/* A village with no kit linked has nothing to say in either
                      Starlink line, so its phone card leaves them out. */}
                  <Td align="right" nowrap className={`tabular-nums${v.starlink?.configured ? "" : " max-sm:hidden!"}`}>
                    <SlData sl={v.starlink} />
                  </Td>
                  <Td align="right" nowrap className={v.starlink?.configured ? undefined : "max-sm:hidden!"}>
                    <LinkQuality sl={v.starlink} />
                  </Td>
                  <Td align="right" nowrap className="tabular-nums">
                    {v.apsTotal ? `${v.apsOnline}/${v.apsTotal}` : "—"}
                  </Td>
                  <Td align="right" nowrap className="tabular-nums">{v.clients ?? 0}</Td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>

        {/* Footnote lives with the column it explains rather than under the page,
            where it read as an unrelated aside. */}
        {!loading && sites.some((v) => v.uptimePct == null) && (
          <p className="px-5 py-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--fg-muted)]">
            Each state carries its own uptime: Status is the share of time the Starlink dish was
            reporting, Gateway the share of collector samples with the gateway's WAN up. Both read
            "no history" until their collector has run for a while.
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

/**
 * A state and the share of time it has held, stacked.
 *
 * The two live together because apart they invite the wrong reading: "Online"
 * over "71%" is a village that is up right now and has not been reliably, which
 * is a different and more actionable fact than either line alone. Keeping each
 * uptime under the thing it measures also stops the page having one uptime
 * column that quietly belongs to only one of two layers.
 */
function StateWithUptime({ pill, pct, title }) {
  const color =
    pct == null
      ? "var(--fg-muted)"
      : pct >= 99
        ? "var(--success-fg)"
        : pct >= 90
          ? "var(--warning-fg)"
          : "var(--danger-fg)";
  return (
    // Side by side on a phone card (pill at the right edge, uptime before it):
    // stacked, each state cost a second line on every village.
    <span className="flex flex-col items-start gap-1 max-sm:flex-row-reverse max-sm:items-center max-sm:gap-2">
      {pill}
      <span className="text-[11px] tabular-nums" style={{ color }} title={title}>
        {pct == null ? "no history" : `${pct}%`}
      </span>
    </span>
  );
}

/**
 * The village's overall verdict. Distinct from `State` because null here does
 * NOT mean "no data" — when telemetry is the source it means we have data and
 * it is merely stale, which is a different and more useful thing to say. Only a
 * village we have genuinely never heard from gets "No data".
 */
function OnlineState({ site }) {
  const { online, onlineSource, starlink } = site;
  if (online === true) return <StatusPill tone="success">Online</StatusPill>;
  if (online === false) return <StatusPill tone="danger">Down</StatusPill>;
  if (onlineSource === "telemetry") {
    const mins = starlink?.ageSeconds != null ? Math.round(starlink.ageSeconds / 60) : null;
    return (
      <StatusPill tone="warning" title={mins != null ? `Last reported ${mins} minutes ago` : undefined}>
        {mins != null ? `Quiet ${mins}m` : "Quiet"}
      </StatusPill>
    );
  }
  return <StatusPill tone="neutral">No data</StatusPill>;
}

/**
 * Starlink consumption for the current billing cycle. Replaced the old Ruijie
 * byte counter in this slot: the dish meters the actual backhaul, so it is
 * both the authoritative number and the one that still works on villages whose
 * gateway does not report per-voucher flow.
 *
 * An allowance is printed only where Starlink publishes one — a cap of zero
 * means "none published", and rendering that as "0 GB" would say the opposite.
 */
function SlData({ sl }) {
  if (!sl?.configured) return <span className="text-[var(--fg-subtle)]" title="No Starlink kit linked">—</span>;
  if (sl.usedGb == null) return <span className="text-[var(--fg-subtle)]" title="No usage reported this cycle yet">—</span>;
  const g = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));
  return (
    <span
      title={
        sl.allowanceGb
          ? `${Math.round((sl.usedGb / sl.allowanceGb) * 100)}% of the ${g(sl.allowanceGb)} GB allowance`
          : "Starlink publishes no plan cap for this cycle"
      }
    >
      {g(sl.usedGb)}
      {sl.allowanceGb ? <span className="text-[var(--fg-subtle)]"> / {g(sl.allowanceGb)}</span> : null} GB
    </span>
  );
}

/**
 * How the link is actually behaving, which "Online" cannot express: a dish can
 * be reporting steadily and still be unusable behind an obstruction or a 15%
 * drop rate. Latency leads because it is the number a field engineer acts on;
 * the rest sit in the tooltip so the column stays one line.
 */
function LinkQuality({ sl }) {
  if (!sl?.configured || sl.latencyMs == null) {
    return <span className="text-[var(--fg-subtle)]">—</span>;
  }
  const drop = sl.dropRate ?? 0;
  const obstructed = sl.obstructionPct ?? 0;
  // Thresholds are deliberately generous: satellite latency is ~40ms at best
  // and a little loss is normal weather, not a fault worth paging anyone over.
  const bad = sl.latencyMs > 150 || drop > 0.1 || obstructed > 3;
  const warn = sl.latencyMs > 90 || drop > 0.03 || obstructed > 1;
  const tone = bad ? "var(--danger-fg)" : warn ? "var(--warning-fg)" : "var(--fg-secondary)";
  return (
    <span
      className="tabular-nums"
      style={{ color: tone }}
      title={[
        `${Math.round(sl.latencyMs)} ms latency`,
        `${(drop * 100).toFixed(1)}% packet loss`,
        `${obstructed.toFixed(1)}% obstructed`,
        sl.signalQuality != null ? `${Math.round(sl.signalQuality * 100)}% signal` : null,
        sl.downlinkMbps != null ? `${sl.downlinkMbps.toFixed(1)} Mbps down` : null,
        sl.uplinkMbps != null ? `${sl.uplinkMbps.toFixed(1)} Mbps up` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {Math.round(sl.latencyMs)} ms
      {bad || warn ? <span className="ml-1.5">{bad ? "▲" : "△"}</span> : null}
      {/* No tooltip under a thumb: the phone card states the loss (and the
          obstruction once it matters) inline instead. */}
      <span className="sm:hidden text-[var(--fg-muted)]">
        {sl.dropRate != null ? ` · ${(drop * 100).toFixed(1)}% loss` : ""}
        {obstructed > 1 ? ` · ${obstructed.toFixed(1)}% obstructed` : ""}
      </span>
    </span>
  );
}

