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

import { useEffect, useState , useCallback} from "react";
import {
  Settings, Server, Eye, EyeOff, MapPin, Check, Globe2, RefreshCw, Mail,
  Satellite, Send, Receipt, KeyRound, ShieldCheck, ShieldOff, Shield,
  AlertTriangle, History, Info,
} from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi, networkApi, twoFactorApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { useAuth } from "../hooks/useAuth";
import {
  PageShell, PageHeader, Panel, Badge, Toggle, Select, Field, Input, Button, Tabs, Section, SkeletonCard,
  StatusPill,
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
  { value: "security", label: "Security", icon: <ShieldCheck size={14} /> },
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
/* ============================================================================
   Village display scope — the estate default and this account's own view.

   The estate default is the real boundary for a viewer, engineer or billing
   account: the server answers their dashboard, overview, maintenance and bill
   with exactly these villages. "Your view" is a filter on top — Dashboard,
   Overview and Billing all follow it, the same way — and can only ever narrow
   what a non-admin already gets. For an admin, who is unrestricted, it is how a
   test village gets looked at without being put in front of the team.
   ========================================================================= */
function VillageScopePanels() {
  const {
    sites, isSiteVisible, toggleVisibleSite, setVisibleSiteIds,
    globalVisibleSiteIds, followingEstateDefault, followEstateDefault,
    visibleSites, allVisible, reload, estateDefault,
  } = useSite();
  const { isAdmin } = useAuth();

  // The estate default is edited here as a draft and saved explicitly. It
  // changes what every other account sees, which is not something to commit on
  // each click of a checkbox.
  const [draft, setDraft] = useState(null);       // null until "Edit" is pressed
  const [saving, setSaving] = useState(false);

  const globalSet = globalVisibleSiteIds;         // null = every village
  const editing = draft !== null;
  const shown = editing ? draft : globalSet;
  const globalCount = globalSet == null ? sites.length : globalSet.length;

  // An unsaved draft changes the console for everyone once saved, and until
  // then exists only in this tab. Leaving the page loses it, so say so.
  const dirty =
    editing &&
    JSON.stringify([...draft].sort((a, b) => a - b)) !==
      JSON.stringify(globalSet == null ? sites.map((s) => s.id).sort((a, b) => a - b) : [...globalSet].sort((a, b) => a - b));
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Whether "every village" is a choice somebody saved or the absence of one.
  // null (the preferences did not load) or "unknown" (the server could not read
  // the setting) is neither: the real default may be a list that leaves test
  // villages out, and starting an edit from "every village" and saving would
  // quietly put them back for everyone — and onto the bill.
  const mode = estateDefault?.mode;
  const defaultUnknown = !estateDefault || mode === "unknown";
  const savedNote = estateDefault?.updatedAt
    ? ` Saved ${new Date(estateDefault.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}${estateDefault.updatedByName ? ` by ${estateDefault.updatedByName}` : ""}.`
    : "";
  // This account's own view differs from the default in force for everyone else.
  const personalDiffers =
    !followingEstateDefault &&
    JSON.stringify([...visibleSites.map((s) => s.id)].sort((a, b) => a - b)) !==
      JSON.stringify((globalSet == null ? sites.map((s) => s.id) : sites.filter((s) => globalSet.includes(s.id)).map((s) => s.id)).sort((a, b) => a - b));

  function toggleDraft(id) {
    setDraft((prev) => {
      const base = prev ?? (globalSet == null ? sites.map((s) => s.id) : globalSet);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  }

  async function saveGlobal() {
    setSaving(true);
    try {
      // Every village selected is stored as "no restriction" rather than as a
      // list of all of them, so a village added later is included by default
      // instead of silently missing from a stale list.
      const value = draft && draft.length < sites.length ? JSON.stringify(draft) : null;
      await settingsApi.update("global_visible_villages", value, "json");
      toast.success("Estate default saved — it applies to everyone following it");
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* ── Estate default ─────────────────────────────────────────────── */}
      <Panel
        title="Estate default"
        subtitle="Which villages count as “All Villages” — on the dashboards and the bill — for everyone who has not set their own view. Take a test village out here and it leaves the console for the whole team."
        icon={<Globe2 size={15} />}
        tone="navy"
        padding={false}
        actions={
          !isAdmin ? null : editing ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={() => setDraft(sites.map((s) => s.id))} disabled={saving}>
                Select all
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setDraft([])} disabled={saving}>
                Clear
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" size="xs" onClick={saveGlobal} loading={saving}>
                Save for everyone
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setDraft(globalSet == null ? sites.map((s) => s.id) : globalSet)}
              disabled={defaultUnknown}
              title={defaultUnknown ? "The estate default could not be loaded — reload the page before editing it" : undefined}
            >
              Edit
            </Button>
          )
        }
      >
        <div className="flex flex-col divide-y divide-[var(--border-subtle)] max-h-[320px] overflow-y-auto scrollbar-none">
          {sites.length === 0 ? (
            <div className="px-5 sm:px-6 py-4 text-[12.5px] text-[var(--fg-muted)]">
              No villages yet — add them under Network.
            </div>
          ) : (
            sites.map((s) => (
              <CheckRow
                key={s.id}
                checked={shown == null || shown.includes(s.id)}
                disabled={!editing}
                title={s.name}
                subtitle={s.hostname}
                onClick={() => toggleDraft(s.id)}
              />
            ))
          )}
        </div>
        {sites.length > 0 && (
          <PanelFooter
            note={
              <span>
                {defaultUnknown
                  ? "The estate default could not be loaded. Reload the page before relying on it or editing it."
                  : mode === "unset"
                  ? `Never saved — every village (${sites.length}) is in, including any added later.`
                  : mode === "unreadable"
                    ? `The saved value could not be read, so every village (${sites.length}) is in. Save it again.`
                    : globalSet == null
                      ? `Every village (${sites.length}), including any added later.`
                      : `${globalCount} of ${sites.length} villages.`}
                {savedNote}
                {dirty && " Unsaved changes — nothing applies until you save."}
                {!isAdmin && " Set by an administrator."}
              </span>
            }
          />
        )}
      </Panel>

      {/* ── This account's own view ────────────────────────────────────── */}
      <Panel
        title="Your view"
        subtitle="Only affects you: your Dashboard, Overview, village switcher and Billing follow it. Use it to look at a village the estate default leaves out — a test site, say — without putting it in front of anybody else."
        icon={<Eye size={15} />}
        tone="violet"
        padding={false}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setVisibleSiteIds(sites.map((s) => s.id))}>
              Select all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={followEstateDefault}
              disabled={followingEstateDefault}
              title="Go back to whatever the estate default says"
            >
              Follow default
            </Button>
          </div>
        }
      >
        {personalDiffers && (
          <div className="flex items-start gap-2 border-b border-[var(--border-subtle)] bg-[var(--info-soft)] px-5 sm:px-6 py-2.5 text-[12px] text-[var(--info-fg)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              You are not following the estate default, so your Dashboard and Billing can show different villages
              from everyone else's.
            </span>
          </div>
        )}
        <div className="flex flex-col divide-y divide-[var(--border-subtle)] max-h-[320px] overflow-y-auto scrollbar-none">
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
                note={
                  globalSet != null && !globalSet.includes(s.id)
                    ? "not in the estate default"
                    : undefined
                }
                onClick={() => toggleVisibleSite(s.id)}
              />
            ))
          )}
        </div>
        {sites.length > 0 && (
          <PanelFooter
            note={
              <span>
                {followingEstateDefault
                  ? `Following the estate default — ${allVisible ? `all ${sites.length}` : `${visibleSites.length} of ${sites.length}`} villages.`
                  : `Your own selection — ${visibleSites.length} of ${sites.length} villages. Nobody else is affected.`}
              </span>
            }
          />
        )}
      </Panel>
    </>
  );
}

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
  // ?tab=email opens straight onto a tab — other pages link here to fix one
  // thing (Email Campaigns → "Email sending is turned off"). Unknown values fall
  // back to General.
  const [tab, setTab] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((t) => t.value === wanted) ? wanted : "general";
  });
  const [settings, setSettings] = useState([]); // eslint-disable-line no-unused-vars -- raw rows, kept for future keys
  const [loading, setLoading] = useState(true); // eslint-disable-line no-unused-vars
  // Details are shown by default; the button masks them for screen-sharing.
  const [showSecrets, setShowSecrets] = useState(true);
  // The village pickers moved into VillageScopePanels, which reads useSite
  // itself; the page only needs the list.
  const { sites } = useSite();

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
        {tab === "security" && <SecurityTab />}

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

            {/* Two layers, deliberately separate.

                The estate default is the one that matters operationally: it is
                where a test village is taken out of the console once, for
                everybody. The personal view exists so that doing so does not
                also stop the admin from looking at it — they can tick it back
                on for themselves without putting it in front of the team. */}
            <VillageScopePanels />
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
              subtitle="Outgoing mail server. Receipts, manual-assistance emails and email campaigns are sent through this account."
              icon={<Mail size={15} />}
              tone="blue"
              padding={false}
            >
              <FormBody>
                <SettingRow
                  title="Allow email campaigns"
                  description={
                    // What this switch actually governs. Receipts, manual-assistance
                    // and account emails are sent whenever SMTP is configured; this
                    // is the kill switch for bulk campaign sending only.
                    smtp.enabled
                      ? "Campaigns can be sent. Turning this off pauses any campaign at its next email."
                      : "Campaigns cannot be sent. Receipts and account emails still go out."
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


/* ============================================================================
   Security — the estate-wide two-factor switch
   ============================================================================ */

/**
 * Turning this ON does not enrol anyone or end any session. Accounts without
 * two-factor are handed a setup token at their NEXT sign-in and enrol then,
 * which is the difference between a policy change and an outage — and worth
 * saying on the screen, because "require 2FA for everyone" reads like
 * something that locks people out this afternoon.
 */
/* ============================================================================
   Two-factor audit trail.

   A second factor that works leaves no trace of having worked, so without this
   the only 2FA events anyone can see are the ones that changed something
   visible. The value of the table is entirely in being readable when somebody
   finally asks "when did this start" — which is never at the time.
   ========================================================================= */

const EVENT_COPY = {
  enrol_started:      { label: "Setup started",      tone: "neutral", Icon: ShieldCheck },
  enrolled:           { label: "Two-factor on",      tone: "success", Icon: ShieldCheck },
  verify_ok:          { label: "Code accepted",      tone: "success", Icon: Check },
  verify_failed:      { label: "Code rejected",      tone: "warning", Icon: AlertTriangle },
  backup_used:        { label: "Backup code used",   tone: "warning", Icon: KeyRound },
  backup_regenerated: { label: "Backup codes replaced", tone: "info", Icon: KeyRound },
  disabled:           { label: "Two-factor off",     tone: "danger",  Icon: ShieldOff },
  admin_reset:        { label: "Reset by admin",     tone: "danger",  Icon: ShieldOff },
  policy_on:          { label: "Policy switched on", tone: "brand",   Icon: Shield },
  policy_off:         { label: "Policy switched off", tone: "danger", Icon: Shield },
  throttled:          { label: "Too many attempts",  tone: "danger",  Icon: AlertTriangle },
  reset_sent:         { label: "Reset link sent",    tone: "warning", Icon: KeyRound },
  reset_used:         { label: "Password reset",     tone: "success", Icon: KeyRound },
  onboarding_sent:    { label: "Onboarding link sent", tone: "info",  Icon: Send },
  onboarding_used:    { label: "Password set",       tone: "success", Icon: Check },
};

function TwoFactorLog() {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await twoFactorApi.events({ limit: 200 });
      setEvents(r.events || []);
    } catch (e) {
      toast.error("Could not read the two-factor log: " + e.message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The filter people actually want: everything that did not go smoothly.
  const shown = (events || []).filter(
    (e) => !onlyProblems || !e.success || ["admin_reset", "disabled", "policy_off", "reset_sent"].includes(e.event)
  );

  return (
    <Panel
      title="Security activity"
      subtitle="Two-factor codes accepted and rejected, password links sent and used, resets, and policy changes — with who did it. Kept for a year."
      icon={<History size={15} />}
      tone="slate"
      padding={false}
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant={onlyProblems ? "brand-ghost" : "ghost"}
            size="xs"
            onClick={() => setOnlyProblems((v) => !v)}
          >
            {onlyProblems ? "Showing problems" : "Problems only"}
          </Button>
          <Button variant="ghost" size="xs" onClick={load} disabled={loading} iconLeft={<RefreshCw size={11} />}>
            Refresh
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-[var(--fg-muted)]">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-[var(--fg-muted)]">
          {events?.length ? "Nothing but ordinary activity." : "No two-factor activity recorded yet."}
        </div>
      ) : (
        <div className="max-h-[420px] divide-y divide-[var(--border-subtle)] overflow-y-auto">
          {shown.map((e) => {
            const c = EVENT_COPY[e.event] || { label: e.event, tone: "neutral", Icon: History };
            return (
              <div key={e.id} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 shrink-0">
                  <StatusPill tone={e.success ? c.tone : "danger"} dot={false}>
                    <c.Icon size={11} />
                    {c.label}
                  </StatusPill>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-[var(--fg-primary)]">
                    {e.userEmail || (e.userId ? `account #${e.userId}` : "an account since deleted")}
                    {e.actorEmail && (
                      <span className="text-[var(--fg-muted)]"> · by {e.actorEmail}</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-[var(--fg-muted)]">
                    {new Date(e.at).toLocaleString("en-AU", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                    {e.ip && <span className="font-mono"> · {e.ip}</span>}
                    {e.detail && <span> · {e.detail}</span>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function SecurityTab() {
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPolicy(await twoFactorApi.policy());
    } catch (e) {
      toast.error("Could not read the two-factor policy: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(next) {
    setSaving(true);
    try {
      await twoFactorApi.setPolicy(next);
      setPolicy((p) => ({ ...p, required: next }));
      toast.success(
        next
          ? "Two-factor is now required. Accounts without it will set it up at their next sign-in."
          : "Two-factor is no longer required. Accounts that have it keep it."
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <SkeletonCard height="h-[280px]" />;

  const outstanding = Math.max(0, (policy?.users || 0) - (policy?.enrolled || 0));

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Two-factor authentication"
        subtitle="A code from an authenticator app, in addition to a password"
        icon={<ShieldCheck size={15} />}
        tone="green"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[var(--fg-primary)]">
              Require it for every account
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
              Nobody is locked out when this is switched on. Existing sessions run to their normal
              expiry, and an account without two-factor is walked through setting it up the next time
              it signs in.
            </p>
          </div>
          <Toggle checked={!!policy?.required} onChange={toggle} disabled={saving} />
        </div>

        <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-3 gap-4">
          <Fact label="Accounts" value={policy?.users ?? "—"} />
          <Fact label="Enrolled" value={policy?.enrolled ?? "—"} />
          <Fact
            label="Still to enrol"
            value={outstanding}
            tone={outstanding > 0 ? "warning" : "success"}
          />
        </div>

        {policy?.required && outstanding > 0 && (
          <p className="mt-4 text-[12.5px] text-[var(--fg-muted)]">
            {outstanding} account{outstanding === 1 ? "" : "s"} will be asked to set up two-factor at
            their next sign-in. If someone has lost their phone, reset their two-factor from Users
            rather than turning this off for everyone.
          </p>
        )}
      </Panel>

      <TwoFactorLog />
    </div>
  );
}

function Fact({ label, value, tone }) {
  const color =
    tone === "warning" ? "var(--warning-fg)" : tone === "success" ? "var(--success-fg)" : "var(--fg-primary)";
  return (
    <div>
      <p className="text-label">{label}</p>
      <p className="mt-1.5 text-[20px] leading-none font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
