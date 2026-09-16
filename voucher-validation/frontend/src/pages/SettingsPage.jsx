// src/pages/SettingsPage.jsx
// System information + the console's runtime settings.
//
// Everything here used to be one column of tall panels — sync, collection,
// scope, SMTP, receipts, Starlink — so finding a switch meant scrolling past
// four unrelated forms. Now the page is navigated by tabs, and inside a tab
// each setting is one row: what it is on the left, the control on the right,
// with the live status and the Save button in a footer bar under the form. That
// last part matters more than it looks — several of these settings spend the
// Ruijie API quota, and the cost belongs next to the button that commits it.

import { useEffect, useState } from "react";
import {
  Settings, Server, Eye, EyeOff, MapPin, Check, Globe2, RefreshCw, Mail,
  Satellite, Send, Receipt, KeyRound,
} from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi, networkApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import {
  PageShell, PageHeader, Panel, Badge, Toggle, Select, Field, Input, Button, Tabs, Section,
} from "../components/ui";

// Sync-frequency presets. Floor is 5 min to protect the Ruijie account-wide rate
// limit (the backend clamps to the same range regardless of what's sent).
// Network-health collection runs ~4 Ruijie calls per village per cycle, so the
// choices start at an hour. The labels carry the cost because that is the whole
// reason this job was switched off once already.
const COLLECT_INTERVAL_OPTIONS = [
  { v: 60, label: "Every hour (~2,900 calls/day)" },
  { v: 180, label: "Every 3 hours (~960/day)" },
  { v: 360, label: "Every 6 hours (~480/day)" },
  { v: 480, label: "Every 8 hours (~360/day)" },
  { v: 720, label: "Every 12 hours (~240/day)" },
  { v: 1440, label: "Once a day (~120/day)" },
  { v: 10080, label: "Once a week (~17/day)" },
];

const INTERVAL_OPTIONS = [
  { v: 5, label: "Every 5 minutes" },
  { v: 10, label: "Every 10 minutes" },
  { v: 15, label: "Every 15 minutes" },
  { v: 30, label: "Every 30 minutes" },
  { v: 60, label: "Every hour" },
  { v: 120, label: "Every 2 hours" },
  { v: 360, label: "Every 6 hours" },
  { v: 720, label: "Every 12 hours" },
  { v: 1440, label: "Once a day" },
];

const TABS = [
  { value: "general", label: "General", icon: <Server size={14} /> },
  { value: "schedules", label: "Schedules", icon: <RefreshCw size={14} /> },
  { value: "email", label: "Email", icon: <Mail size={14} /> },
  { value: "starlink", label: "Starlink", icon: <Satellite size={14} /> },
];

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

function relTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  if (!Number.isFinite(d)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ───────────────────────── Form furniture ─────────────────────────
   Local, because these shapes only make sense on a settings page: a row that
   states a decision and offers one control, and a footer that holds the live
   state of the thing you are about to change next to the button that changes
   it. Everything else on the page is a shared primitive. */

/** A settings row: description left, control right, stacking on narrow screens. */
function SettingRow({ title, description, htmlFor, wide = false, children }) {
  const Label = htmlFor ? "label" : "p";
  return (
    <div
      className={cn(
        "grid gap-3 py-5 first:pt-0 last:pb-0 sm:gap-10 sm:items-start",
        wide
          ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,420px)]"
          : "sm:grid-cols-[minmax(0,1fr)_minmax(0,290px)]"
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="block text-[13.5px] font-semibold text-[var(--fg-primary)] font-display">
          {title}
        </Label>
        {description && (
          <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The body of a form panel — rows separated by hairlines. */
function FormBody({ children, className }) {
  return (
    <div className={cn("px-5 sm:px-6 py-5 divide-y divide-[var(--border-subtle)]", className)}>{children}</div>
  );
}

/** Save bar: what the server currently holds on the left, the actions right. */
function PanelFooter({ note, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--fg-muted)] min-w-0">
        {note}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A tickable village in one of the three scope pickers. */
function CheckRow({ checked, disabled, title, subtitle, note, mono = true, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          "shrink-0 h-[18px] w-[18px] rounded-[5px] flex items-center justify-center border transition-colors",
          checked
            ? "bg-[var(--brand)] border-[var(--brand)] text-[var(--text-on-brand)]"
            : "border-[var(--border-strong)] text-transparent"
        )}
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <MapPin size={14} className="shrink-0 text-[var(--fg-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-[var(--fg-primary)] truncate">{title}</span>
        {subtitle && (
          <span className={cn("block text-[11px] text-[var(--fg-muted)] truncate", mono && "font-mono")}>
            {subtitle}
          </span>
        )}
      </span>
      {note && <span className="text-[10.5px] text-[var(--fg-muted)] shrink-0">{note}</span>}
    </button>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  const [settings, setSettings] = useState([]); // eslint-disable-line no-unused-vars -- raw rows, kept for future keys
  const [loading, setLoading] = useState(true); // eslint-disable-line no-unused-vars
  // Details are shown by default; the button masks them for screen-sharing.
  const [showSecrets, setShowSecrets] = useState(true);
  const { sites, isSiteVisible, toggleVisibleSite, setVisibleSiteIds, allVisible, visibleSites } = useSite();

  // Voucher-sync schedule
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncInterval, setSyncInterval] = useState(10);
  const [origSync, setOrigSync] = useState({ enabled: true, interval: 10 });
  const [savingSync, setSavingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  // Network-health collection schedule (the same shape as the voucher sync).
  const [netEnabled, setNetEnabled] = useState(false);
  const [netInterval, setNetInterval] = useState(1440);
  const [origNet, setOrigNet] = useState({ enabled: false, interval: 1440 });
  const [savingNet, setSavingNet] = useState(false);
  const [netStatus, setNetStatus] = useState(null);
  const [collecting, setCollecting] = useState(false);

  // SMTP (outgoing email) config
  const [smtp, setSmtp] = useState({ enabled: false, host: "", port: "", encryption: "starttls", username: "", fromName: "", fromEmail: "" });
  const [smtpPassword, setSmtpPassword] = useState(""); // write-only; blank = keep the stored one
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [origSmtp, setOrigSmtp] = useState(null);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testTemplate, setTestTemplate] = useState("connection");
  const [sendingTest, setSendingTest] = useState(false);
  const setSmtpField = (k, v) => setSmtp((s) => ({ ...s, [k]: v }));
  const smtpDirty =
    origSmtp != null && (JSON.stringify(smtp) !== JSON.stringify(origSmtp) || smtpPassword.trim() !== "");

  // Purchase-receipt emails (test on USO_2 first; enable/disable + site scope).
  // Stored as a comma list of Ruijie group ids, but picked from the village list.
  const [receiptsEnabled, setReceiptsEnabled] = useState(false);
  const [receiptGroupIds, setReceiptGroupIds] = useState("7847952");
  const [origReceipts, setOrigReceipts] = useState({ enabled: false, groupIds: "7847952" });
  const [savingReceipts, setSavingReceipts] = useState(false);
  const normGroups = (v) =>
    String(v || "").split(",").map((x) => x.trim()).filter(Boolean).sort().join(",");
  const receiptSet = new Set(receiptGroupIds.split(",").map((x) => x.trim()).filter(Boolean));
  const isReceiptSite = (gid) => receiptSet.has(String(gid));
  const toggleReceiptSite = (gid) => {
    const g = String(gid);
    const next = new Set(receiptSet);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    setReceiptGroupIds([...next].join(","));
  };
  const receiptsDirty =
    receiptsEnabled !== origReceipts.enabled || normGroups(receiptGroupIds) !== normGroups(origReceipts.groupIds);

  const syncDirty = syncEnabled !== origSync.enabled || syncInterval !== origSync.interval;
  const netDirty = netEnabled !== origNet.enabled || netInterval !== origNet.interval;
  const netIntervalChoices = COLLECT_INTERVAL_OPTIONS.some((o) => o.v === netInterval)
    ? COLLECT_INTERVAL_OPTIONS
    : [{ v: netInterval, label: `Every ${netInterval} minutes` }, ...COLLECT_INTERVAL_OPTIONS];

  // If the stored interval isn't one of the presets (e.g. set directly in the DB),
  // surface it as a selectable option so the dropdown reflects the real value.
  const intervalChoices = INTERVAL_OPTIONS.some((o) => o.v === syncInterval)
    ? INTERVAL_OPTIONS
    : [{ v: syncInterval, label: `Every ${syncInterval} minutes` }, ...INTERVAL_OPTIONS];

  // Starlink: shared API credentials + the per-village service line / device id.
  const [sl, setSl] = useState({ enabled: false, tokenUrl: "", apiBaseUrl: "", clientId: "", accountNumber: "" });
  const [slSecret, setSlSecret] = useState(""); // write-only; blank = keep stored
  const [slHasSecret, setSlHasSecret] = useState(false);
  const [origSl, setOrigSl] = useState(null);
  const [savingSl, setSavingSl] = useState(false);
  const [slSites, setSlSites] = useState({});   // projectId -> { serviceLine, deviceId }
  const [savingSite, setSavingSite] = useState(null);
  const setSlField = (k, v) => setSl((p) => ({ ...p, [k]: v }));
  const slDirty = origSl != null && (JSON.stringify(sl) !== JSON.stringify(origSl) || slSecret.trim() !== "");

  async function loadStarlink() {
    try {
      const { starlink } = await settingsApi.getStarlink();
      const val = {
        enabled: !!starlink.enabled,
        tokenUrl: starlink.tokenUrl || "",
        apiBaseUrl: starlink.apiBaseUrl || "",
        clientId: starlink.clientId || "",
        accountNumber: starlink.accountNumber || "",
      };
      setSl(val);
      setOrigSl(val);
      setSlHasSecret(!!starlink.hasClientSecret);
      setSlSecret("");
    } catch {
      setOrigSl((prev) => prev ?? { enabled: false, tokenUrl: "", apiBaseUrl: "", clientId: "", accountNumber: "" });
    }
  }

  // The per-village identifiers live on the village record, so they come from
  // the projects list rather than the settings table.
  async function loadStarlinkSites() {
    try {
      const { projects = [] } = await networkApi.projects();
      const map = {};
      for (const p of projects) {
        map[p.id] = {
          serviceLine: p.starlinkServiceLineNumber || "",
          deviceId: p.starlinkDeviceId || "",
        };
      }
      setSlSites(map);
    } catch { /* the panel just shows empty inputs */ }
  }

  async function saveStarlink() {
    setSavingSl(true);
    try {
      const body = { ...sl };
      if (slSecret.trim() !== "") body.clientSecret = slSecret; // omit → keep stored
      await settingsApi.updateStarlink(body);
      toast.success("Starlink settings saved");
      setSlSecret("");
      await loadStarlink();
    } catch (e) {
      toast.error(e?.message || "Failed to save Starlink settings");
    } finally {
      setSavingSl(false);
    }
  }

  const [testingSl, setTestingSl] = useState(false);
  const [slTest, setSlTest] = useState(null); // { ok, steps: [{name, ok, detail}] }

  async function testStarlink() {
    setTestingSl(true);
    setSlTest(null);
    try {
      setSlTest(await settingsApi.testStarlink());
    } catch (e) {
      setSlTest({ ok: false, steps: [{ name: "Test", ok: false, detail: e?.message || "Request failed" }] });
    } finally {
      setTestingSl(false);
    }
  }

  async function saveStarlinkSite(id) {
    setSavingSite(id);
    try {
      const row = slSites[id] || {};
      await networkApi.updateProject(id, {
        starlinkServiceLineNumber: row.serviceLine || "",
        starlinkDeviceId: row.deviceId || "",
      });
      toast.success("Village Starlink details saved");
      await loadStarlinkSites();
    } catch (e) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSavingSite(null);
    }
  }

  useEffect(() => {
    loadSettings();
    loadSmtp();
    loadStarlink();
    loadStarlinkSites();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      const list = data.settings || [];
      setSettings(list);
      const byKey = Object.fromEntries(list.map((s) => [s.setting_key, s.setting_value]));
      const enabled =
        byKey.sync_enabled == null ? true : String(byKey.sync_enabled).toLowerCase() === "true";
      const interval = Number(byKey.sync_interval_minutes) || 10;
      // Absent means OFF — this job spends Ruijie quota, so a missing setting
      // must never be read as consent to start polling.
      const nEnabled = String(byKey.network_collect_enabled || "").toLowerCase() === "true";
      const nInterval = Number(byKey.network_collect_interval_minutes) || 1440;
      setNetEnabled(nEnabled);
      setNetInterval(nInterval);
      setOrigNet({ enabled: nEnabled, interval: nInterval });
      setSyncEnabled(enabled);
      setSyncInterval(interval);
      setOrigSync({ enabled, interval });

      const rEnabled = String(byKey.receipt_emails_enabled || "").toLowerCase() === "true";
      const rGids = byKey.receipt_group_ids || "7847952";
      setReceiptsEnabled(rEnabled);
      setReceiptGroupIds(rGids);
      setOrigReceipts({ enabled: rEnabled, groupIds: rGids });
    } catch {
      // Settings table may be empty — that's fine.
    } finally {
      setLoading(false);
    }
    loadSyncStatus();
  }

  async function loadSyncStatus() {
    try {
      setSyncStatus(await settingsApi.syncStatus());
      try { setNetStatus(await networkApi.collectStatus()); } catch { /* admin-only; ignore */ }
    } catch {
      // non-critical
    }
  }

  async function saveSyncSettings() {
    setSavingSync(true);
    try {
      // Single atomic call — the backend commits both keys in one transaction and
      // reloads the scheduler once, so there's no half-applied window.
      await settingsApi.updateSync(syncEnabled, syncInterval);
      setOrigSync({ enabled: syncEnabled, interval: syncInterval });
      toast.success("Sync schedule updated");
      loadSyncStatus();
    } catch (e) {
      toast.error(e?.message || "Failed to update sync schedule");
      // Resync the UI baseline to whatever the server actually committed, so the
      // form + Save button + status badge never show a stale/half-applied state.
      loadSettings();
    } finally {
      setSavingSync(false);
    }
  }

  async function saveNetSettings() {
    setSavingNet(true);
    try {
      await settingsApi.updateNetworkCollect(netEnabled, netInterval);
      setOrigNet({ enabled: netEnabled, interval: netInterval });
      toast.success(netEnabled ? "Collection schedule saved" : "Automatic collection paused");
      try { setNetStatus(await networkApi.collectStatus()); } catch { /* ignore */ }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingNet(false);
    }
  }

  // Collect every village now. The server single-flights this, so a second click
  // joins the run in progress rather than spending the Ruijie quota twice.
  async function runCollectNow() {
    setCollecting(true);
    const tid = toast.loading("Collecting every village from Ruijie…");
    try {
      const r = await networkApi.collectNow();
      toast.success(
        `${r.villagesUpdated ?? "?"}/${r.villagesTotal ?? "?"} villages updated` +
          (r.joinedExisting ? " (joined a run already in progress)" : ""),
        { id: tid, duration: 6000 }
      );
      try { setNetStatus(await networkApi.collectStatus()); } catch { /* ignore */ }
    } catch (e) {
      toast.error(e.message || "Collection failed", { id: tid });
    } finally {
      setCollecting(false);
    }
  }

  async function loadSmtp() {
    try {
      const { smtp: s } = await settingsApi.getSmtp();
      const val = {
        enabled: !!s.enabled,
        host: s.host || "",
        port: s.port ?? "",
        encryption: s.encryption || "starttls",
        username: s.username || "",
        fromName: s.fromName || "",
        fromEmail: s.fromEmail || "",
      };
      setSmtp(val);
      setOrigSmtp(val);
      setSmtpHasPassword(!!s.hasPassword);
      setSmtpPassword("");
    } catch {
      // No config yet — baseline the current defaults so the form isn't "dirty".
      setOrigSmtp((prev) => prev ?? { enabled: false, host: "", port: "", encryption: "starttls", username: "", fromName: "", fromEmail: "" });
    }
  }

  async function saveSmtp() {
    setSavingSmtp(true);
    try {
      const body = { ...smtp, port: smtp.port === "" ? null : Number(smtp.port) };
      if (smtpPassword.trim() !== "") body.password = smtpPassword; // omit → keep stored
      await settingsApi.updateSmtp(body);
      toast.success("SMTP settings saved");
      setSmtpPassword("");
      await loadSmtp();
    } catch (e) {
      toast.error(e?.message || "Failed to save SMTP settings");
    } finally {
      setSavingSmtp(false);
    }
  }

  async function sendTest() {
    const to = testEmail.trim();
    setSendingTest(true);
    const tid = toast.loading("Sending test email…");
    try {
      await settingsApi.testSmtp(to, testTemplate);
      toast.success(`Test email sent to ${to}`, { id: tid });
    } catch (e) {
      // Surface the SMTP server's error (auth failed, connection refused, …).
      toast.error(e?.message || "Failed to send test email", { id: tid, duration: 7000 });
    } finally {
      setSendingTest(false);
    }
  }

  async function saveReceipts() {
    setSavingReceipts(true);
    try {
      const gids = normGroups(receiptGroupIds);
      await Promise.all([
        settingsApi.update("receipt_emails_enabled", receiptsEnabled ? "true" : "false", "boolean"),
        settingsApi.update("receipt_group_ids", gids, "string"),
      ]);
      // Re-read so what is shown is what the server actually stored, rather
      // than an optimistic copy of the form.
      await loadSettings();
      toast.success(
        receiptsEnabled
          ? `Receipts on for ${gids.split(",").filter(Boolean).length} village(s)`
          : "Receipts turned off"
      );
    } catch (e) {
      toast.error(e?.message || "Failed to save receipt settings");
    } finally {
      setSavingReceipts(false);
    }
  }

  const envVars = [
    {
      label: "API base URL",
      value: import.meta.env.VITE_API_URL || "/api",
    },
    {
      label: "Frontend port",
      value: window.location.port || "3001",
    },
    {
      label: "Version",
      value: "1.0.0",
    },
  ];

  const savedReceiptCount = normGroups(origReceipts.groupIds).split(",").filter(Boolean).length;

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle="Environment configuration, schedules and integrations for the console."
        icon={<Settings size={22} />}
        tone="slate"
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div className="flex flex-col gap-5">
        {/* ═══════════════════════════ General ═══════════════════════════ */}
        {tab === "general" && (
          <>
            <Panel
              title="System information"
              subtitle="What this browser session is talking to."
              icon={<Server size={15} />}
              tone="slate"
              padding={false}
              actions={
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowSecrets(!showSecrets)}
                  iconLeft={showSecrets ? <EyeOff size={11} /> : <Eye size={11} />}
                >
                  {showSecrets ? "Hide" : "Show"} details
                </Button>
              }
            >
              <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {envVars.map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4 px-5 sm:px-6 py-3 hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <span className="text-[12.5px] text-[var(--fg-secondary)]">{label}</span>
                    <span className="text-[12.5px] font-mono text-[var(--fg-primary)] truncate">
                      {showSecrets ? value : "••••••••"}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-3">
                  <span className="text-[12.5px] text-[var(--fg-secondary)]">Status</span>
                  <Badge tone="success" icon={<span className="w-1.5 h-1.5 rounded-full bg-[var(--success-fg)]" />}>
                    Operational
                  </Badge>
                </div>
              </div>
            </Panel>

            <Panel
              title="All Villages scope"
              subtitle="Which villages are included when the scope is set to “All Villages” — this drives the Dashboard, Overview and Network tab."
              icon={<Globe2 size={15} />}
              tone="navy"
              padding={false}
              actions={
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => setVisibleSiteIds(null)}>Select all</Button>
                  <Button variant="ghost" size="xs" onClick={() => setVisibleSiteIds([])}>Clear</Button>
                </div>
              }
            >
              <div className="flex flex-col divide-y divide-[var(--border-subtle)] max-h-[380px] overflow-y-auto scrollbar-none">
                {sites.length === 0 ? (
                  <div className="px-5 sm:px-6 py-4 text-[12.5px] text-[var(--fg-muted)]">
                    No villages yet — add them under Network.
                  </div>
                ) : (
                  sites.map((s) => (
                    <CheckRow
                      key={s.id}
                      checked={isSiteVisible(s.id)}
                      title={s.name}
                      subtitle={s.hostname}
                      onClick={() => toggleVisibleSite(s.id)}
                    />
                  ))
                )}
              </div>
              {sites.length > 0 && (
                <PanelFooter
                  note={
                    <span>
                      {allVisible ? `All ${sites.length} villages` : `${visibleSites.length} of ${sites.length} villages`} in
                      the All Villages scope.
                    </span>
                  }
                />
              )}
            </Panel>
          </>
        )}

        {/* ══════════════════════════ Schedules ══════════════════════════ */}
        {tab === "schedules" && (
          <>
            <Panel
              title="Voucher sync"
              subtitle="How often the portal pulls the latest vouchers from Ruijie (Excel export). Turn it off to pause all automatic syncing — you can still sync on demand from the Dashboard."
              icon={<RefreshCw size={15} />}
              tone="teal"
              padding={false}
            >
              <FormBody>
                <SettingRow
                  title="Automatic sync"
                  description={
                    syncEnabled
                      ? "Vouchers refresh automatically on the schedule below."
                      : "Automatic syncing is paused."
                  }
                >
                  <Toggle checked={syncEnabled} onChange={setSyncEnabled} />
                </SettingRow>

                <SettingRow
                  title="Sync frequency"
                  description="Minimum 5 minutes to protect the Ruijie API rate limit. More villages = more calls per cycle."
                  htmlFor="sync-interval"
                >
                  <Select
                    id="sync-interval"
                    value={syncInterval}
                    onChange={(e) => setSyncInterval(Number(e.target.value))}
                    disabled={!syncEnabled}
                  >
                    {intervalChoices.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
              </FormBody>

              <PanelFooter
                note={
                  syncStatus && (
                    <>
                      <Badge tone={syncStatus.enabled ? "success" : "neutral"}>
                        {syncStatus.enabled
                          ? `Auto-sync on · every ${syncStatus.intervalMinutes} min`
                          : "Auto-sync off"}
                      </Badge>
                      {syncStatus.lastSync && (
                        <span>
                          Last sync{" "}
                          {relTime(
                            syncStatus.lastSync.sync_completed_at || syncStatus.lastSync.sync_started_at
                          )}{" "}
                          · <span className="capitalize">{syncStatus.lastSync.status}</span>
                        </span>
                      )}
                    </>
                  )
                }
              >
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveSyncSettings}
                  loading={savingSync}
                  disabled={!syncDirty || savingSync}
                >
                  Save changes
                </Button>
              </PanelFooter>
            </Panel>

            <Panel
              title="Network health collection"
              subtitle="How often every village's device health and uptime are collected from Ruijie. This feeds the Overview page and the village uptime on the Dashboard."
              icon={<Globe2 size={15} />}
              tone="navy"
              padding={false}
            >
              <FormBody>
                <SettingRow
                  title="Automatic collection"
                  description={
                    netEnabled
                      ? "Every village is collected on the schedule below."
                      : "Paused — the Overview and Dashboard uptime will show the last collected values."
                  }
                >
                  <Toggle checked={netEnabled} onChange={setNetEnabled} />
                </SettingRow>

                <SettingRow
                  title="Collection frequency"
                  description="Each cycle costs about 4 Ruijie calls per village against a ~5,000/day account quota. Minimum one hour. Uptime % is the share of collected samples that were up, so a longer interval means coarser uptime."
                  htmlFor="net-interval"
                >
                  <Select
                    id="net-interval"
                    value={netInterval}
                    onChange={(e) => setNetInterval(Number(e.target.value))}
                    disabled={!netEnabled}
                  >
                    {netIntervalChoices.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
              </FormBody>

              <PanelFooter
                note={
                  netStatus && (
                    <>
                      <Badge tone={netStatus.enabled ? "success" : "neutral"}>
                        {netStatus.enabled
                          ? `Collection on · every ${netStatus.intervalMinutes} min`
                          : "Collection off"}
                      </Badge>
                      {netStatus.running && <Badge tone="warning">Running now</Badge>}
                      {netStatus.lastCollected && <span>Last collected {relTime(netStatus.lastCollected)}</span>}
                      {netStatus.lastRun?.error && (
                        <span className="text-[var(--danger-fg)]">Last run failed: {netStatus.lastRun.error}</span>
                      )}
                    </>
                  )
                }
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={runCollectNow}
                  loading={collecting}
                  disabled={collecting}
                  iconLeft={!collecting && <RefreshCw size={14} />}
                >
                  Refresh all villages now
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveNetSettings}
                  loading={savingNet}
                  disabled={!netDirty || savingNet}
                >
                  Save changes
                </Button>
              </PanelFooter>
            </Panel>
          </>
        )}

        {/* ════════════════════════════ Email ════════════════════════════ */}
        {tab === "email" && (
          <>
            <Panel
              title="Email (SMTP)"
              subtitle="Outgoing mail server. Receipts and manual-assistance emails are sent through this account."
              icon={<Mail size={15} />}
              tone="blue"
              padding={false}
            >
              <FormBody>
                <SettingRow
                  title="Enable email sending"
                  description={
                    smtp.enabled ? "The app may send email once the feature is live." : "Email sending is off."
                  }
                >
                  <Toggle checked={smtp.enabled} onChange={(v) => setSmtpField("enabled", v)} />
                </SettingRow>
              </FormBody>

              {/* Three groups, because the questions are different: where to
                  connect, who to connect as, and what the recipient sees. */}
              <div className="px-5 sm:px-6 pb-6 pt-6 flex flex-col gap-7 border-t border-[var(--border-subtle)]">
                <Section label="Server">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <Field label="SMTP host" htmlFor="smtp-host">
                        <Input
                          id="smtp-host"
                          value={smtp.host}
                          onChange={(e) => setSmtpField("host", e.target.value)}
                          placeholder="smtp.example.com"
                        />
                      </Field>
                    </div>
                    <Field label="Port" htmlFor="smtp-port">
                      <Input
                        id="smtp-port"
                        value={smtp.port}
                        onChange={(e) => setSmtpField("port", e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="587"
                        inputMode="numeric"
                      />
                    </Field>
                  </div>
                  <Field
                    label="Encryption"
                    hint="STARTTLS uses port 587; SSL/TLS uses port 465."
                    className="max-w-xs"
                    htmlFor="smtp-enc"
                  >
                    <Select id="smtp-enc" value={smtp.encryption} onChange={(e) => setSmtpField("encryption", e.target.value)}>
                      <option value="starttls">STARTTLS</option>
                      <option value="ssl">SSL/TLS</option>
                      <option value="none">None</option>
                    </Select>
                  </Field>
                </Section>

                <Section label="Authentication">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Username" htmlFor="smtp-user">
                      <Input
                        id="smtp-user"
                        value={smtp.username}
                        onChange={(e) => setSmtpField("username", e.target.value)}
                        placeholder="user@example.com"
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      label="Password"
                      htmlFor="smtp-pass"
                      hint={smtpHasPassword ? "A password is stored — leave blank to keep it." : undefined}
                    >
                      <Input
                        id="smtp-pass"
                        type="password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        placeholder={smtpHasPassword ? "•••••••• (unchanged)" : "SMTP password"}
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                </Section>

                <Section label="Sender">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="From name" htmlFor="smtp-from-name">
                      <Input
                        id="smtp-from-name"
                        value={smtp.fromName}
                        onChange={(e) => setSmtpField("fromName", e.target.value)}
                        placeholder="Vodafone Fiji USO"
                      />
                    </Field>
                    <Field label="From email" htmlFor="smtp-from-email">
                      <Input
                        id="smtp-from-email"
                        type="email"
                        value={smtp.fromEmail}
                        onChange={(e) => setSmtpField("fromEmail", e.target.value)}
                        placeholder="no-reply@vodafone.com.fj"
                      />
                    </Field>
                  </div>
                </Section>
              </div>

              <PanelFooter note={smtpDirty ? <span className="text-[var(--brand)] font-medium">Unsaved changes</span> : <span>No changes</span>}>
                <Button variant="primary" size="sm" onClick={saveSmtp} loading={savingSmtp} disabled={!smtpDirty || savingSmtp}>
                  Save SMTP settings
                </Button>
              </PanelFooter>
            </Panel>

            {/* Its own panel rather than a footnote under the server form: this
                is the only way to see what the templates actually look like. */}
            <Panel
              title="Send a test email"
              subtitle="Sends the selected template (with sample data) using the saved settings above — save first if you just changed them. Every test send is recorded in Portal Logs."
              icon={<Send size={15} />}
              tone="violet"
              padding={false}
            >
              <div className="px-5 sm:px-6 py-5 flex flex-col sm:flex-row gap-3 sm:items-end">
                <Field label="Template" className="sm:w-60" htmlFor="test-template">
                  <Select id="test-template" value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)}>
                    <option value="connection">Connection test</option>
                    <option value="receipt">Purchase receipt</option>
                    <option value="manual_assist">Manual assistance - voucher code</option>
                  </Select>
                </Field>
                <Field label="Recipient" className="flex-1" htmlFor="test-email">
                  <Input
                    id="test-email"
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="recipient@example.com"
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={sendTest}
                  loading={sendingTest}
                  disabled={!testEmail.trim() || sendingTest}
                  iconLeft={!sendingTest && <Send size={14} />}
                >
                  Send test
                </Button>
              </div>
            </Panel>

            <Panel
              title="Purchase receipts"
              subtitle="On a successful purchase, email a receipt (voucher code, status link, shared-pool note) to the customer's email from the M-PAiSA mapping."
              icon={<Receipt size={15} />}
              tone="green"
              padding={false}
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setReceiptGroupIds(sites.map((x) => x.ruijieGroupId).filter(Boolean).join(","))}
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => setReceiptGroupIds("")}>Clear</Button>
                </div>
              }
            >
              <FormBody>
                <SettingRow
                  title="Email purchase receipts"
                  description={
                    receiptsEnabled
                      ? "Customers who bought through M-PAiSA are emailed their voucher and status link."
                      : "No receipts are sent, whatever is ticked below."
                  }
                >
                  <Toggle checked={receiptsEnabled} onChange={setReceiptsEnabled} />
                </SettingRow>

                <SettingRow
                  title="Villages"
                  description="Only the selected villages send receipts. A village that is not ticked records a “not selected” note against the purchase instead of emailing."
                  wide
                >
                  <div className="rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-subtle)] max-h-[260px] overflow-y-auto scrollbar-none">
                    {sites.length === 0 ? (
                      <div className="px-4 py-3 text-[12.5px] text-[var(--fg-muted)]">
                        No villages yet — add them under Network.
                      </div>
                    ) : (
                      sites.map((s) => {
                        const gid = s.ruijieGroupId;
                        return (
                          <CheckRow
                            key={s.id}
                            checked={gid ? isReceiptSite(gid) : false}
                            disabled={!gid}
                            title={s.name}
                            subtitle={gid || undefined}
                            note={!gid ? "no group id" : undefined}
                            onClick={() => gid && toggleReceiptSite(gid)}
                          />
                        );
                      })
                    )}
                  </div>
                </SettingRow>
              </FormBody>

              {/* What the SERVER holds, not what the boxes show. The two differ
                  until Save is pressed, and that gap is exactly how a village
                  silently stops sending receipts. */}
              <PanelFooter
                note={
                  receiptsDirty ? (
                    <span className="text-[var(--brand)] font-medium">Unsaved changes</span>
                  ) : (
                    <span>
                      Saved:{" "}
                      {origReceipts.enabled ? (
                        <span className="text-[var(--fg-secondary)]">
                          on for {savedReceiptCount} village{savedReceiptCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-[var(--fg-secondary)]">off</span>
                      )}
                    </span>
                  )
                }
              >
                <Button
                  variant={receiptsDirty ? "primary" : "secondary"}
                  size="sm"
                  onClick={saveReceipts}
                  loading={savingReceipts}
                  disabled={!receiptsDirty || savingReceipts}
                >
                  Save receipt settings
                </Button>
              </PanelFooter>
            </Panel>
          </>
        )}

        {/* ═══════════════════════════ Starlink ══════════════════════════ */}
        {tab === "starlink" && (
          <>
            <Panel
              title="Starlink API"
              subtitle="Credentials for the Starlink account. Shared by every village; the service line below decides which kit each village reads."
              icon={<Satellite size={15} />}
              tone="indigo"
              padding={false}
            >
              <FormBody>
                <SettingRow
                  title="Enable Starlink data"
                  description={
                    sl.enabled
                      ? "Village dashboards show usage for any village with a service line."
                      : "Starlink cards are hidden everywhere."
                  }
                >
                  <Toggle checked={sl.enabled} onChange={(v) => setSlField("enabled", v)} />
                </SettingRow>
              </FormBody>

              <div className="px-5 sm:px-6 pb-6 pt-6 flex flex-col gap-7 border-t border-[var(--border-subtle)]">
                <Section label="Endpoints">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Token URL" hint="OAuth2 client-credentials endpoint." htmlFor="sl-token">
                      <Input
                        id="sl-token"
                        value={sl.tokenUrl}
                        onChange={(e) => setSlField("tokenUrl", e.target.value)}
                        placeholder="https://www.starlink.com/api/auth/connect/token"
                        mono
                      />
                    </Field>
                    <Field label="API base URL" htmlFor="sl-base">
                      <Input
                        id="sl-base"
                        value={sl.apiBaseUrl}
                        onChange={(e) => setSlField("apiBaseUrl", e.target.value)}
                        placeholder="https://starlink.com/api/public"
                        mono
                      />
                    </Field>
                  </div>
                </Section>

                <Section label="Credentials">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Client ID" htmlFor="sl-client">
                      <Input
                        id="sl-client"
                        value={sl.clientId}
                        onChange={(e) => setSlField("clientId", e.target.value)}
                        placeholder="Starlink client id"
                        mono
                      />
                    </Field>
                    <Field
                      label="Client secret"
                      htmlFor="sl-secret"
                      hint={slHasSecret ? "A secret is stored. Leave blank to keep it." : "Stored encrypted at rest; never sent back to the browser."}
                    >
                      <Input
                        id="sl-secret"
                        type="password"
                        value={slSecret}
                        onChange={(e) => setSlSecret(e.target.value)}
                        placeholder={slHasSecret ? "•••••••••• (unchanged)" : "Starlink client secret"}
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                </Section>

                {slTest && (
                  <div className="rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-subtle)] overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--surface-sunken)] flex items-center gap-2">
                      <KeyRound size={13} className="text-[var(--fg-muted)]" />
                      <span className="text-label">Connection test</span>
                      <Badge tone={slTest.ok ? "success" : "danger"} className="ml-auto">
                        {slTest.ok ? "Passed" : "Failed"}
                      </Badge>
                    </div>
                    {slTest.steps.map((st, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-start gap-2.5">
                        <span
                          className="mt-[5px] h-2 w-2 rounded-full shrink-0"
                          style={{ background: st.ok ? "var(--success-fg)" : "var(--danger-fg)" }}
                        />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--fg-primary)]">{st.name}</p>
                          <p className="text-[11.5px] text-[var(--fg-muted)] break-words">{st.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <PanelFooter
                note={
                  slDirty ? (
                    <span className="text-[var(--brand)] font-medium">Unsaved changes</span>
                  ) : origSl ? (
                    <span>No changes</span>
                  ) : null
                }
              >
                <Button variant="secondary" size="sm" onClick={testStarlink} loading={testingSl} disabled={testingSl}>
                  Test connection
                </Button>
                <Button variant="primary" size="sm" onClick={saveStarlink} loading={savingSl} disabled={!slDirty || savingSl}>
                  Save credentials
                </Button>
              </PanelFooter>
            </Panel>

            <Panel
              title="Village service lines"
              subtitle="The service line number is what draws the usage graph. Leave it blank to hide the Starlink card for that village. The device ID is the kit's user-terminal id and is shown as information only."
              icon={<MapPin size={15} />}
              tone="navy"
              padding={false}
            >
              <div className="divide-y divide-[var(--border-subtle)] max-h-[520px] overflow-y-auto scrollbar-none">
                {sites.length === 0 ? (
                  <div className="px-5 sm:px-6 py-4 text-[12.5px] text-[var(--fg-muted)]">
                    No villages yet — add them under Network.
                  </div>
                ) : (
                  sites.map((s) => {
                    const row = slSites[s.id] || { serviceLine: "", deviceId: "" };
                    const setRow = (k, v) =>
                      setSlSites((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] || {}), [k]: v } }));
                    return (
                      <div key={s.id} className="px-5 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center gap-3">
                        <div className="lg:w-44 min-w-0 shrink-0">
                          <p className="text-[13px] font-semibold text-[var(--fg-primary)] truncate font-display">{s.name}</p>
                          {s.hostname && <p className="text-[10.5px] font-mono text-[var(--fg-muted)] truncate">{s.hostname}</p>}
                        </div>
                        <Input
                          className="flex-1"
                          value={row.serviceLine}
                          onChange={(e) => setRow("serviceLine", e.target.value)}
                          placeholder="Service line number"
                          aria-label={`${s.name} service line number`}
                          mono
                        />
                        <Input
                          className="flex-1"
                          value={row.deviceId}
                          onChange={(e) => setRow("deviceId", e.target.value)}
                          placeholder="Device ID (optional)"
                          aria-label={`${s.name} device id`}
                          mono
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => saveStarlinkSite(s.id)}
                          loading={savingSite === s.id}
                          disabled={savingSite === s.id}
                          className="shrink-0"
                        >
                          Save
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          </>
        )}
      </div>
    </PageShell>
  );
}
