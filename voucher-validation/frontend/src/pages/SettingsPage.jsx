// src/pages/SettingsPage.jsx
import { useEffect, useState } from "react";
import { settingsApi } from "../services/api";
import toast from "react-hot-toast";
import { Settings, Server, Eye, EyeOff } from "lucide-react";

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
      // Settings table may be empty
    } finally {
      setLoading(false);
    }
  }

  // Environment info (read-only display)
  const envVars = [
    {
      label: "API Base URL",
      value: import.meta.env.VITE_API_URL || "/api",
      secret: false,
    },
    {
      label: "Frontend Port",
      value: window.location.port || "3001",
      secret: false,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-purple-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
      </div>

      {/* System info */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-800">
              System Information
            </h3>
          </div>
          <button
            onClick={() => setShowSecrets(!showSecrets)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
            {showSecrets ? "Hide" : "Show"} details
          </button>
        </div>

        <div className="p-6 space-y-3">
          {envVars.map(({ label, value, secret }) => (
            <div
              key={label}
              className="flex items-center justify-between py-2"
            >
              <span className="text-sm text-gray-600">{label}</span>
              <span className="text-sm font-mono text-gray-800">
                {secret && !showSecrets ? "***" : value}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-600">Version</span>
            <span className="text-sm font-mono text-gray-800">1.0.0</span>
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-600">Status</span>
            <span className="inline-flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Operational
            </span>
          </div>
        </div>
      </div>

      {/* App settings */}
      {settings.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800">
              Application Settings
            </h3>
          </div>
          <div className="p-6 space-y-3">
            {settings.map((s) => (
              <div
                key={s.setting_key}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    {s.setting_key}
                  </p>
                  {s.description && (
                    <p className="text-xs text-gray-400">{s.description}</p>
                  )}
                </div>
                <span className="text-sm font-mono text-gray-600">
                  {s.setting_value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
