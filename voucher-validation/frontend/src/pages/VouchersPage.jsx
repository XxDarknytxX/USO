// src/pages/VouchersPage.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import StatusBadge from "../components/shared/StatusBadge";
import Pagination from "../components/shared/Pagination";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import VoucherDetailModal from "../components/vouchers/VoucherDetailModal";
import VoucherCreateForm from "../components/vouchers/VoucherCreateForm";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  Sparkles,
  Trash2,
  Ban,
  CheckCircle,
  Ticket,
  Filter,
  ChevronDown,
  X,
} from "lucide-react";

export default function VouchersPage() {
  const { uuid: routeUuid } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [vouchers, setVouchers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [packageFilter, setPackageFilter] = useState("");
  const [packages, setPackages] = useState([]);
  const [viewMode, setViewMode] = useState("active");

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Modals
  const [detailUuid, setDetailUuid] = useState(routeUuid || null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    voucherApi
      .stats()
      .then((data) => {
        const names = (data.packageStats || []).map((p) => p.package_name).sort();
        setPackages(names);
      })
      .catch(() => {});
  }, []);

  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (statusFilter) params.status = statusFilter;
      if (packageFilter) params.packageName = packageFilter;

      let data;
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
        data = await voucherApi.search(params);
      } else if (viewMode === "historical") {
        data = await voucherApi.historical(params);
      } else {
        data = await voucherApi.list(params);
      }

      setVouchers(data.vouchers || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("Failed to load vouchers: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, packageFilter, searchQuery, viewMode]);

  useEffect(() => {
    fetchVouchers();
  }, [fetchVouchers]);

  useEffect(() => {
    if (routeUuid) setDetailUuid(routeUuid);
  }, [routeUuid]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const toggleSelect = (uuid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === vouchers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(vouchers.map((v) => v.uuid)));
    }
  };

  const handleBulk = (action) => {
    const labels = { delete: "delete", disable: "disable", enable: "enable" };
    setConfirm({
      title: `${labels[action]} ${selected.size} voucher(s)?`,
      message: `This will ${labels[action]} the selected vouchers.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await voucherApi.bulk(action, [...selected]);
          toast.success(`Bulk ${labels[action]} completed`);
          setSelected(new Set());
          fetchVouchers();
        } catch (err) {
          toast.error(err.message);
        }
      },
    });
  };

  const openDetail = (uuid) => {
    setDetailUuid(uuid);
    navigate(`/vouchers/${uuid}`, { replace: true });
  };

  const closeDetail = () => {
    setDetailUuid(null);
    navigate("/vouchers", { replace: true });
  };

  const totalPages = Math.ceil(total / limit);
  const hasFilters = statusFilter || packageFilter || searchInput;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <Ticket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vouchers</h1>
              <p className="text-xs text-gray-400 font-medium mt-0.5">
                {total} total vouchers
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 active:scale-[0.97]"
            >
              <Sparkles size={16} />
              Generate
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 mt-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300"
            />
            <input
              type="text"
              placeholder="Search by code, name, email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-gray-50/80 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent focus:bg-white transition-all placeholder:text-gray-300"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100/80 rounded-xl p-1">
            {["active", "historical"].map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all ${
                  viewMode === mode
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="relative">
            <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="appearance-none pl-8 pr-8 py-2.5 bg-gray-50/80 border border-gray-100 rounded-xl text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
            >
              <option value="">All Status</option>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
              <option value="2">Expired</option>
              <option value="3">Disabled</option>
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
          </div>

          {/* Package filter */}
          {packages.length > 0 && (
            <div className="relative">
              <select
                value={packageFilter}
                onChange={(e) => {
                  setPackageFilter(e.target.value);
                  setPage(1);
                }}
                className="appearance-none pl-3.5 pr-8 py-2.5 bg-gray-50/80 border border-gray-100 rounded-xl text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
              >
                <option value="">All Packages</option>
                {packages.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
            </div>
          )}

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={() => {
                setSearchInput("");
                setStatusFilter("");
                setPackageFilter("");
                setPage(1);
              }}
              className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar (admin only) */}
      <AnimatePresence>
        {isAdmin && selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden px-6"
          >
            <div className="flex items-center gap-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl px-4 py-2.5 mb-3">
              <span className="text-sm font-semibold text-purple-700">
                {selected.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <BulkBtn onClick={() => handleBulk("enable")} icon={<CheckCircle size={13} />} label="Enable" color="green" />
                <BulkBtn onClick={() => handleBulk("disable")} icon={<Ban size={13} />} label="Disable" color="orange" />
                <BulkBtn onClick={() => handleBulk("delete")} icon={<Trash2 size={13} />} label="Delete" color="red" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm h-full flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-9 h-9 border-[3px] border-purple-100 border-t-purple-500 rounded-full animate-spin" />
            </div>
          ) : vouchers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
              <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                <Ticket size={28} className="text-gray-200" />
              </div>
              <p className="text-sm font-medium text-gray-400">No vouchers found</p>
              <p className="text-xs text-gray-300 mt-1">
                {hasFilters ? "Try adjusting your filters" : "Generate some vouchers to get started"}
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50/90 backdrop-blur-sm text-left text-[11px] text-gray-400 uppercase tracking-wider font-semibold">
                    {isAdmin && (
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={vouchers.length > 0 && selected.size === vouchers.length}
                          onChange={toggleAll}
                          className="rounded-md border-gray-200 text-purple-500 focus:ring-purple-400"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Clients</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {vouchers.map((v) => (
                    <tr
                      key={v.uuid}
                      className={`transition-colors cursor-pointer ${
                        selected.has(v.uuid)
                          ? "bg-purple-50/50"
                          : "hover:bg-gray-50/60"
                      }`}
                      onClick={() => openDetail(v.uuid)}
                    >
                      {isAdmin && (
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(v.uuid)}
                            onChange={() => toggleSelect(v.uuid)}
                            className="rounded-md border-gray-200 text-purple-500 focus:ring-purple-400"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[13px] font-semibold text-purple-600 bg-purple-50/60 px-2 py-0.5 rounded-md">
                          {v.voucher_code}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-600 text-xs font-medium truncate max-w-[140px]">
                        {v.package_name}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">
                        <span className="font-semibold text-gray-700">{v.current_clients}</span>
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span>{v.max_clients}</span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">
                        <span className="font-semibold text-gray-700">{formatMin(v.used_time)}</span>
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span>{formatMin(v.time_period)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">
                        <span className="font-semibold text-gray-700">{formatMB(v.used_quota)}</span>
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span>{formatMB(v.quota)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-400 text-xs">
                        {v.create_time
                          ? new Date(Number(v.create_time)).toLocaleDateString()
                          : "---"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && vouchers.length > 0 && (
            <div className="shrink-0 border-t border-gray-50">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {detailUuid && (
          <VoucherDetailModal
            uuid={detailUuid}
            onClose={closeDetail}
            onRefresh={fetchVouchers}
            readOnly={!isAdmin}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreate && (
          <VoucherCreateForm
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              fetchVouchers();
            }}
          />
        )}
      </AnimatePresence>

      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function BulkBtn({ onClick, icon, label, color }) {
  const styles = {
    green: "text-green-700 bg-green-50 hover:bg-green-100",
    orange: "text-orange-700 bg-orange-50 hover:bg-orange-100",
    red: "text-red-700 bg-red-50 hover:bg-red-100",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all active:scale-95 ${styles[color]}`}
    >
      {icon} {label}
    </button>
  );
}

function formatMin(m) {
  const val = Number(m || 0);
  if (val < 60) return `${val}m`;
  if (val < 1440) return `${Math.round(val / 60)}h`;
  return `${Math.round(val / 1440)}d`;
}

function formatMB(mb) {
  const val = Number(mb || 0);
  if (val < 1024) return `${val}MB`;
  return `${(val / 1024).toFixed(1)}GB`;
}
