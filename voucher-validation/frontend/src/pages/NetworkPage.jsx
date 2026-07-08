// src/pages/NetworkPage.jsx
// Network monitoring. A grid of named "projects" (each = a Ruijie Cloud
// network); selecting one opens its topology (Internet → Gateway → APs)
// with device health and all-around stats.

import { useEffect, useState, useCallback } from "react";
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
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

import { networkApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import {
  Modal,
  Field,
  Input,
  Select,
  Button,
  IconButton,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  Panel,
} from "../components/ui";

export default function NetworkPage() {
  const { isAdmin } = useAuth();
  const { isInScope, activeSiteId } = useSite();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // project object
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

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
  const shownProjects = projects.filter((p) => isInScope(p.id));

  // ---- Detail view ----
  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  // ---- Project grid ----
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Infrastructure"
        title="Network"
        subtitle={`${shownProjects.length} of ${projects.length} project${projects.length !== 1 ? "s" : ""} · device health refreshed every ~5 min`}
        icon={<Network size={20} />}
        actions={
          isAdmin && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowAdd(true)}
              iconLeft={<Plus size={14} />}
            >
              Add project
            </Button>
          )
        }
      />

      <div className="mt-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 rounded-lg skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)]">
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
          </div>
        ) : shownProjects.length === 0 ? (
          <div className="rounded-lg bg-[var(--surface-raised)] border border-[var(--border-default)]">
            <EmptyState
              icon={Network}
              title="No villages in scope"
              description="Pick a village in the scope switcher, or adjust the All Villages scope in Settings."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shownProjects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                isAdmin={isAdmin}
                onOpen={() => setSelected(p)}
                onDelete={() => setConfirmDelete(p)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddProjectModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
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
    </div>
  );
}

/* ------------ Project card ------------------------------------------------ */
function ProjectCard({ project, isAdmin, onOpen, onDelete }) {
  return (
    <Card className="group hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-card-hover)] transition-all cursor-pointer relative">
      <button
        onClick={onOpen}
        className="w-full text-left p-5 focus-ring rounded-lg"
        aria-label={`Open ${project.name}`}
      >
        <div className="flex items-start gap-3">
          <span className="shrink-0 h-10 w-10 rounded-lg inline-flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15">
            <Globe size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-[var(--fg-primary)] tracking-tight truncate">
              {project.name}
            </h3>
            {project.hostname && (
              <p className="text-[12px] text-[var(--fg-muted)] font-mono truncate">
                {project.hostname}
              </p>
            )}
          </div>
          <ChevronRight
            size={16}
            className="text-[var(--fg-muted)] group-hover:text-[var(--accent)] transition-colors shrink-0 mt-1"
          />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Badge tone="neutral" icon={<Cpu size={10} />}>
            Group {project.ruijieGroupId || "—"}
          </Badge>
          {project.isActive ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="neutral">Paused</Badge>
          )}
        </div>
      </button>

      {isAdmin && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            size="sm"
            title="Remove project"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="hover:text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      )}
    </Card>
  );
}

/* ------------ Add project modal ------------------------------------------ */
function AddProjectModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    hostname: "",
    ruijieGroupId: "",
    ruijieTenantId: "",
  });
  const [saving, setSaving] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [discovering, setDiscovering] = useState(true);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Pull the list of Ruijie network groups so the admin can pick a village
  // instead of typing the group ID. Manual entry still works (fallback).
  useEffect(() => {
    networkApi
      .discoverGroups()
      .then((d) => setDiscovered(d.groups || []))
      .catch(() => setDiscovered([]))
      .finally(() => setDiscovering(false));
  }, []);

  function pickDiscovered(groupId) {
    const g = discovered.find((x) => String(x.groupId) === String(groupId));
    if (!g) return;
    setForm((p) => ({
      ...p,
      ruijieGroupId: String(g.groupId),
      name: p.name?.trim() ? p.name : g.name || `Group ${g.groupId}`,
    }));
  }

  async function submit(e) {
    e?.preventDefault?.();
    if (!form.name.trim()) {
      toast.error("Site name is required");
      return;
    }
    setSaving(true);
    try {
      await networkApi.createProject(form);
      toast.success("Site added");
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
        eyebrow="New site"
        title="Add a site (village)"
        subtitle="Each site maps a named village to a Ruijie project (group) — its vouchers and devices are scoped to it."
        icon={Network}
        onClose={onClose}
      />
      <form onSubmit={submit}>
        <Modal.Body>
          <div className="flex flex-col gap-4">
            <Field
              label="Discover from Ruijie"
              hint={discovering ? "Loading sites from Ruijie…" : "Pick a village, or enter the group ID manually below."}
            >
              <Select
                value={form.ruijieGroupId}
                onChange={(e) => pickDiscovered(e.target.value)}
                disabled={discovering || discovered.length === 0}
              >
                <option value="">
                  {discovering ? "Loading…" : discovered.length ? "Select a Ruijie network…" : "None found — enter manually"}
                </option>
                {discovered.map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {(g.name || `Group ${g.groupId}`) + ` (${g.groupId})` + (g.type ? ` · ${g.type}` : "")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site name" required hint="The village name shown in the switcher, e.g. “Nadi Village”.">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nadi Village" />
            </Field>
            <Field label="Portal hostname" hint="Optional — the captive portal domain this network serves.">
              <Input
                mono
                value={form.hostname}
                onChange={(e) => set("hostname", e.target.value)}
                placeholder="portal.vodafone.com.fj"
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
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Add site
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

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await networkApi.health(project.id);
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

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={`Network · ${project.name}`}
        title={project.hostname || project.name}
        subtitle={
          data?.collectedAt
            ? `Access points, gateway, and internet health · updated ${relTime(data.collectedAt)}`
            : "Access points, gateway, and internet health."
        }
        icon={<Globe size={20} />}
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={onBack}
              iconLeft={<ArrowLeft size={14} />}
            >
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

      <div className="mt-6 space-y-6">
        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg skeleton" />
              ))}
            </div>
            <div className="h-64 rounded-lg skeleton" />
          </div>
        ) : (
          <>
            {/* Notice when device scope/data is unavailable */}
            {data && !data.cloudSync && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[var(--warning-soft)] border border-transparent">
                <AlertTriangle size={15} className="text-[var(--warning-fg)] mt-0.5 shrink-0" />
                <div className="text-[12.5px] text-[var(--warning-fg)]">
                  <span className="font-semibold">No live device data.</span>{" "}
                  {data.notice ||
                    "The device API may not be enabled for this Ruijie app, or no devices are reporting."}
                </div>
              </div>
            )}

            {/* Stat tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatTile
                icon={<Cloud size={14} />}
                label="Internet"
                value={internet?.up == null ? "Unknown" : internet.up ? "Up" : "Down"}
                tone={internet?.up == null ? "neutral" : internet.up ? "success" : "danger"}
                sub={internet?.publicIp || "no public IP"}
              />
              <StatTile
                icon={<Router size={14} />}
                label="Gateway"
                value={`${s?.gatewayOnline ?? 0} / ${s?.gatewayTotal ?? 0}`}
                tone={s?.gatewayTotal ? (s.gatewayOnline === s.gatewayTotal ? "success" : "warning") : "neutral"}
                sub="online"
              />
              <StatTile
                icon={<Wifi size={14} />}
                label="Access points"
                value={`${s?.apOnline ?? 0} / ${s?.apTotal ?? 0}`}
                tone={s?.apTotal ? (s.apOnline === s.apTotal ? "success" : "warning") : "neutral"}
                sub="online"
              />
              <StatTile
                icon={<Server size={14} />}
                label="All devices"
                value={`${s?.onlineDevices ?? 0} / ${s?.totalDevices ?? 0}`}
                tone={s?.totalDevices ? (s.offlineDevices === 0 ? "success" : "warning") : "neutral"}
                sub="online"
              />
              <StatTile
                icon={<Users size={14} />}
                label="Clients"
                value={(s?.clients ?? 0).toLocaleString()}
                tone="brand"
                sub="connected"
              />
            </div>

            {/* Topology */}
            <Topology internet={internet} topo={topo} />

            {/* Device table */}
            <DeviceTable devices={data?.devices || []} />
          </>
        )}
      </div>
    </div>
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
  return (
    <StatCard
      icon={icon}
      label={label}
      value={value}
      sub={sub}
      color={STAT_TONE_COLOR[tone] || "slate"}
    />
  );
}

/* ------------ Topology (Internet → Gateway → APs) ------------------------ */
function Topology({ internet, topo }) {
  const gateways = topo?.gateways || [];
  const aps = topo?.aps || [];
  const switches = topo?.switches || [];

  return (
    <Panel title="Topology" icon={<Network size={15} />}>
      <div className="flex flex-col items-center pt-1">
        {/* Internet */}
        <TopoNode
          icon={<Cloud size={18} />}
          label="Internet"
          sub={internet?.publicIp || "WAN"}
          state={internet?.up == null ? "unknown" : internet.up ? "up" : "down"}
        />
        <Connector />

        {/* Gateways */}
        {gateways.length > 0 ? (
          <div className="flex flex-wrap items-start justify-center gap-4">
            {gateways.map((g) => (
              <TopoNode
                key={g.sn}
                icon={<Router size={18} />}
                label={g.name}
                sub={g.model}
                state={g.online ? "up" : "down"}
              />
            ))}
          </div>
        ) : (
          <TopoNode icon={<Router size={18} />} label="No gateway" sub="—" state="unknown" muted />
        )}

        <Connector />

        {/* Access points */}
        {aps.length > 0 ? (
          <div className="flex flex-wrap items-start justify-center gap-3 max-w-3xl">
            {aps.map((ap) => (
              <TopoNode
                key={ap.sn}
                icon={<Wifi size={16} />}
                label={ap.name}
                sub={`${ap.clientCount} client${ap.clientCount !== 1 ? "s" : ""}`}
                state={ap.online ? "up" : "down"}
                small
              />
            ))}
          </div>
        ) : (
          <TopoNode icon={<Wifi size={16} />} label="No access points" sub="—" state="unknown" small muted />
        )}

        {/* Switches (if any) shown as a secondary row */}
        {switches.length > 0 && (
          <>
            <Connector />
            <div className="flex flex-wrap items-start justify-center gap-3 max-w-3xl">
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
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function Connector() {
  return <div className="w-px h-7 bg-[var(--border-strong)] my-1" />;
}

function TopoNode({ icon, label, sub, state, small, muted }) {
  const ring =
    state === "up"
      ? "border-[var(--success-fg)]"
      : state === "down"
        ? "border-[var(--brand)]"
        : "border-[var(--border-strong)]";
  const dot =
    state === "up"
      ? "bg-[var(--success-fg)]"
      : state === "down"
        ? "bg-[var(--brand)]"
        : "bg-[var(--text-quaternary)]";
  const iconWrap = small ? "h-9 w-9" : "h-11 w-11";
  return (
    <div
      className={
        "relative flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg " +
        "bg-[var(--surface-sunken)] border " +
        (muted ? "border-[var(--border-subtle)] opacity-70" : "border-[var(--border-default)]") +
        " min-w-[92px] max-w-[120px]"
      }
    >
      <span
        className={
          `${iconWrap} rounded-lg inline-flex items-center justify-center border-2 ${ring} ` +
          "bg-[var(--surface-raised)] text-[var(--text-secondary)]"
        }
      >
        {icon}
      </span>
      <span className="text-[11.5px] font-medium text-[var(--text-primary)] text-center leading-tight truncate w-full">
        {label}
      </span>
      <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-quaternary)] font-mono truncate max-w-full">
        <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
        <span className="truncate">{sub}</span>
      </span>
    </div>
  );
}

/* ------------ Device table ------------------------------------------------ */
const TYPE_LABEL = { gateway: "Gateway", ap: "Access point", switch: "Switch", other: "Device" };

function DeviceTable({ devices }) {
  return (
    <Panel
      title="Devices"
      subtitle={`${devices.length} total`}
      icon={<Server size={15} />}
      padding={false}
    >
      {devices.length === 0 ? (
        <EmptyState icon={Server} title="No devices reporting" description="Devices appear here once Ruijie Cloud reports them." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="text-label px-5 py-3">Device</th>
                <th className="text-label px-5 py-3">Type</th>
                <th className="text-label px-5 py-3">Status</th>
                <th className="text-label px-5 py-3">Model</th>
                <th className="text-label px-5 py-3">Mgmt IP</th>
                <th className="text-label px-5 py-3">Clients</th>
                <th className="text-label px-5 py-3">Firmware</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {devices.map((d) => (
                <tr key={d.sn} className="hover:bg-[var(--bg-surface)] transition-colors">
                  <td className="px-5 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium text-[var(--fg-primary)] truncate max-w-[200px]">
                        {d.name}
                      </span>
                      <span className="text-[11px] text-[var(--fg-muted)] font-mono">{d.sn}</span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-[12.5px] text-[var(--fg-secondary)]">
                    {TYPE_LABEL[d.type] || "Device"}
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge tone={d.online ? "success" : "danger"}>
                      {d.online ? "Online" : "Offline"}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5 text-[12.5px] font-mono text-[var(--accent)]">{d.model}</td>
                  <td className="px-5 py-2.5 text-[12.5px] font-mono text-[var(--fg-secondary)]">{d.mgmtIp}</td>
                  <td className="px-5 py-2.5 text-[12.5px] font-mono text-[var(--fg-secondary)]">
                    {d.type === "ap" ? d.clientCount : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-[12px] font-mono text-[var(--fg-muted)]">{d.firmware}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
