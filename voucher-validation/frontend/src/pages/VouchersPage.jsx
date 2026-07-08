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
  X,
} from "lucide-react";

import { voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import StatusBadge from "../components/shared/StatusBadge";
import Pagination from "../components/shared/Pagination";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import VoucherDetailModal from "../components/vouchers/VoucherDetailModal";
import VoucherCreateForm from "../components/vouchers/VoucherCreateForm";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Tabs,
  SkeletonTable,
  Field,
  Input,
  Select,
} from "../components/ui";

export default function VouchersPage() {
  const { uuid: routeUuid } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { activeSite, activeGroupId } = useSite();

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
      .stats(activeGroupId ? { groupId: activeGroupId } : {})
      .then((data) => {
        const names = (data.packageStats || []).map((p) => p.package_name).sort();
        setPackages(names);
      })
      .catch(() => {});
  }, [activeGroupId]);

  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit) };
      if (activeGroupId) params.groupId = activeGroupId;
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
  }, [page, limit, statusFilter, packageFilter, searchQuery, viewMode, activeGroupId]);

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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* ----- Header ----- */}
      <PageHeader
        eyebrow={activeSite ? `Site · ${activeSite.name}` : "Inventory"}
        title="Vouchers"
        subtitle={`${total.toLocaleString()} total${
          viewMode === "historical" ? " · viewing archived" : ""
        }`}
        icon={<Ticket size={20} />}
        actions={
          isAdmin && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowCreate(true)}
              iconLeft={<Sparkles size={14} />}
            >
              Generate
            </Button>
          )
        }
      />

      {/* ----- Filter bar ----- */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_auto_1fr_1fr_auto] lg:items-end">
        {/* Search */}
        <Field label="Search">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none z-10"
            />
            <Input
              type="text"
              placeholder="Search code, name, email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] z-10"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </Field>

        {/* View mode tabs */}
        <Field label="View">
          <Tabs
            variant="pills"
            value={viewMode}
            onChange={(mode) => {
              setViewMode(mode);
              setPage(1);
            }}
            tabs={[
              { value: "active", label: "Active" },
              { value: "historical", label: "Historical" },
            ]}
          />
        </Field>

        {/* Status filter */}
        <Field label="Status">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All status</option>
            <option value="1">Unused</option>
            <option value="2">Active</option>
            <option value="3">Expired</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>

        {packages.length > 0 && (
          <Field label="Package">
            <Select
              value={packageFilter}
              onChange={(e) => {
                setPackageFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All packages</option>
              {packages.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setStatusFilter("");
              setPackageFilter("");
              setPage(1);
            }}
            iconLeft={<X size={13} />}
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
            className="overflow-hidden"
          >
            <div className="mt-4 flex items-center gap-3 rounded-xl px-4 py-2.5 bg-[var(--accent)]/10 border border-[var(--accent)]/20">
              <span className="text-[13px] font-semibold text-[var(--accent)]">
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
      <div className="mt-4">
        {loading ? (
          <SkeletonTable rows={8} cols={isAdmin ? 8 : 7} />
        ) : vouchers.length === 0 ? (
          <Panel padding>
            <EmptyState
              icon={Ticket}
              title="No vouchers found"
              description={
                hasFilters
                  ? "Try adjusting filters or clearing search."
                  : "Generate some vouchers to get started."
              }
            />
          </Panel>
        ) : (
          <Panel padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left border-b border-[var(--border-default)]">
                    {isAdmin && (
                      <th className="pl-4 pr-2 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={vouchers.length > 0 && selected.size === vouchers.length}
                          onChange={toggleAll}
                          className="accent-[var(--accent)] cursor-pointer"
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
                <tbody className="divide-y divide-[var(--border-default)]">
                  {vouchers.map((v) => {
                    const isSelected = selected.has(v.uuid);
                    return (
                      <tr
                        key={v.uuid}
                        onClick={() => openDetail(v.uuid)}
                        className={
                          "cursor-pointer transition-colors " +
                          (isSelected
                            ? "bg-[var(--accent)]/10"
                            : "hover:bg-[var(--bg-surface)]")
                        }
                      >
                        {isAdmin && (
                          <td
                            className="pl-4 pr-2 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(v.uuid)}
                              className="accent-[var(--accent)] cursor-pointer"
                            />
                          </td>
                        )}
                        <Td>
                          <span
                            className={
                              "inline-flex items-center px-1.5 py-0.5 rounded font-mono " +
                              "text-[12.5px] font-medium " +
                              "bg-[var(--accent)]/10 text-[var(--accent)]"
                            }
                          >
                            {v.voucher_code}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-[var(--fg-secondary)] truncate max-w-[160px] block">
                            {v.package_name || "—"}
                          </span>
                        </Td>
                        <Td>
                          <StatusBadge status={v.status} />
                        </Td>
                        <Td mono>
                          <span className="text-[var(--fg-primary)] font-medium">
                            {v.current_clients}
                          </span>
                          <span className="text-[var(--fg-muted)] mx-0.5">/</span>
                          <span className="text-[var(--fg-secondary)]">{v.max_clients}</span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--fg-primary)] font-medium">
                            {formatMin(v.used_time)}
                          </span>
                          <span className="text-[var(--fg-muted)] mx-0.5">/</span>
                          <span className="text-[var(--fg-secondary)]">
                            {formatMin(v.time_period)}
                          </span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--fg-primary)] font-medium">
                            {formatMB(v.used_quota)}
                          </span>
                          <span className="text-[var(--fg-muted)] mx-0.5">/</span>
                          <span className="text-[var(--fg-secondary)]">
                            {formatMB(v.quota)}
                          </span>
                        </Td>
                        <Td mono>
                          <span className="text-[var(--fg-secondary)]">
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

            <div className="border-t border-[var(--border-default)]">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPageChange={setPage}
              />
            </div>
          </Panel>
        )}
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
          groupId={activeGroupId}
          siteName={activeSite?.name}
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
  return <th className="text-label px-3 py-3 whitespace-nowrap">{children}</th>;
}

function Td({ children, mono = false }) {
  return (
    <td className={`px-3 py-3 align-middle ${mono ? "font-mono text-[12.5px]" : ""}`}>
      {children}
    </td>
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
