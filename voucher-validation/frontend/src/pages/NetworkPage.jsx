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
import { usePublishPageTitle } from "../components/layout/pageTitle";
import {
  PHONE_ROWS,
  PhoneFacts,
  PhoneList,
  PhoneMore,
  usePhone,
} from "../components/ui/phone";
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
          <Segmented
            options={stateOptions}
            value={stateFilter}
            onChange={setStateFilter}
            size="sm"
            // Full width on a phone: the options share it rather than huddling left.
            className="max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
          />
          {/* Unfiltered, the "All" pill already carries the count on a phone. */}
          <span
            className={`ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums${
              q.trim() !== "" || stateFilter !== "all" ? "" : " max-sm:hidden"
            }`}
          >
            {visible.length} shown
          </span>
        </Toolbar>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 max-sm:gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            // A phone shows the village as a row, so the placeholder is one too.
            <div key={i} className="h-[132px] max-sm:h-[62px] rounded-xl skeleton" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 max-sm:gap-2">
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
// Desktop: a record card, the whole surface one button so it is reachable from
// the keyboard, with the admin controls revealed on hover.
//
// Phone: the same village as a list row. The card layout wasted a third of the
// screen on a group id nobody reads on a phone, and — worse — the admin buttons
// were drawn ON TOP of the full-card button, so a thumb near them hit whichever
// the browser picked. The row now opens from its own region and the buttons are
// its siblings, side by side, overlapping nothing.
function ProjectCard({ project, isAdmin, onOpen, onEdit, onDelete }) {
  return (
    <GlassCard
      padding={false}
      // GlassCard stacks its children; on a phone they sit in one row instead.
      className="group relative max-sm:[&>div]:flex-row max-sm:[&>div]:items-center"
    >
      <button
        onClick={onOpen}
        className="w-full text-left p-4 sm:p-5 focus-ring rounded-xl max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 max-sm:px-3 max-sm:py-2.5"
        aria-label={`Open ${project.name}`}
      >
        <div className="flex items-start gap-3 max-sm:items-center max-sm:gap-2.5">
          <ObjectTile tone="navy" size="md" className="max-sm:h-9 max-sm:w-9 max-sm:rounded-[10px]">
            <MapPin size={18} />
          </ObjectTile>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[15px] font-bold tracking-tight text-[var(--fg-primary)] truncate max-sm:text-[14.5px]">
              {project.name}
            </h3>
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)] font-mono mt-0.5 max-sm:mt-0 max-sm:text-[11.5px] min-w-0">
              {/* The state pill below is desktop-only, so the phone row carries
                  the state as a dot — and names it when it is the unusual one. */}
              <span
                className="sm:hidden h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: project.isActive ? "var(--success-fg)" : "var(--fg-subtle)" }}
              >
                <span className="sr-only">{project.isActive ? "Active" : "Paused"}</span>
              </span>
              {!project.isActive && <span className="sm:hidden shrink-0 font-sans">Paused ·</span>}
              <span className="truncate">{project.hostname || "no portal hostname"}</span>
            </p>
          </div>
          <ChevronRight
            size={16}
            className={
              "text-[var(--fg-muted)] group-hover:text-[var(--brand)] transition-colors shrink-0 mt-1 max-sm:mt-0" +
              // An admin row ends in Edit and Remove; a third glyph beside them
              // only steals the width the hostname needs.
              (isAdmin ? " max-sm:hidden" : "")
            }
          />
        </div>

        {/* Hidden on a phone, where the row carries its state as a dot. On a
            touch screen wide enough to keep the card — a tablet — the admin
            buttons are pinned over the end of this row, so it still has to
            leave their width clear. */}
        <div
          className={
            "flex flex-wrap items-center gap-2 mt-3 pt-3 sm:mt-4 sm:pt-3.5 border-t border-[var(--border-subtle)] max-sm:hidden" +
            (isAdmin ? " pointer-coarse:pr-[84px]" : "")
          }
        >
          <StatusPill tone={project.isActive ? "success" : "neutral"}>
            {project.isActive ? "Active" : "Paused"}
          </StatusPill>
          <Badge tone="neutral" icon={<Cpu size={10} />}>
            Group {project.ruijieGroupId || "—"}
          </Badge>
        </div>
      </button>

      {isAdmin && (
        // Hover-revealed for a mouse. A finger cannot hover, so on a touch
        // screen they are always shown: on a phone as the row's trailing
        // controls, on a touch laptop still inside the card.
        <div
          className={
            "absolute top-3.5 right-3.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity " +
            "max-sm:static max-sm:shrink-0 max-sm:opacity-100 max-sm:pr-2 " +
            "pointer-coarse:opacity-100 pointer-coarse:top-auto pointer-coarse:bottom-2.5 pointer-coarse:right-3 " +
            // The card's padding grows at sm; stay centred on the pill row.
            "sm:pointer-coarse:bottom-3.5 sm:pointer-coarse:right-4"
          }
        >
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
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
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
                  className="self-start max-sm:self-stretch"
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
  const phone = usePhone();

  // On a phone the app bar is the only place this screen is named, and the
  // name that matters is the village's. PageHeader publishes its own title,
  // but this one is an element rather than a string (the hostname, allowed to
  // break mid-word), so the bar fell back to the nav label and every village
  // read "Network".
  usePublishPageTitle(project.name);

  // Stable identity on purpose. PageHeader republishes whenever its `title`
  // prop changes, and a fresh element on every render would clear the name
  // above the moment the health data arrived.
  const headerTitle = useMemo(
    () => <span className="[overflow-wrap:anywhere]">{project.hostname || project.name}</span>,
    [project.hostname, project.name]
  );

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

  // The Topology/Devices switcher. In the panel header a phone leaves it about
  // 190px beside the title; on its own row under the header it takes the full
  // width and each option an even share of it.
  const viewSwitcher = (
    <Segmented
      size="sm"
      value={view}
      onChange={setView}
      className={phone ? "w-full [&>button]:flex-1 [&>button]:justify-center" : undefined}
      options={[
        { value: "topology", label: "Topology" },
        { value: "devices", label: "Devices", count: devices.length },
      ]}
    />
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow={`Network · ${project.name}`}
        // A hostname is one unbroken word; let it wrap rather than run out of
        // the header on a narrow screen.
        title={headerTitle}
        subtitle={
          // The phone keeps only the part that changes; the app bar above
          // already says which village this is.
          <>
            <span className="max-sm:hidden">Access points, gateway, and internet health</span>
            {data?.collectedAt ? (
              <>
                <span className="max-sm:hidden"> · </span>
                <span>updated {relTime(data.collectedAt)}</span>
              </>
            ) : (
              <span className="max-sm:hidden">.</span>
            )}
          </>
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
          <KpiGrid cols={5} className="max-sm:hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`h-[104px] rounded-xl skeleton${i === 0 ? " max-lg:col-span-2" : ""}`} />
            ))}
          </KpiGrid>
          {/* One summary card on a phone, so the placeholder is one too. */}
          <div className="sm:hidden h-[118px] rounded-xl skeleton" />
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
              them restates another. Below desktop the grid is two-up, so
              Internet — the headline — takes the full first row and the other
              four pair off, instead of Clients being left alone at the end. */}
          {/* The five tiles are a laptop's summary. On a phone they were three
              rows of chrome — and "Internet / Up" does not need a 28px figure —
              so the same five readings become one card above the diagram. */}
          <SiteSummaryPhone summary={s} internet={internet} />

          <KpiGrid cols={5} className="max-sm:hidden">
            <StatTile
              className="max-lg:col-span-2"
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
            actions={phone ? null : viewSwitcher}
          >
            {/* On a phone the switcher is a row of its own under the header
                rather than a third thing crushed into it. The devices view is
                unpadded, so this row carries its own gutter there. */}
            {phone && (
              <div className={view === "topology" ? "mb-3" : "px-4 py-3 border-b border-[var(--border-subtle)]"}>
                {viewSwitcher}
              </div>
            )}
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

function StatTile({ icon, label, value, sub, tone = "neutral", className }) {
  return (
    <StatCard
      icon={icon}
      label={label}
      value={value}
      sub={sub}
      color={STAT_TONE_COLOR[tone] || "slate"}
      className={className}
    />
  );
}

/* ------------ Site summary (phone) ---------------------------------------- */
/**
 * The five KPI tiles as one card: the internet's state as a line of text, and
 * the four counts as a strip of figures under it.
 *
 * Phone only — the tiles are better on a laptop, where five of them fit on one
 * row and the extra size is free. Here they cost three screens of scrolling
 * before the diagram everyone opens this page for.
 */
function SiteSummaryPhone({ summary: s, internet }) {
  const up = internet?.up;
  const dot = up == null ? "var(--fg-subtle)" : up ? "var(--success-fg)" : "var(--danger-fg)";
  const counts = [
    {
      label: "Gateway",
      value: `${s?.gatewayOnline ?? 0}/${s?.gatewayTotal ?? 0}`,
      bad: !!s?.gatewayTotal && s.gatewayOnline !== s.gatewayTotal,
    },
    {
      label: "APs",
      value: `${s?.apOnline ?? 0}/${s?.apTotal ?? 0}`,
      bad: !!s?.apTotal && s.apOnline !== s.apTotal,
    },
    {
      label: "Devices",
      value: `${s?.onlineDevices ?? 0}/${s?.totalDevices ?? 0}`,
      bad: !!s?.totalDevices && s.offlineDevices > 0,
    },
    { label: "Clients", value: (s?.clients ?? 0).toLocaleString(), bad: false },
  ];

  return (
    <div className="sm:hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: dot }} />
        <span className="font-display text-[13.5px] font-semibold text-[var(--fg-primary)]">
          {up == null ? "Internet unknown" : up ? "Internet up" : "Internet down"}
        </span>
        <span className="ml-auto font-mono text-[11.5px] text-[var(--fg-muted)] truncate">
          {internet?.publicIp || "no public IP"}
        </span>
      </div>
      <div className="grid grid-cols-4">
        {counts.map((c, i) => (
          <div
            key={c.label}
            className={"px-2 py-2.5 text-center" + (i > 0 ? " border-l border-[var(--border-subtle)]" : "")}
          >
            <p className="text-label">{c.label}</p>
            <p
              className="mt-1 text-[17px] leading-none font-semibold tabular-nums"
              // Colour only when something is off: a card where every figure is
              // coloured says nothing about which one needs attention.
              style={{ color: c.bad ? "var(--warning-fg)" : "var(--fg-primary)" }}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
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
    <div className="flex flex-col items-center py-2 max-sm:py-0">
      <Tier label="Internet">
        <TopoNode
          icon={<Cloud size={18} />}
          label="Internet"
          sub={internet?.publicIp || "WAN"}
          state={internet?.up == null ? "unknown" : internet.up ? "up" : "down"}
        />
      </Tier>

      <Connector />

      <Tier label="Gateway" count={gateways.length || null} pair={gateways.length > 1}>
        {gateways.length > 0 ? (
          gateways.map((g) => (
            <TopoNode
              key={g.sn}
              icon={<Router size={18} />}
              label={g.name}
              sub={g.model}
              state={g.online ? "up" : "down"}
            />
          ))
        ) : (
          <TopoNode icon={<Router size={18} />} label="No gateway" sub="—" state="unknown" muted />
        )}
      </Tier>

      <Connector />

      <Tier label="Access points" count={aps.length || null} pair={aps.length > 1}>
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
          <Tier label="Switches" count={switches.length} pair={switches.length > 1}>
            {switches.map((sw) => (
              <TopoNode
                key={sw.sn}
                icon={<Server size={16} />}
                label={sw.name}
                sub={sw.model}
                state={sw.online ? "up" : "down"}
                small
              />
            ))}
          </Tier>
        </>
      )}
    </div>
  );
}

// A phone reads the diagram as sections of a list: the tier's caption sits at
// the left edge above its devices, a lone device takes the full width, and
// several pair off two to a row. Centred cards a hundred pixels wide left a
// third of the screen empty and cut every name longer than a dozen characters.
function Tier({ label, count, pair = false, children }) {
  return (
    <div className="w-full flex flex-col items-center gap-2.5 max-sm:items-stretch max-sm:gap-2">
      <p className="text-label">
        {label}
        {count != null && ` · ${count}`}
      </p>
      <div
        className={
          "flex flex-wrap items-start justify-center gap-3 max-w-3xl " +
          "max-sm:grid max-sm:items-stretch max-sm:gap-2 max-sm:w-full max-sm:max-w-none " +
          (pair ? "max-sm:grid-cols-2" : "max-sm:grid-cols-1")
        }
      >
        {children}
      </div>
    </div>
  );
}

// On a phone the tiers are left-aligned sections, so the thread between them
// runs down the left under the device tiles rather than down a centre nothing
// else lines up with.
function Connector() {
  return (
    <div className="w-px h-7 my-2 max-sm:h-4 max-sm:my-1 max-sm:self-start max-sm:ml-[26px] bg-gradient-to-b from-transparent via-[var(--border-strong)] to-transparent" />
  );
}

const TOPO_TONE = { up: "green", down: "red", unknown: "slate" };
const TOPO_DOT = { up: "var(--success-fg)", down: "var(--danger-fg)", unknown: "var(--fg-subtle)" };

function TopoNode({ icon, label, sub, state = "unknown", small, muted }) {
  return (
    <div
      className={
        "flex flex-col items-center gap-2 rounded-xl px-3 py-3 min-w-[104px] max-w-[136px] " +
        "bg-[var(--bg-elevated)] border " +
        // Phone: a row — tile, then the name over its state — filling its cell.
        "max-sm:flex-row max-sm:w-full max-sm:gap-2.5 max-sm:min-w-0 max-sm:max-w-none max-sm:px-2.5 max-sm:py-2.5 max-sm:h-full " +
        (muted
          ? "border-dashed border-[var(--border-subtle)] opacity-75"
          : "border-[var(--border-default)] shadow-[var(--shadow-xs)]")
      }
    >
      <ObjectTile tone={TOPO_TONE[state] || "slate"} size={small ? "sm" : "md"} className="max-sm:self-center">
        {icon}
      </ObjectTile>
      {/* Two of these sit side by side on a phone and share a height. Stretched
          and spread, the state line lands at the foot of both, so a name that
          wraps to two lines no longer pushes its neighbour's state out of line
          with it. */}
      <span className="flex flex-col items-center gap-2 w-full min-w-0 max-sm:items-start max-sm:gap-1 max-sm:self-stretch max-sm:justify-between">
        {/* One truncated line on desktop. On a phone a cut-off device name is
            the one thing an engineer came to read, so it gets two lines. */}
        <span
          className={
            "font-display text-[12.5px] font-semibold text-[var(--fg-primary)] text-center leading-tight truncate w-full " +
            "max-sm:text-left max-sm:whitespace-normal max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere]"
          }
        >
          {label}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--fg-muted)] max-w-full">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TOPO_DOT[state] }} />
          <span className="truncate font-mono">{sub}</span>
        </span>
      </span>
    </div>
  );
}

/* ------------ Device table ------------------------------------------------ */
const TYPE_LABEL = { gateway: "Gateway", ap: "Access point", switch: "Switch", other: "Device" };
// The phone row's facts line. "AP" is the word the rest of the console already
// uses for one ("APs 7/9"), and the ten characters it saves are what keep an
// access point's model, IP and client count on the one line at 375px.
const PHONE_TYPE_LABEL = { ...TYPE_LABEL, ap: "AP" };
const TYPE_TONE = { gateway: "indigo", ap: "blue", switch: "teal", other: "slate" };

function DeviceIcon({ type }) {
  if (type === "gateway") return <Router size={15} />;
  if (type === "ap") return <Wifi size={15} />;
  if (type === "switch") return <Server size={15} />;
  return <Cpu size={15} />;
}

/**
 * Ruijie firmware strings are long and comma-joined
 * ("AP_3.0(1)B11P204,Release(10222207)"). Each comma-separated part is its own
 * inline-block below 640px, so a narrow window breaks the string between parts
 * rather than mid-token; in the desktop table's nowrap cell the parts are plain
 * inline spans and read exactly as the raw string. (Not <wbr>: Chrome breaks at
 * it even under white-space: nowrap.)
 */
function Firmware({ value }) {
  if (value == null || value === "") return null;
  const parts = String(value).split(",");
  return (
    <span>
      {parts.map((part, i) => (
        <span key={i} className="max-sm:inline-block">
          {part}
          {i < parts.length - 1 ? "," : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * One device on a phone: what it is called and whether it is up, then
 * everything else as a line of facts.
 *
 * Not the stacked table card. That card gave each column its own labelled tile
 * — MODEL, MGMT IP, CLIENTS, FIRMWARE — which came to 191px a device, so four
 * of them filled the screen and eleven ran the better part of a metre. The
 * figures here are the same figures; what goes is the furniture around them.
 */
function DeviceRow({ device: d }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <ObjectTile tone={TYPE_TONE[d.type] || "slate"} size="sm" className="mt-0.5">
        <DeviceIcon type={d.type} />
      </ObjectTile>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold text-[var(--fg-primary)]">
            {d.name}
          </span>
          <StatusPill tone={d.online ? "success" : "danger"}>{d.online ? "Online" : "Offline"}</StatusPill>
        </div>
        <PhoneFacts
          className="mt-0.5"
          items={[
            { v: PHONE_TYPE_LABEL[d.type] || "Device" },
            d.model && { v: d.model },
            d.mgmtIp && { v: d.mgmtIp },
            d.type === "ap" && { v: d.clientCount ?? 0, l: "clients" },
          ]}
        />
        {/* The two reference strings an engineer quotes when they raise a
            ticket. Small and last. Together they never fit one line on a
            phone, so each has its own rather than the pair breaking wherever
            the width ran out; a firmware string longer than the line still
            wraps rather than being cut. */}
        <p className="mt-0.5 font-mono text-[11px] leading-[1.45] text-[var(--fg-subtle)] [overflow-wrap:anywhere]">
          <span className="block">{d.sn}</span>
          {d.firmware && <span className="block">{d.firmware}</span>}
        </p>
      </div>
    </div>
  );
}

function DeviceTable({ devices }) {
  const [showAll, setShowAll] = useState(false);

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
    <>
      <PhoneList>
        {devices.slice(0, showAll ? devices.length : PHONE_ROWS).map((d) => (
          <DeviceRow key={d.sn} device={d} />
        ))}
      </PhoneList>

      <DataTable className="max-sm:hidden!">
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
              <Td align="right" nowrap className="tabular-nums">
                {d.type === "ap" ? d.clientCount : "—"}
              </Td>
              <Td mono muted nowrap>
                <Firmware value={d.firmware} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <PhoneMore
        total={devices.length}
        expanded={showAll}
        onToggle={() => setShowAll((v) => !v)}
        noun="devices"
      />
    </>
  );
}
