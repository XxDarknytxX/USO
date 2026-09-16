// src/pages/NetworkPage.jsx
//
// Network monitoring. A grid of named "projects" (each = a Ruijie Cloud
// network); selecting one opens its topology (Internet → Gateway → APs) with
// device health, and the village's Starlink usage where a kit is linked.
//
// Two layout decisions worth stating:
//  • the grid keeps cards rather than becoming a table, because a village is a
//    *place* and the record layout (tile, name, hostname, state) is how the rest
//    of the console names one — but with thirty-odd of them a search/state
//    filter strip is no longer optional.
//  • the detail page used to stack three full-width boxes, so the device table
//    pushed everything else off screen. Topology and Devices are now two views
//    of one "Site health" panel; nothing was removed, it is one click away.

import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import {
  Network,
  Plus,
  Globe,
  RefreshCw,
  ArrowLeft,
  Cloud,
  Server,
  Router,
  Wifi,
  Cpu,
  Users,
  Trash2,
  Pencil,
  ChevronRight,
  AlertTriangle,
  MapPin,
} from "lucide-react";

import { networkApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import StarlinkPanel from "../components/StarlinkPanel";
import {
  Modal,
  Field,
  Input,
  Select,
  Toggle,
  Button,
  IconButton,
  Badge,
  EmptyState,
  PageShell,
  PageHeader,
  KpiGrid,
  StatCard,
  Panel,
  GlassCard,
  ObjectTile,
  Toolbar,
  SearchInput,
  Segmented,
  StatusPill,
  DataTable,
  Th,
  Td,
  RecordCell,
} from "../components/ui";

export default function NetworkPage() {
  const { isAdmin } = useAuth();
  const { isInScope, activeSiteId } = useSite();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // project object
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await networkApi.projects();
      setProjects(data.projects || []);
    } catch (err) {
      toast.error("Failed to load projects: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // With a single village selected in the scope switcher, land straight on its
  // full diagram (topology) instead of the grid.
  useEffect(() => {
    if (activeSiteId != null && projects.length) {
      const p = projects.find((x) => x.id === activeSiteId);
      if (p) setSelected(p);
    }
  }, [activeSiteId, projects]);

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await networkApi.removeProject(confirmDelete.id);
      toast.success("Project removed");
      setConfirmDelete(null);
      loadProjects();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Follow the scope switcher: a single village → just that one; All Villages →
  // the configured scope set (Settings).
  const shownProjects = useMemo(() => projects.filter((p) => isInScope(p.id)), [projects, isInScope]);

  const activeCount = shownProjects.filter((p) => p.isActive).length;
  const stateOptions = [
    { value: "all", label: "All", count: shownProjects.length },
    { value: "active", label: "Active", count: activeCount },
    { value: "paused", label: "Paused", count: shownProjects.length - activeCount },
  ];

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return shownProjects.filter((p) => {
      if (stateFilter === "active" && !p.isActive) return false;
      if (stateFilter === "paused" && p.isActive) return false;
      if (!needle) return true;
      return (
        String(p.name || "").toLowerCase().includes(needle) ||
        String(p.hostname || "").toLowerCase().includes(needle) ||
        String(p.ruijieGroupId || "").toLowerCase().includes(needle)
      );
    });
  }, [shownProjects, q, stateFilter]);

  // ---- Detail view ----
  if (selected) {
    return <ProjectDetail project={selected} onBack={() => setSelected(null)} />;
  }

  // ---- Project grid ----
  return (
    <PageShell>
      <PageHeader
        eyebrow="Infrastructure"
        title="Network"
        subtitle={`${shownProjects.length} of ${projects.length} project${projects.length !== 1 ? "s" : ""} · device health refreshed every ~5 min`}
        icon={<Network size={22} />}
        tone="navy"
        actions={
          isAdmin && (
            <Button variant="primary" size="md" onClick={() => setShowAdd(true)} iconLeft={<Plus size={14} />}>
              Add project
            </Button>
          )
        }
      />

      {!loading && projects.length > 0 && shownProjects.length > 0 && (
        <Toolbar>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search villages…" />
          <Segmented options={stateOptions} value={stateFilter} onChange={setStateFilter} size="sm" />
          <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums">
            {visible.length} shown
          </span>
        </Toolbar>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[132px] rounded-xl skeleton" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={Network}
            title="No projects yet"
            description="Add a project to monitor its access points, gateway, and internet health."
            action={
              isAdmin && (
                <Button variant="primary" size="sm" onClick={() => setShowAdd(true)} iconLeft={<Plus size={13} />}>
                  Add project
                </Button>
              )
            }
          />
        </Panel>
      ) : shownProjects.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={Network}
            title="No villages in scope"
            description="Pick a village in the scope switcher, or adjust the All Villages scope in Settings."
          />
        </Panel>
      ) : visible.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={Network}
            title="No village matches"
            description="Clear the search, or switch the state filter back to All."
            action={
              <Button variant="secondary" size="sm" onClick={() => { setQ(""); setStateFilter("all"); }}>
                Clear filters
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isAdmin={isAdmin}
              onOpen={() => setSelected(p)}
              onEdit={() => setEditing(p)}
              onDelete={() => setConfirmDelete(p)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ProjectFormModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            loadProjects();
          }}
        />
      )}

      {editing && (
        <ProjectFormModal
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadProjects();
          }}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} width="sm">
          <Modal.Header
            eyebrow="Remove project"
            title={`Remove "${confirmDelete.name}"?`}
            subtitle="This only removes it from monitoring — it doesn't touch the Ruijie network."
            icon={Trash2}
            onClose={() => setConfirmDelete(null)}
          />
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>
              Remove
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </PageShell>
  );
}

/* ------------ Project card ------------------------------------------------ */
// The whole card is one button so the card is reachable from the keyboard; the
// admin controls sit outside it, because a button inside a button is invalid
// markup and swallows the click.
function ProjectCard({ project, isAdmin, onOpen, onEdit, onDelete }) {
  return (
    <GlassCard padding={false} className="group relative">
      <button
        onClick={onOpen}
        className="w-full text-left p-5 focus-ring rounded-xl"
        aria-label={`Open ${project.name}`}
      >
        <div className="flex items-start gap-3">
          <ObjectTile tone="navy" size="md">
            <MapPin size={18} />
          </ObjectTile>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[15px] font-bold tracking-tight text-[var(--fg-primary)] truncate">
              {project.name}
            </h3>
            <p className="text-[12px] text-[var(--fg-muted)] font-mono truncate mt-0.5">
              {project.hostname || "no portal hostname"}
            </p>
          </div>
          <ChevronRight
            size={16}
            className="text-[var(--fg-muted)] group-hover:text-[var(--brand)] transition-colors shrink-0 mt-1"
          />
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3.5 border-t border-[var(--border-subtle)]">
          <StatusPill tone={project.isActive ? "success" : "neutral"}>
            {project.isActive ? "Active" : "Paused"}
          </StatusPill>
          <Badge tone="neutral" icon={<Cpu size={10} />}>
            Group {project.ruijieGroupId || "—"}
          </Badge>
        </div>
      </button>

      {isAdmin && (
        <div className="absolute top-3.5 right-3.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconButton
            size="sm"
            title="Edit site"
            aria-label={`Edit ${project.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="sm"
            title="Remove project"
            aria-label={`Remove ${project.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="hover:text-[var(--danger-fg)] hover:bg-[var(--danger-soft)]"
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      )}
    </GlassCard>
  );
}

/* ------------ Add / edit project modal ------------------------------------ */
// Village portals are served at <slug>.vodafonefiji.cloud (matches the hosts in
// deploy/sites.json). Derive that default from the site name so admins don't
// have to retype it for every village.
const PORTAL_DOMAIN = "vodafonefiji.cloud";
function deriveHostname(name) {
  const slug = (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // spaces / punctuation -> hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
  return slug ? `${slug}.${PORTAL_DOMAIN}` : "";
}

function ProjectFormModal({ project = null, onClose, onSaved }) {
  const isEdit = !!project;
  const [form, setForm] = useState({
    name: project?.name || "",
    hostname: project?.hostname || "",
    ruijieGroupId: project?.ruijieGroupId ? String(project.ruijieGroupId) : "",
    ruijieTenantId: project?.ruijieTenantId ? String(project.ruijieTenantId) : "",
    isActive: project ? project.isActive !== false : true,
  });
  const [saving, setSaving] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  // Tracks whether the admin has manually edited the hostname. Until they do,
  // the hostname auto-follows the site name; clearing it re-arms the default.
  // An existing site starts "edited" so renaming never silently moves its host.
  const [hostnameEdited, setHostnameEdited] = useState(!!project?.hostname);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  function onNameChange(value) {
    setForm((p) => ({
      ...p,
      name: value,
      hostname: hostnameEdited ? p.hostname : deriveHostname(value),
    }));
  }
  function onHostnameChange(value) {
    setHostnameEdited(value.trim() !== "");
    set("hostname", value);
  }

  // Fetch Ruijie network groups ON DEMAND only. This is a live Ruijie Cloud
  // call, so it must NOT fire on form open — the admin clicks "Load from Ruijie"
  // when they want the picker. Manual group-ID entry works without any call.
  function runDiscover() {
    setDiscovering(true);
    networkApi
      .discoverGroups()
      .then((d) => setDiscovered(d.groups || []))
      .catch(() => setDiscovered([]))
      .finally(() => setDiscovering(false));
  }

  function pickDiscovered(groupId) {
    const g = discovered.find((x) => String(x.groupId) === String(groupId));
    if (!g) return;
    setForm((p) => {
      const nextName = p.name?.trim() ? p.name : g.name || `Group ${g.groupId}`;
      return {
        ...p,
        ruijieGroupId: String(g.groupId),
        name: nextName,
        hostname: hostnameEdited ? p.hostname : deriveHostname(nextName),
      };
    });
  }

  async function submit(e) {
    e?.preventDefault?.();
    if (!form.name.trim()) {
      toast.error("Site name is required");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await networkApi.updateProject(project.id, form);
        toast.success("Site updated");
      } else {
        await networkApi.createProject(form);
        toast.success("Site added");
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} width="md">
      <Modal.Header
        eyebrow={isEdit ? "Edit site" : "New site"}
        title={isEdit ? `Edit ${project.name}` : "Add a site (village)"}
        subtitle="Each site maps a named village to a Ruijie project (group) — its vouchers and devices are scoped to it."
        icon={Network}
        onClose={onClose}
      />
      <form onSubmit={submit}>
        <Modal.Body>
          <div className="flex flex-col gap-5">
            <Field
              label="Discover from Ruijie"
              hint={
                discovering
                  ? "Loading villages from Ruijie…"
                  : discovered.length
                  ? "Pick a village, or enter the group ID manually below."
                  : "Click Load to fetch villages from Ruijie, or enter the group ID manually below."
              }
            >
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={runDiscover}
                  loading={discovering}
                  className="self-start"
                >
                  {discovered.length ? "Reload from Ruijie" : "Load villages from Ruijie"}
                </Button>
                <Select
                  value={form.ruijieGroupId}
                  onChange={(e) => pickDiscovered(e.target.value)}
                  disabled={discovering || discovered.length === 0}
                >
                  <option value="">
                    {discovering ? "Loading…" : discovered.length ? "Select a Ruijie network…" : "Not loaded — click Load or enter manually"}
                  </option>
                  {discovered.map((g) => (
                    <option key={g.groupId} value={g.groupId}>
                      {(g.name || `Group ${g.groupId}`) + ` (${g.groupId})` + (g.type ? ` · ${g.type}` : "")}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>

            <div className="h-px bg-[var(--border-subtle)]" />

            <Field label="Site name" required hint="The village name shown in the switcher, e.g. “Nadi Village”.">
              <Input value={form.name} onChange={(e) => onNameChange(e.target.value)} placeholder="Nadi Village" />
            </Field>
            <Field label="Portal hostname" hint="Auto-filled as sitename.vodafonefiji.cloud — edit to override.">
              <Input
                mono
                value={form.hostname}
                onChange={(e) => onHostnameChange(e.target.value)}
                placeholder={deriveHostname(form.name) || "korovou.vodafonefiji.cloud"}
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Ruijie group ID" hint="The network/group ID in Ruijie Cloud.">
                <Input
                  mono
                  value={form.ruijieGroupId}
                  onChange={(e) => set("ruijieGroupId", e.target.value)}
                  placeholder="e.g. 1234567"
                />
              </Field>
              <Field label="Tenant ID" hint="Optional, if your account uses tenants.">
                <Input
                  mono
                  value={form.ruijieTenantId}
                  onChange={(e) => set("ruijieTenantId", e.target.value)}
                  placeholder="optional"
                />
              </Field>
            </div>

            {/* Only on edit: a new site is always created active, and offering
                the switch up front would just be a field to skip. */}
            {isEdit && (
              <Toggle
                checked={form.isActive}
                onChange={(v) => set("isActive", v)}
                label="Active"
                hint="Paused sites stay listed but are skipped by the background health collector."
              />
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {isEdit ? "Save changes" : "Add site"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

/* ========================================================================== */
/*  Project detail — topology + stats                                          */
/* ========================================================================== */
function relTime(iso) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function ProjectDetail({ project, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("topology");

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        // Page load (isRefresh=false) reads the cached snapshot — no Ruijie
        // call. The Refresh button (isRefresh=true) is the only path that hits
        // Ruijie Cloud live.
        const res = await networkApi.health(project.id, { refresh: isRefresh });
        setData(res);
      } catch (err) {
        toast.error("Failed to load health: " + err.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [project.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;
  const internet = data?.internet;
  const topo = data?.topology;
  const devices = data?.devices || [];

  return (
    <PageShell>
      <PageHeader
        eyebrow={`Network · ${project.name}`}
        title={project.hostname || project.name}
        subtitle={
          data?.collectedAt
            ? `Access points, gateway, and internet health · updated ${relTime(data.collectedAt)}`
            : "Access points, gateway, and internet health."
        }
        icon={<Globe size={22} />}
        tone="navy"
        actions={
          <>
            <Button variant="ghost" size="md" onClick={onBack} iconLeft={<ArrowLeft size={14} />}>
              Back
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => load(true)}
              loading={refreshing}
              iconLeft={!refreshing && <RefreshCw size={14} />}
            >
              Refresh
            </Button>
          </>
        }
      />

      {loading ? (
        <>
          <KpiGrid cols={5}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[104px] rounded-xl skeleton" />
            ))}
          </KpiGrid>
          <div className="h-80 rounded-xl skeleton" />
        </>
      ) : (
        <>
          {/* Notice when device scope/data is unavailable */}
          {data && !data.cloudSync && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-[var(--warning-soft)] border border-[var(--warning-border)]">
              <AlertTriangle size={15} className="text-[var(--warning-fg)] mt-0.5 shrink-0" />
              <div className="text-[12.5px] text-[var(--warning-fg)] leading-relaxed">
                <span className="font-semibold font-display">No live device data.</span>{" "}
                {data.notice ||
                  "The device API may not be enabled for this Ruijie app, or no devices are reporting."}
              </div>
            </div>
          )}

          {/* Five tiles, not four: each is a different piece of kit, so none of
              them restates another. */}
          <KpiGrid cols={5}>
            <StatTile
              icon={<Cloud size={18} />}
              label="Internet"
              value={internet?.up == null ? "Unknown" : internet.up ? "Up" : "Down"}
              tone={internet?.up == null ? "neutral" : internet.up ? "success" : "danger"}
              sub={internet?.publicIp || "no public IP"}
            />
            <StatTile
              icon={<Router size={18} />}
              label="Gateway"
              value={`${s?.gatewayOnline ?? 0} / ${s?.gatewayTotal ?? 0}`}
              tone={s?.gatewayTotal ? (s.gatewayOnline === s.gatewayTotal ? "success" : "warning") : "neutral"}
              sub="online"
            />
            <StatTile
              icon={<Wifi size={18} />}
              label="Access points"
              value={`${s?.apOnline ?? 0} / ${s?.apTotal ?? 0}`}
              tone={s?.apTotal ? (s.apOnline === s.apTotal ? "success" : "warning") : "neutral"}
              sub="online"
            />
            <StatTile
              icon={<Server size={18} />}
              label="All devices"
              value={`${s?.onlineDevices ?? 0} / ${s?.totalDevices ?? 0}`}
              tone={s?.totalDevices ? (s.offlineDevices === 0 ? "success" : "warning") : "neutral"}
              sub="online"
            />
            <StatTile
              icon={<Users size={18} />}
              label="Clients"
              value={(s?.clients ?? 0).toLocaleString()}
              tone="brand"
              sub="connected"
            />
          </KpiGrid>

          <Panel
            title="Site health"
            subtitle={
              view === "topology"
                ? "Internet → gateway → access points"
                : `${devices.length} device${devices.length === 1 ? "" : "s"} reported by Ruijie Cloud`
            }
            icon={<Network size={15} />}
            tone="navy"
            padding={view === "topology"}
            actions={
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: "topology", label: "Topology" },
                  { value: "devices", label: "Devices", count: devices.length },
                ]}
              />
            }
          >
            {view === "topology" ? (
              <Topology internet={internet} topo={topo} />
            ) : (
              <DeviceTable devices={devices} />
            )}
          </Panel>

          {/* Self-hiding: renders nothing unless this village has a Starlink
              service line linked in Settings. */}
          {project?.id && <StarlinkPanel projectId={project.id} />}
        </>
      )}
    </PageShell>
  );
}

/* ------------ Stat tile --------------------------------------------------- */
const STAT_TONE_COLOR = {
  success: "emerald",
  danger: "rose",
  warning: "amber",
  brand: "accent",
  neutral: "slate",
};

function StatTile({ icon, label, value, sub, tone = "neutral" }) {
  return <StatCard icon={icon} label={label} value={value} sub={sub} color={STAT_TONE_COLOR[tone] || "slate"} />;
}

/* ------------ Topology (Internet → Gateway → APs) ------------------------ */
// Drawn as labelled tiers rather than an undifferentiated stack of boxes: with
// no captions, a row of nine identical cards gave no clue whether you were
// looking at gateways, APs or switches.
function Topology({ internet, topo }) {
  const gateways = topo?.gateways || [];
  const aps = topo?.aps || [];
  const switches = topo?.switches || [];

  return (
    <div className="flex flex-col items-center py-2">
      <Tier label="Internet">
        <TopoNode
          icon={<Cloud size={18} />}
          label="Internet"
          sub={internet?.publicIp || "WAN"}
          state={internet?.up == null ? "unknown" : internet.up ? "up" : "down"}
        />
      </Tier>

      <Connector />

      <Tier label="Gateway" count={gateways.length || null}>
        {gateways.length > 0 ? (
          gateways.map((g) => (
            <TopoNode key={g.sn} icon={<Router size={18} />} label={g.name} sub={g.model} state={g.online ? "up" : "down"} />
          ))
        ) : (
          <TopoNode icon={<Router size={18} />} label="No gateway" sub="—" state="unknown" muted />
        )}
      </Tier>

      <Connector />

      <Tier label="Access points" count={aps.length || null}>
        {aps.length > 0 ? (
          aps.map((ap) => (
            <TopoNode
              key={ap.sn}
              icon={<Wifi size={16} />}
              label={ap.name}
              sub={`${ap.clientCount} client${ap.clientCount !== 1 ? "s" : ""}`}
              state={ap.online ? "up" : "down"}
              small
            />
          ))
        ) : (
          <TopoNode icon={<Wifi size={16} />} label="No access points" sub="—" state="unknown" small muted />
        )}
      </Tier>

      {/* Switches (if any) shown as a secondary row */}
      {switches.length > 0 && (
        <>
          <Connector />
          <Tier label="Switches" count={switches.length}>
            {switches.map((sw) => (
              <TopoNode key={sw.sn} icon={<Server size={16} />} label={sw.name} sub={sw.model} state={sw.online ? "up" : "down"} small />
            ))}
          </Tier>
        </>
      )}
    </div>
  );
}

function Tier({ label, count, children }) {
  return (
    <div className="w-full flex flex-col items-center gap-2.5">
      <p className="text-label">
        {label}
        {count != null && ` · ${count}`}
      </p>
      <div className="flex flex-wrap items-start justify-center gap-3 max-w-3xl">{children}</div>
    </div>
  );
}

function Connector() {
  return <div className="w-px h-7 my-2 bg-gradient-to-b from-transparent via-[var(--border-strong)] to-transparent" />;
}

const TOPO_TONE = { up: "green", down: "red", unknown: "slate" };
const TOPO_DOT = { up: "var(--success-fg)", down: "var(--danger-fg)", unknown: "var(--fg-subtle)" };

function TopoNode({ icon, label, sub, state = "unknown", small, muted }) {
  return (
    <div
      className={
        "flex flex-col items-center gap-2 rounded-xl px-3 py-3 min-w-[104px] max-w-[136px] " +
        "bg-[var(--bg-elevated)] border " +
        (muted
          ? "border-dashed border-[var(--border-subtle)] opacity-75"
          : "border-[var(--border-default)] shadow-[var(--shadow-xs)]")
      }
    >
      <ObjectTile tone={TOPO_TONE[state] || "slate"} size={small ? "sm" : "md"}>
        {icon}
      </ObjectTile>
      <span className="font-display text-[12.5px] font-semibold text-[var(--fg-primary)] text-center leading-tight truncate w-full">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--fg-muted)] max-w-full">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TOPO_DOT[state] }} />
        <span className="truncate font-mono">{sub}</span>
      </span>
    </div>
  );
}

/* ------------ Device table ------------------------------------------------ */
const TYPE_LABEL = { gateway: "Gateway", ap: "Access point", switch: "Switch", other: "Device" };
const TYPE_TONE = { gateway: "indigo", ap: "blue", switch: "teal", other: "slate" };

function DeviceIcon({ type }) {
  if (type === "gateway") return <Router size={15} />;
  if (type === "ap") return <Wifi size={15} />;
  if (type === "switch") return <Server size={15} />;
  return <Cpu size={15} />;
}

function DeviceTable({ devices }) {
  if (devices.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No devices reporting"
        description="Devices appear here once Ruijie Cloud reports them."
      />
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Device</Th>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Model</Th>
          <Th>Mgmt IP</Th>
          <Th align="right">Clients</Th>
          <Th>Firmware</Th>
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <tr key={d.sn}>
            <Td>
              <RecordCell
                tone={TYPE_TONE[d.type] || "slate"}
                icon={<DeviceIcon type={d.type} />}
                title={d.name}
                subtitle={d.sn}
                mono
              />
            </Td>
            <Td>{TYPE_LABEL[d.type] || "Device"}</Td>
            <Td>
              <StatusPill tone={d.online ? "success" : "danger"}>{d.online ? "Online" : "Offline"}</StatusPill>
            </Td>
            <Td mono nowrap>{d.model}</Td>
            <Td mono nowrap>{d.mgmtIp}</Td>
            <Td align="right" nowrap className="tabular-nums">{d.type === "ap" ? d.clientCount : "—"}</Td>
            <Td mono muted nowrap>{d.firmware}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
