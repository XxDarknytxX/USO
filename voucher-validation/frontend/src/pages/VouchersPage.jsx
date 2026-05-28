// src/pages/VouchersPage.jsx
// The main inventory page. Dense table, filter rail, bulk actions, drawer modals.

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
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

import { voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import StatusBadge from "../components/shared/StatusBadge";
import Pagination from "../components/shared/Pagination";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import VoucherDetailModal from "../components/vouchers/VoucherDetailModal";
import VoucherCreateForm from "../components/vouchers/VoucherCreateForm";
import { Button, Badge, EmptyState } from "../components/ui";

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
    if (selected.size === vouchers.length) setSelected(new Set());
    else setSelected(new Set(vouchers.map((v) => v.uuid)));
  };

  const handleBulk = (action) => {
    const labels = { delete: "delete", disable: "disable", enable: "enable" };
    setConfirm({
      title: `${labels[action]} ${selected.size} voucher(s)?`,
      message: `This will ${labels[action]} the selected vouchers.`,
      variant: action === "enable" ? "info" : "danger",
      confirmLabel: labels[action].charAt(0).toUpperCase() + labels[action].slice(1),
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
    <div className="page-shell">
      {/* ----- Header ----- */}
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <Ticket size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Inventory</span>
            <h1 className="page-title">Vouchers</h1>
            <p className="page-subtitle">
              {total.toLocaleString()} total
              {viewMode === "historical" && " · viewing archived"}
            </p>
          </div>
        </div>

        {isAdmin && (
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowCreate(true)}
            iconLeft={<Sparkles size={14} />}
          >
            Generate
          </Button>
        )}
      </div>

      {/* ----- Toolbar ----- */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-8 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search code, name, email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={
              "w-full pl-8 pr-8 h-8 text-[13px] rounded-md " +
              "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
              "text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] " +
              "hover:border-[var(--input-border-hover)] focus-input"
            }
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* View mode tabs */}
        <div
          className={
            "inline-flex items-center rounded-md p-0.5 " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)]"
          }
        >
          {["active", "historical"].map((mode) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode);
                  setPage(1);
                }}
                className={
                  "h-7 px-2.5 text-[12px] font-medium rounded capitalize transition-colors " +
                  (active
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
                }
              >
                {mode}
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <ToolbarSelect
          icon={<Filter size={12} />}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <option value="">All status</option>
          <option value="1">Unused</option>
          <option value="2">Active</option>
          <option value="3">Expired</option>
          <option value="0">Inactive</option>
        </ToolbarSelect>

        {packages.length > 0 && (
          <ToolbarSelect
            value={packageFilter}
            onChange={(v) => {
              setPackageFilter(v);
              setPage(1);
            }}
          >
            <option value="">All packages</option>
            {packages.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </ToolbarSelect>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setSearchInput("");
              setStatusFilter("");
              setPackageFilter("");
              setPage(1);
            }}
            iconLeft={<X size={11} />}
          >
            Clear
          </Button>
        )}
      </div>

      {/* ----- Bulk action bar ----- */}
      <AnimatePresence>
        {isAdmin && selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div
              className={
                "flex items-center gap-3 px-8 py-2 " +
                "bg-[var(--brand-soft)] border-b border-[var(--brand-soft-hover)]"
              }
            >
              <span className="text-[12.5px] font-semibold text-[var(--brand-fg-on-soft)]">
                {selected.size} selected
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => handleBulk("enable")}
                  iconLeft={<CheckCircle size={12} />}
                >
                  Enable
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => handleBulk("disable")}
                  iconLeft={<Ban size={12} />}
                >
                  Disable
                </Button>
                <Button
                  variant="danger"
                  size="xs"
                  onClick={() => handleBulk("delete")}
                  iconLeft={<Trash2 size={12} />}
                >
                  Delete
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----- Table ----- */}
      <div className="flex-1 min-h-0 px-8 py-4">
        <div
          className={
            "h-full flex flex-col rounded-md " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "shadow-[var(--elev-1)] overflow-hidden"
          }
        >
          {loading ? (
            <LoadingTable cols={isAdmin ? 8 : 7} />
          ) : vouchers.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No vouchers found"
              description={
                hasFilters
                  ? "Try adjusting filters or clearing search."
                  : "Generate some vouchers to get started."
              }
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr
                    className={
                      "bg-[var(--surface-sunken)] text-left " +
                      "text-[10.5px] font-mono uppercase tracking-[0.1em] text-[var(--text-quaternary)]"
                    }
                  >
                    {isAdmin && (
                      <th className="pl-4 pr-2 py-2.5 w-10">
                        <input
                          type="checkbox"
                          checked={vouchers.length > 0 && selected.size === vouchers.length}
                          onChange={toggleAll}
                          className="accent-[var(--brand)] cursor-pointer"
                        />
                      </th>
                    )}
                    <Th>Code</Th>
                    <Th>Package</Th>
                    <Th>Status</Th>
                    <Th>Clients</Th>
                    <Th>Time</Th>
                    <Th>Data</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => {
                    const isSelected = selected.has(v.uuid);
                    return (
                      <tr
                        key={v.uuid}
                        onClick={() => openDetail(v.uuid)}
                        className={
                          "cursor-pointer border-t border-[var(--border-subtle)] transition-colors " +
                          (isSelected
                            ? "bg-[var(--brand-soft)]"
                            : "hover:bg-[var(--surface-hover)]")
                        }
                      >
                        {isAdmin && (
                          <td
                            className="pl-4 pr-2 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(v.uuid)}
                              className="accent-[var(--brand)] cursor-pointer"
                            />
                          </td>
                        )}
                        <Td>
                          <span
                            className={
                              "inline-flex items-center px-1.5 py-0.5 rounded font-mono " +
                              "text-[12.5px] font-medium " +
                              "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                            }
                          >
                            {v.voucher_code}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-[var(--text-secondary)] truncate max-w-[160px] block">
                            {v.package_name || "—"}
                          </span>
                        </Td>
                        <Td>
                          <StatusBadge status={v.status} />
                        </Td>
                        <Td mono>
                          <span className="text-[var(--text-primary)] font-medium">
                            {v.current_clients}
                          </span>
                          <span className="text-[var(--text-quaternary)] mx-0.5">/</span>
                          <span className="text-[var(--text-tertiary)]">{v.max_clients}</span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--text-primary)] font-medium">
                            {formatMin(v.used_time)}
                          </span>
                          <span className="text-[var(--text-quaternary)] mx-0.5">/</span>
                          <span className="text-[var(--text-tertiary)]">
                            {formatMin(v.time_period)}
                          </span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--text-primary)] font-medium">
                            {formatMB(v.used_quota)}
                          </span>
                          <span className="text-[var(--text-quaternary)] mx-0.5">/</span>
                          <span className="text-[var(--text-tertiary)]">
                            {formatMB(v.quota)}
                          </span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--text-tertiary)]">
                            {v.create_time
                              ? new Date(Number(v.create_time)).toLocaleDateString()
                              : "—"}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && vouchers.length > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>

      {/* ----- Modals ----- */}
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

      {showCreate && (
        <VoucherCreateForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchVouchers();
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          variant={confirm.variant}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ------------ Local helpers ------------------------------------------------ */

function Th({ children }) {
  return <th className="px-3 py-2.5 font-mono font-medium">{children}</th>;
}

function Td({ children, mono = false }) {
  return (
    <td className={`px-3 py-2.5 align-middle ${mono ? "font-mono text-[12.5px]" : ""}`}>
      {children}
    </td>
  );
}

function ToolbarSelect({ icon, value, onChange, children }) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none">
          {icon}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "h-8 pr-7 text-[12.5px] font-medium rounded-md appearance-none cursor-pointer " +
          (icon ? "pl-7 " : "pl-2.5 ") +
          "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
          "text-[var(--text-secondary)] hover:border-[var(--input-border-hover)] focus-input"
        }
      >
        {children}
      </select>
      <ChevronDown
        size={11}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
      />
    </div>
  );
}

function LoadingTable({ cols }) {
  return (
    <div className="flex-1 p-4 space-y-2">
      <div className="h-7 rounded skeleton" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-9 rounded skeleton" />
      ))}
    </div>
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
