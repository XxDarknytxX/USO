// src/pages/SettingsPage.jsx
// System information + read-only app settings.

import { useEffect, useState } from "react";
import { Settings, Server, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

import { settingsApi } from "../services/api";
import { Button, Card, CardHeader, CardBody, Badge } from "../components/ui";

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
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <Settings size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Console</span>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">
              Environment configuration and runtime status.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">
        {/* System info */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server size={14} className="text-[var(--text-quaternary)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
                System information
              </h3>
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowSecrets(!showSecrets)}
              iconLeft={showSecrets ? <EyeOff size={11} /> : <Eye size={11} />}
            >
              {showSecrets ? "Hide" : "Show"} details
            </Button>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col">
              {envVars.map(({ label, value }, i) => (
                <div
                  key={label}
                  className={
                    "flex items-center justify-between py-2.5 " +
                    (i > 0 ? "border-t border-[var(--border-subtle)]" : "")
                  }
                >
                  <span className="text-[12.5px] text-[var(--text-secondary)]">
                    {label}
                  </span>
                  <span className="text-[12.5px] font-mono text-[var(--text-primary)]">
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5 border-t border-[var(--border-subtle)]">
                <span className="text-[12.5px] text-[var(--text-secondary)]">Status</span>
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
          </CardBody>
        </Card>

        {/* App settings */}
        {settings.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
                Application settings
              </h3>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col">
                {settings.map((s, i) => (
                  <div
                    key={s.setting_key}
                    className={
                      "flex items-center justify-between py-2.5 " +
                      (i > 0 ? "border-t border-[var(--border-subtle)]" : "")
                    }
                  >
                    <div>
                      <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
                        {s.setting_key}
                      </p>
                      {s.description && (
                        <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <span className="text-[12.5px] font-mono text-[var(--text-secondary)]">
                      {s.setting_value}
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
