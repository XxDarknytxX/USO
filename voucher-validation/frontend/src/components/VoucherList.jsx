// src/components/VoucherList.jsx
import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function VoucherList() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('active'); // 'active', 'historical', 'combined'
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  });
  const [filters, setFilters] = useState({
    status: '',
    packageName: '',
    userGroupId: '',
    archivedReason: ''
  });

  useEffect(() => {
    loadVouchers();
  }, [pagination.page, filters, view]);

  async function loadVouchers() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      });

      if (filters.status) params.append('status', filters.status);
      if (filters.packageName) params.append('packageName', filters.packageName);
      if (filters.userGroupId) params.append('userGroupId', filters.userGroupId);

      let endpoint = '/vouchers';
      
      if (view === 'historical') {
        endpoint = '/vouchers/historical';
        if (filters.archivedReason) params.append('archivedReason', filters.archivedReason);
      } else if (view === 'combined') {
        params.append('includeHistorical', 'true');
      }

      const data = await api(`${endpoint}?${params.toString()}`, { auth: true });
      setVouchers(data.vouchers || []);
      setPagination(prev => ({
        ...prev,
        total: data.total,
        totalPages: data.totalPages
      }));
    } catch (error) {
      console.error('Failed to load vouchers:', error);
    } finally {
      setLoading(false);
    }
  }

  async function restoreVoucher(uuid) {
    if (!confirm('Are you sure you want to restore this voucher to active status?')) return;
    
    try {
      await api(`/vouchers/restore/${uuid}`, { method: 'POST', auth: true });
      alert('Voucher restored successfully');
      loadVouchers();
    } catch (error) {
      alert(`Failed to restore voucher: ${error.message}`);
    }
  }

  // Ruijie Cloud status codes:
  //   '1' = Unused (not yet activated)
  //   '2' = In-use  (active / connected)
  //   '3' = Expired
  function getStatusColor(status) {
    const colors = {
      '1': 'bg-blue-100 text-blue-800',
      '2': 'bg-green-100 text-green-800',
      '0': 'bg-gray-100 text-gray-800',
      '3': 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  }

  function getStatusLabel(status) {
    const labels = {
      '1': 'Unused',
      '2': 'Active',
      '0': 'Inactive',
      '3': 'Expired'
    };
    return labels[status] || 'Unknown';
  }

  function getVoucherStateColor(state) {
    if (state === 'historical') return 'bg-amber-100 text-amber-800';
    return 'bg-blue-100 text-blue-800';
  }

  function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} mins`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} hours`;
    const days = Math.round(minutes / 1440);
    return `${days} days`;
  }

  function formatQuota(mb) {
    if (mb < 1024) return `${mb} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function formatBandwidth(kbps) {
    if (kbps < 1024) return `${kbps} Kbps`;
    return `${(kbps / 1024).toFixed(1)} Mbps`;
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  function isVoucherActive(voucher) {
    return voucher.current_clients > 0;
  }

  function hasUserInfo(voucher) {
    return voucher.first_name || voucher.last_name || voucher.email || voucher.phone;
  }

  return (
    <div className="bg-white rounded-xl border">
      <div className="p-6 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Detailed Voucher Management</h2>
          <button
            onClick={loadVouchers}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>

        {/* View Selector */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setView('active')}
            className={`px-3 py-2 text-sm rounded-lg ${
              view === 'active' ? 'bg-blue-600 text-white' : 'border hover:bg-gray-50'
            }`}
          >
            Active Vouchers
          </button>
          <button
            onClick={() => setView('historical')}
            className={`px-3 py-2 text-sm rounded-lg ${
              view === 'historical' ? 'bg-amber-600 text-white' : 'border hover:bg-gray-50'
            }`}
          >
            Historical Vouchers
          </button>
          <button
            onClick={() => setView('combined')}
            className={`px-3 py-2 text-sm rounded-lg ${
              view === 'combined' ? 'bg-purple-600 text-white' : 'border hover:bg-gray-50'
            }`}
          >
            All Vouchers
          </button>
        </div>

        {/* Enhanced Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">All Status</option>
            <option value="1">Unused</option>
            <option value="2">Active</option>
            <option value="0">Inactive</option>
            <option value="3">Expired</option>
          </select>

          <input
            type="text"
            placeholder="Filter by package name..."
            value={filters.packageName}
            onChange={(e) => setFilters(prev => ({ ...prev, packageName: e.target.value }))}
            className="px-3 py-2 border rounded-lg text-sm"
          />

          <input
            type="text"
            placeholder="Filter by user group ID..."
            value={filters.userGroupId}
            onChange={(e) => setFilters(prev => ({ ...prev, userGroupId: e.target.value }))}
            className="px-3 py-2 border rounded-lg text-sm"
          />

          {view === 'historical' && (
            <select
              value={filters.archivedReason}
              onChange={(e) => setFilters(prev => ({ ...prev, archivedReason: e.target.value }))}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">All Archive Reasons</option>
              <option value="removed_from_cloud">Removed from Cloud</option>
              <option value="manual_archive">Manual Archive</option>
              <option value="expired">Expired</option>
            </select>
          )}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-center py-8">Loading vouchers...</div>
        ) : vouchers.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm font-medium text-gray-500">
                    <th className="pb-3">Voucher Code</th>
                    <th className="pb-3">Package</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Device MAC</th>
                    <th className="pb-3">Usage</th>
                    <th className="pb-3">Data Quota</th>
                    <th className="pb-3">Clients</th>
                    <th className="pb-3">Bandwidth</th>
                    <th className="pb-3">Times</th>
                    <th className="pb-3">User Info</th>
                    <th className="pb-3">Details</th>
                    {view === 'historical' && <th className="pb-3">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((voucher) => (
                    <tr 
                      key={voucher.uuid} 
                      className={`border-t ${
                        isVoucherActive(voucher) ? 'bg-green-50' : 
                        voucher.voucher_state === 'historical' ? 'bg-amber-50' : ''
                      }`}
                    >
                      <td className="py-3">
                        <div className="font-mono text-sm font-medium">
                          {voucher.voucher_code}
                        </div>
                        <div className="text-xs text-gray-500">
                          {voucher.uuid.substring(0, 8)}...
                        </div>
                        {voucher.bind_mac === 1 && (
                          <div className="text-xs text-orange-600">🔒 MAC Bound</div>
                        )}
                        {view === 'combined' && voucher.voucher_state && (
                          <span className={`inline-block px-2 py-1 rounded-full text-xs mt-1 ${getVoucherStateColor(voucher.voucher_state)}`}>
                            {voucher.voucher_state}
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                          {voucher.package_name}
                        </span>
                        {voucher.user_group_name && voucher.user_group_name !== voucher.package_name && (
                          <div className="text-xs text-gray-500 mt-1">
                            Group: {voucher.user_group_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(voucher.status)}`}>
                          {getStatusLabel(voucher.status)}
                        </span>
                        {isVoucherActive(voucher) && (
                          <div className="text-xs text-green-600 font-medium mt-1">🟢 LIVE</div>
                        )}
                      </td>
                      <td className="py-3">
                        {voucher.claimed_mac ? (
                          <div className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded">
                            {voucher.claimed_mac}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">—</div>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="text-sm">
                          {formatDuration(voucher.time_period)} total
                        </div>
                        {voucher.used_time > 0 && (
                          <div className="text-xs text-orange-600">
                            {formatDuration(voucher.used_time)} used ({Math.round((voucher.used_time / voucher.time_period) * 100)}%)
                          </div>
                        )}
                        <div className="w-20 h-1 bg-gray-200 rounded-full mt-1">
                          <div 
                            className="h-1 bg-blue-500 rounded-full"
                            style={{ 
                              width: `${Math.min((voucher.used_time / voucher.time_period) * 100, 100)}%` 
                            }}
                          ></div>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="text-sm">{formatQuota(voucher.quota)}</div>
                        {voucher.used_quota > 0 && (
                          <>
                            <div className="text-xs text-orange-600">
                              {formatQuota(voucher.used_quota)} used ({Math.round((voucher.used_quota / voucher.quota) * 100)}%)
                            </div>
                            <div className="w-20 h-1 bg-gray-200 rounded-full mt-1">
                              <div 
                                className="h-1 bg-orange-500 rounded-full"
                                style={{ 
                                  width: `${Math.min((voucher.used_quota / voucher.quota) * 100, 100)}%` 
                                }}
                              ></div>
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="text-sm">
                          {voucher.current_clients}/{voucher.max_clients}
                        </div>
                        {voucher.current_clients > 0 && (
                          <div className="text-xs text-green-600 font-medium">
                            {voucher.current_clients} connected
                          </div>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="text-xs text-gray-600">
                          ↓ {formatBandwidth(voucher.download_rate_limit)}
                        </div>
                        <div className="text-xs text-gray-600">
                          ↑ {formatBandwidth(voucher.upload_rate_limit)}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="text-xs">
                          <div>Created: {formatDate(voucher.create_time)}</div>
                          {voucher.login_time && (
                            <div className="text-blue-600">Login: {formatDate(voucher.login_time)}</div>
                          )}
                          {voucher.expiry_time && (
                            <div className="text-orange-600">Expires: {formatDate(voucher.expiry_time)}</div>
                          )}
                          {voucher.archived_at && (
                            <div className="text-amber-600">Archived: {formatDate(voucher.archived_at)}</div>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        {hasUserInfo(voucher) ? (
                          <div className="text-xs">
                            {(voucher.first_name || voucher.last_name) && (
                              <div className="font-medium">
                                {voucher.first_name} {voucher.last_name}
                              </div>
                            )}
                            {voucher.email && <div className="text-blue-600">{voucher.email}</div>}
                            {voucher.phone && <div className="text-gray-600">{voucher.phone}</div>}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">No user info</div>
                        )}
                        {voucher.name_ref && (
                          <div className="text-xs text-gray-600 mt-1">
                            Ref: {voucher.name_ref}
                          </div>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="text-xs text-gray-500">
                          <div>Group: {voucher.user_group_id}</div>
                          {voucher.comment && (
                            <div className="mt-1 italic">{voucher.comment}</div>
                          )}
                          {voucher.disable_status === 1 && (
                            <div className="text-red-600 font-medium">Disabled</div>
                          )}
                          {voucher.archived_reason && (
                            <div className="text-amber-600 font-medium mt-1">
                              Reason: {voucher.archived_reason.replace('_', ' ')}
                            </div>
                          )}
                        </div>
                      </td>
                      {view === 'historical' && (
                        <td className="py-3">
                          <button
                            onClick={() => restoreVoucher(voucher.uuid)}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Restore
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Enhanced Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} vouchers
                {view === 'historical' && ' (archived)'}
                {view === 'combined' && ' (active + historical)'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                  className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-3 py-2 text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-gray-500">
            {view === 'active' && 'No active vouchers found. Try adjusting your filters or sync vouchers first.'}
            {view === 'historical' && 'No historical vouchers found.'}
            {view === 'combined' && 'No vouchers found. Try adjusting your filters or sync vouchers first.'}
          </div>
        )}
      </div>
    </div>
  );
}