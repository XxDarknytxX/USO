// src/pages/SettingsPage.jsx
// System information + read-only app settings.

import { useEffect, useState } from "react";
import { Settings, Server, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi } from "../services/api";
import { Button, Panel, Badge, PageHeader } from "../components/ui";

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSecrets, setShowSecrets] = useState(false);

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
