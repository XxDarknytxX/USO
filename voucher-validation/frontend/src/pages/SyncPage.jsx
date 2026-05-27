// src/pages/SyncPage.jsx
import { useEffect, useState } from "react";
import { voucherApi } from "../services/api";
import toast from "react-hot-toast";
import {
  RefreshCw,
  Wifi,
  CheckCircle,
  XCircle,
  Clock,
  ArrowDownCircle,
} from "lucide-react";

export default function SyncPage() {
  const [syncing, setSyncing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await voucherApi.syncLogs();
      setSyncLogs(data.logs || []);
    } catch (err) {
      toast.error("Failed to load sync logs");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await voucherApi.sync();
      toast.success(
        `Sync completed! ${result.totalProcessed} processed (${result.newVouchers} new, ${result.updatedVouchers} updated, ${result.archivedVouchers || 0} archived)`
      );
      loadLogs();
    } catch (err) {
      toast.error("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function testConnection() {
    try {
      const result = await voucherApi.testConnection();
      setConnectionStatus(result);
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error("Connection failed");
      }
    } catch (err) {
      setConnectionStatus({ success: false, error: err.message });
      toast.error("Connection test failed");
    }
  }

  function formatDate(dateLike) {
    if (!dateLike) return "—";
    const d = new Date(dateLike);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  const lastSync = syncLogs[0];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">
            Sync Management
          </h1>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Sync card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <ArrowDownCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Sync Vouchers
              </h3>
              <p className="text-xs text-gray-500">
                Pull latest from Ruijie Cloud
              </p>
            </div>
          </div>
          {lastSync && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
              <p>
                Last sync: {formatDate(lastSync.sync_started_at)}
              </p>
              <p>
                {lastSync.total_processed} processed, {lastSync.total_new} new,{" "}
                {lastSync.total_updated} updated
              </p>
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium text-sm transition-all shadow-sm flex items-center justify-center gap-2 hover:shadow-md disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {/* Connection test card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Wifi className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                API Connection
              </h3>
              <p className="text-xs text-gray-500">
                Test Ruijie Cloud API connectivity
              </p>
            </div>
          </div>
          {connectionStatus && (
            <div
              className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${
                connectionStatus.success
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {connectionStatus.success ? (
                <CheckCircle size={14} />
              ) : (
                <XCircle size={14} />
              )}
              <span>
                {connectionStatus.success
                  ? "Connected successfully"
                  : connectionStatus.error || "Connection failed"}
              </span>
            </div>
          )}
          <button
            onClick={testConnection}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium text-sm transition-all hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            <Wifi className="w-4 h-4" />
            Test Connection
          </button>
        </div>
      </div>

      {/* Sync log table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">Sync History</h3>
          <Clock size={16} className="text-gray-400" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : syncLogs.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No sync history yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Fetched</th>
                  <th className="px-6 py-3">Processed</th>
                  <th className="px-6 py-3">New</th>
                  <th className="px-6 py-3">Updated</th>
                  <th className="px-6 py-3">Archived</th>
                  <th className="px-6 py-3">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {syncLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-700">
                      {formatDate(log.sync_started_at)}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.status === "completed"
                            ? "bg-green-50 text-green-700"
                            : log.status === "failed"
                            ? "bg-red-50 text-red-700"
                            : "bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {log.total_fetched}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {log.total_processed}
                    </td>
                    <td className="px-6 py-3 text-green-600 font-medium">
                      {log.total_new}
                    </td>
                    <td className="px-6 py-3 text-blue-600 font-medium">
                      {log.total_updated}
                    </td>
                    <td className="px-6 py-3 text-orange-600 font-medium">
                      {log.total_archived || 0}
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {log.user_email || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
