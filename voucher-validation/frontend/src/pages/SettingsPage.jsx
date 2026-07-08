// src/pages/SettingsPage.jsx
// System information + read-only app settings.

import { useEffect, useState } from "react";
import { Settings, Server, Eye, EyeOff, MapPin, Check, Globe2 } from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { Button, Panel, Badge, PageHeader } from "../components/ui";

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState(false);
  const { sites, isSiteVisible, toggleVisibleSite, setVisibleSiteIds, allVisible, visibleSites } = useSite();

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      setSettings(data.settings || []);
    } catch {
      // Settings table may be empty — that's fine.
    } finally {
      setLoading(false);
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
      />

      <div className="mt-6 max-w-3xl space-y-5">
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
          <div className="flex flex-col divide-y divide-[var(--border-default)]">
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

        {/* App settings */}
        {settings.length > 0 && (
          <Panel title="Application settings" padding={false}>
            <div className="flex flex-col divide-y divide-[var(--border-default)]">
              {settings.map((s) => (
                <div
                  key={s.setting_key}
                  className="flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <div>
                    <p className="text-[12.5px] font-medium text-[var(--fg-primary)]">
                      {s.setting_key}
                    </p>
                    {s.description && (
                      <p className="text-[11.5px] text-[var(--fg-muted)] mt-0.5">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <span className="text-[12.5px] font-mono text-[var(--fg-secondary)]">
                    {s.setting_value}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
