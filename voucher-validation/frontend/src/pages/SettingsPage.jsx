// src/pages/SettingsPage.jsx
// System information + read-only app settings.

import { useEffect, useState } from "react";
import { Settings, Server, Eye, EyeOff, MapPin, Check, Globe2, RefreshCw, Mail, Satellite } from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi, networkApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { Button, Panel, Badge, PageHeader, Toggle, Select, Field, Input } from "../components/ui";

// Sync-frequency presets. Floor is 5 min to protect the Ruijie account-wide rate
// limit (the backend clamps to the same range regardless of what's sent).
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

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState(false);
  const { sites, isSiteVisible, toggleVisibleSite, setVisibleSiteIds, allVisible, visibleSites } = useSite();

  // Voucher-sync schedule
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncInterval, setSyncInterval] = useState(10);
  const [origSync, setOrigSync] = useState({ enabled: true, interval: 10 });
  const [savingSync, setSavingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

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
      setOrigReceipts({ enabled: receiptsEnabled, groupIds: gids });
      toast.success("Receipt settings saved");
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

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle="Environment configuration and runtime status."
        icon={<Settings size={20} />}
        className="mx-auto max-w-4xl xl:max-w-6xl"
      />

      {/* Centered; the panels sit two-up on wide screens (single column when
          narrow) so they fill the width without dead space. */}
      <div className="mt-6 mx-auto max-w-4xl xl:max-w-6xl grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* Left column: short System info stacked above the tall SMTP form so
            the two columns end up roughly the same height. */}
        <div className="space-y-5">
        {/* System info */}
        <Panel
          title="System information"
          icon={<Server size={15} />}
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
          <div className="flex flex-col divide-y divide-[var(--border-default)]">
            {envVars.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-surface)] transition-colors"
              >
                <span className="text-[12.5px] text-[var(--fg-secondary)]">
                  {label}
                </span>
                <span className="text-[12.5px] font-mono text-[var(--fg-primary)]">
                  {value}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-[12.5px] text-[var(--fg-secondary)]">Status</span>
              <Badge
                tone="success"
                icon={
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success-fg)]" />
                }
              >
                Operational
              </Badge>
            </div>
          </div>
        </Panel>

        {/* Email (SMTP) */}
        <Panel
          title="Email (SMTP)"
          subtitle="Outgoing mail server for upcoming email features. Not wired to anything yet — safe to configure ahead of time."
          icon={<Mail size={15} />}
        >
          <div className="space-y-5">
            <Toggle
              checked={smtp.enabled}
              onChange={(v) => setSmtpField("enabled", v)}
              label="Enable email sending"
              hint={smtp.enabled ? "The app may send email once the feature is live." : "Email sending is off."}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Field label="SMTP host">
                  <Input value={smtp.host} onChange={(e) => setSmtpField("host", e.target.value)} placeholder="smtp.example.com" />
                </Field>
              </div>
              <Field label="Port">
                <Input
                  value={smtp.port}
                  onChange={(e) => setSmtpField("port", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="587"
                  inputMode="numeric"
                />
              </Field>
            </div>

            <Field label="Encryption" hint="STARTTLS uses port 587; SSL/TLS uses port 465." className="max-w-xs">
              <Select value={smtp.encryption} onChange={(e) => setSmtpField("encryption", e.target.value)}>
                <option value="starttls">STARTTLS</option>
                <option value="ssl">SSL/TLS</option>
                <option value="none">None</option>
              </Select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Username">
                <Input value={smtp.username} onChange={(e) => setSmtpField("username", e.target.value)} placeholder="user@example.com" autoComplete="off" />
              </Field>
              <Field label="Password" hint={smtpHasPassword ? "A password is stored — leave blank to keep it." : undefined}>
                <Input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={smtpHasPassword ? "•••••••• (unchanged)" : "SMTP password"}
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="From name">
                <Input value={smtp.fromName} onChange={(e) => setSmtpField("fromName", e.target.value)} placeholder="Vodafone Fiji USO" />
              </Field>
              <Field label="From email">
                <Input type="email" value={smtp.fromEmail} onChange={(e) => setSmtpField("fromEmail", e.target.value)} placeholder="no-reply@vodafone.com.fj" />
              </Field>
            </div>

            <div className="flex justify-end border-t border-[var(--border-default)] pt-4">
              <Button variant="primary" onClick={saveSmtp} loading={savingSmtp} disabled={!smtpDirty || savingSmtp}>
                Save SMTP settings
              </Button>
            </div>

            {/* Send a test email using the saved config. Pick which template to
                send so email designs can be reviewed in a real inbox. */}
            <div className="border-t border-[var(--border-default)] pt-4 space-y-2">
              <p className="text-[12.5px] font-medium text-[var(--fg-secondary)]">Send a test email</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select
                  value={testTemplate}
                  onChange={(e) => setTestTemplate(e.target.value)}
                  className="sm:w-44"
                >
                  <option value="connection">Connection test</option>
                  <option value="receipt">Purchase receipt</option>
                </Select>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={sendTest}
                  loading={sendingTest}
                  disabled={!testEmail.trim() || sendingTest}
                >
                  Send test
                </Button>
              </div>
              <p className="text-[11px] text-[var(--fg-muted)]">
                Sends the selected template (with sample data) using the saved settings above — save first if you just changed them. Every test send is recorded in Portal Logs.
              </p>
            </div>

            {/* Purchase receipts */}
            <div className="border-t border-[var(--border-default)] pt-4 space-y-3">
              <Toggle
                checked={receiptsEnabled}
                onChange={setReceiptsEnabled}
                label="Email purchase receipts"
                hint="On a successful purchase, email a receipt (voucher code, status link, shared-pool note) to the customer's email from the M-PAiSA mapping."
              />
              <div>
                <p className="text-sm font-medium text-[var(--fg-primary)]">Sites</p>
                <p className="text-[11.5px] text-[var(--fg-muted)] mt-0.5 mb-2">
                  Only the selected villages send receipts. Start with USO_2.
                </p>
                <div className="rounded-lg border border-[var(--border-default)] divide-y divide-[var(--border-default)] max-h-[220px] overflow-y-auto scrollbar-none">
                  {sites.length === 0 ? (
                    <div className="px-3 py-3 text-[12.5px] text-[var(--fg-muted)]">
                      No villages yet — add them under Network.
                    </div>
                  ) : (
                    sites.map((s) => {
                      const gid = s.ruijieGroupId;
                      const on = gid ? isReceiptSite(gid) : false;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={!gid}
                          onClick={() => gid && toggleReceiptSite(gid)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span
                            className={
                              "shrink-0 h-[18px] w-[18px] rounded flex items-center justify-center border transition-colors " +
                              (on
                                ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                                : "border-[var(--border-strong)] text-transparent")
                            }
                          >
                            <Check size={12} strokeWidth={3} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-medium text-[var(--fg-primary)] truncate">{s.name}</span>
                            {gid && <span className="block text-[10.5px] font-mono text-[var(--fg-muted)] truncate">{gid}</span>}
                          </span>
                          {!gid && <span className="text-[10px] text-[var(--fg-muted)] shrink-0">no group id</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={saveReceipts}
                  loading={savingReceipts}
                  disabled={!receiptsDirty || savingReceipts}
                >
                  Save receipt settings
                </Button>
              </div>
            </div>
          </div>
        </Panel>
        </div>

        {/* Right column: sync schedule + the (scrollable) village scope. */}
        <div className="space-y-5">
        {/* Voucher sync schedule */}
        <Panel
          title="Voucher sync"
          subtitle="How often the portal pulls the latest vouchers from Ruijie (Excel export). Turn it off to pause all automatic syncing — you can still sync on demand from the Dashboard."
          icon={<RefreshCw size={15} />}
        >
          <div className="space-y-5">
            <Toggle
              checked={syncEnabled}
              onChange={setSyncEnabled}
              label="Automatic sync"
              hint={
                syncEnabled
                  ? "Vouchers refresh automatically on the schedule below."
                  : "Automatic syncing is paused."
              }
            />

            <Field
              label="Sync frequency"
              hint="Minimum 5 minutes to protect the Ruijie API rate limit. More villages = more calls per cycle."
              className="max-w-xs"
            >
              <Select
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
            </Field>

            {syncStatus && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--text-tertiary)]">
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
              </div>
            )}

            <div className="flex justify-end border-t border-[var(--border-default)] pt-4">
              <Button
                variant="primary"
                onClick={saveSyncSettings}
                loading={savingSync}
                disabled={!syncDirty || savingSync}
              >
                Save changes
              </Button>
            </div>
          </div>
        </Panel>

        {/* All Villages scope */}
        <Panel
          title="All Villages scope"
          subtitle="Choose which villages are included when the scope is set to “All Villages” — this drives the Dashboard, Overview and Network tab."
          icon={<Globe2 size={15} />}
          padding={false}
          actions={
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={() => setVisibleSiteIds(null)}>Select all</Button>
              <Button variant="ghost" size="xs" onClick={() => setVisibleSiteIds([])}>Clear</Button>
            </div>
          }
        >
          <div className="flex flex-col divide-y divide-[var(--border-default)] max-h-[340px] overflow-y-auto scrollbar-none">
            {sites.length === 0 ? (
              <div className="px-5 py-4 text-[12.5px] text-[var(--fg-muted)]">
                No villages yet — add them under Network.
              </div>
            ) : (
              sites.map((s) => {
                const on = isSiteVisible(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleVisibleSite(s.id)}
                    className="flex items-center gap-3 px-5 py-3 text-left hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <span
                      className={
                        "shrink-0 h-[18px] w-[18px] rounded flex items-center justify-center border transition-colors " +
                        (on
                          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                          : "border-[var(--border-strong)] text-transparent")
                      }
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <MapPin size={14} className="shrink-0 text-[var(--fg-muted)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-[var(--fg-primary)] truncate">{s.name}</p>
                      {s.hostname && (
                        <p className="text-[11px] font-mono text-[var(--fg-muted)] truncate">{s.hostname}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {sites.length > 0 && (
            <div className="px-5 py-2.5 border-t border-[var(--border-default)] text-[11.5px] text-[var(--fg-muted)]">
              {allVisible ? `All ${sites.length} villages` : `${visibleSites.length} of ${sites.length} villages`} in the All Villages scope.
            </div>
          )}
        </Panel>

        {/* Starlink: one set of API credentials for the whole account, plus the
            per-village identifiers that drive each village's usage graph. */}
        <Panel
          title="Starlink"
          subtitle="API credentials for the account, and the service line for each village."
          icon={<Satellite size={15} />}
        >
          <div className="space-y-4">
            <Toggle
              checked={sl.enabled}
              onChange={(v) => setSlField("enabled", v)}
              label="Enable Starlink data"
              hint={sl.enabled ? "Village dashboards show usage for any village with a service line." : "Starlink cards are hidden everywhere."}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Token URL" hint="OAuth2 client-credentials endpoint.">
                <Input value={sl.tokenUrl} onChange={(e) => setSlField("tokenUrl", e.target.value)} placeholder="https://www.starlink.com/api/auth/connect/token" mono />
              </Field>
              <Field label="API base URL">
                <Input value={sl.apiBaseUrl} onChange={(e) => setSlField("apiBaseUrl", e.target.value)} placeholder="https://starlink.com/api/public" mono />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Client ID">
                <Input value={sl.clientId} onChange={(e) => setSlField("clientId", e.target.value)} placeholder="Starlink client id" mono />
              </Field>
              <Field
                label="Client secret"
                hint={slHasSecret ? "A secret is stored. Leave blank to keep it." : "Stored encrypted at rest; never sent back to the browser."}
              >
                <Input
                  type="password"
                  value={slSecret}
                  onChange={(e) => setSlSecret(e.target.value)}
                  placeholder={slHasSecret ? "•••••••••• (unchanged)" : "Starlink client secret"}
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={saveStarlink} loading={savingSl} disabled={!slDirty || savingSl}>
                Save credentials
              </Button>
              {!slDirty && origSl && <span className="text-[11.5px] text-[var(--fg-muted)]">No changes</span>}
            </div>

            {/* Per-village identifiers */}
            <div className="border-t border-[var(--border-default)] pt-4">
              <p className="text-[12.5px] font-medium text-[var(--fg-secondary)]">Villages</p>
              <p className="text-[11.5px] text-[var(--fg-muted)] mt-0.5 mb-3">
                The service line number is what draws the usage graph. Leave it blank to hide the Starlink card for that village. The device ID is the kit's user-terminal id and is shown as information only.
              </p>

              <div className="rounded-lg border border-[var(--border-default)] divide-y divide-[var(--border-default)] max-h-[320px] overflow-y-auto scrollbar-none">
                {sites.length === 0 ? (
                  <div className="px-3 py-3 text-[12.5px] text-[var(--fg-muted)]">
                    No villages yet — add them under Network.
                  </div>
                ) : (
                  sites.map((s) => {
                    const row = slSites[s.id] || { serviceLine: "", deviceId: "" };
                    const setRow = (k, v) =>
                      setSlSites((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] || {}), [k]: v } }));
                    return (
                      <div key={s.id} className="px-3 py-3 flex flex-col sm:flex-row sm:items-end gap-2.5">
                        <div className="sm:w-40 min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--fg-primary)] truncate">{s.name}</p>
                          {s.hostname && <p className="text-[10.5px] font-mono text-[var(--fg-muted)] truncate">{s.hostname}</p>}
                        </div>
                        <Input
                          className="flex-1"
                          value={row.serviceLine}
                          onChange={(e) => setRow("serviceLine", e.target.value)}
                          placeholder="Service line number"
                          mono
                        />
                        <Input
                          className="flex-1"
                          value={row.deviceId}
                          onChange={(e) => setRow("deviceId", e.target.value)}
                          placeholder="Device ID (optional)"
                          mono
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => saveStarlinkSite(s.id)}
                          loading={savingSite === s.id}
                          disabled={savingSite === s.id}
                        >
                          Save
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </Panel>
        </div>
      </div>
    </div>
  );
}
