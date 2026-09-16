// src/pages/VouchersPage.jsx
//
// The voucher inventory, rebuilt as a Salesforce list view.
//
// The old page scattered its controls: six labelled form fields sitting loose on
// the canvas, a bulk bar that appeared between them and the list, and a table
// that hand-rolled its own header and cells. Now there is one toolbar of filters
// above one table, and everything that acts on records lives with the records.
//
// Two deliberate choices:
//   • The voucher code is the record identifier, so it is set in mono beside an
//     object tile — the way Salesforce renders a record name. It used to be a red
//     chip, which made every row look like an alert.
//   • The KPI row is derived from the /stats call the page already makes for the
//     package filter, so it costs nothing, and each tile drills into the list by
//     setting the status filter.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Ticket,
  Sparkles,
  Trash2,
  Ban,
  CheckCircle,
  X,
  Phone,
  ExternalLink,
  PackageOpen,
  Wifi,
  Hourglass,
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
  SkeletonTable,
  Input,
  Select,
  PageShell,
  KpiGrid,
  StatCard,
  Toolbar,
  SearchInput,
  Segmented,
  DataTable,
  Th,
  Td,
} from "../components/ui";

export default function VouchersPage() {
  const { uuid: routeUuid } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const { activeSite, activeGroupId, sites, visibleSiteIds } = useSite();

  // Query params that scope requests to the current view: a single village
  // (groupId), the visible subset of the "All Villages" display filter
  // (groupIds), or nothing (truly all villages).
  const scopeParams = useMemo(() => {
    if (activeGroupId) return { groupId: activeGroupId };
    if (visibleSiteIds) {
      const idset = new Set(visibleSiteIds.map(String));
      const ids = sites
        .filter((s) => idset.has(String(s.id)))
        .map((s) => s.ruijieGroupId)
        .filter(Boolean);
      if (ids.length) return { groupIds: ids.join(",") };
    }
    return {};
  }, [activeGroupId, visibleSiteIds, sites]);

  const [vouchers, setVouchers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  // Prefill the status filter from the URL so a dashboard card can drill in
  // (e.g. "Vouchers sold" → /vouchers?status=sold).
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "");
  // Prefilled from the URL too, so a plan on a village dashboard can drill
  // straight in: /vouchers?package=Daily%20Pass. It lands in the visible filter
  // control rather than as a hidden query, so the operator can see why the list
  // is narrowed and widen it.
  const [packageFilter, setPackageFilter] = useState(() => searchParams.get("package") || "");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [packages, setPackages] = useState([]);
  const [stats, setStats] = useState(null);
  const [viewMode, setViewMode] = useState("active");

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Modals
  const [detailUuid, setDetailUuid] = useState(routeUuid || null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    voucherApi
      .stats(scopeParams)
      .then((data) => {
        setStats(data);
        const names = (data.packageStats || [])
          .map((p) => p.package_name)
          .filter(Boolean)
          .sort();
        setPackages(names);
      })
      .catch(() => {});
  }, [scopeParams]);

  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: String(limit), ...scopeParams };
      if (statusFilter) params.status = statusFilter;
      if (packageFilter) params.packageName = packageFilter;

      let data;
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
        data = await voucherApi.search(params);
      } else if (viewMode === "historical") {
        data = await voucherApi.historical(params);
      } else {
        if (phoneFilter) params.phone = phoneFilter; // active-list only
        data = await voucherApi.list(params);
      }

      setVouchers(data.vouchers || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("Failed to load vouchers: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, packageFilter, searchQuery, phoneFilter, viewMode, scopeParams]);

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

  // Debounced phone search — the M-PAiSA payer phone bound to the voucher.
  // Only effective on the default active list (search/historical endpoints
  // don't support it), so the input is disabled while those are active.
  // (phoneInput/phoneFilter are declared with the other filters above so
  // fetchVouchers' dep array can reference phoneFilter.)
  const phoneDisabled = !!searchInput.trim() || viewMode === "historical";
  useEffect(() => {
    const t = setTimeout(() => {
      setPhoneFilter(phoneInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [phoneInput]);

  // Map a voucher's Ruijie group_id → its site host, for the usage-page link.
  const hostByGroup = useMemo(
    () =>
      Object.fromEntries(
        (sites || []).filter((s) => s.ruijieGroupId && s.hostname).map((s) => [String(s.ruijieGroupId), s.hostname])
      ),
    [sites]
  );
  const usageUrl = (v) => {
    const host = hostByGroup[String(v.group_id)] || window.location.host;
    return `https://${host}/status/${v.voucher_code}`;
  };

  // Inventory totals for the whole scope — NOT the filtered page — rolled up
  // from the package stats the page already fetched.
  const scopeTotals = useMemo(() => {
    const rows = stats?.packageStats || [];
    const sum = (key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);
    return {
      total: Number(stats?.totalVouchers ?? sum("total")),
      unused: sum("unused"),
      active: sum("active"),
      expired: sum("expired"),
      archived: Number(stats?.totalHistorical || 0),
    };
  }, [stats]);

  // KPI tiles double as drill-downs, which is the only reason a list page earns
  // a KPI row at all.
  const applyStatus = (value) => {
    setStatusFilter((prev) => (prev === value ? "" : value));
    setPage(1);
  };

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
  const hasFilters = statusFilter || packageFilter || searchInput || phoneInput;
  const colCount = isAdmin ? 10 : 9;

  return (
    <PageShell>
      <PageHeader
        eyebrow={activeSite ? `Village · ${activeSite.name}` : "Inventory"}
        title="Vouchers"
        subtitle={
          viewMode === "historical"
            ? `${total.toLocaleString()} archived vouchers`
            : `${total.toLocaleString()} voucher${total === 1 ? "" : "s"}${
                hasFilters ? " matching the current filters" : " in scope"
              }`
        }
        icon={<Ticket size={22} />}
        tone="indigo"
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

      {/* Stock at a glance. "Unused" is the number that decides whether a village
          can still sell, so it sits next to the total rather than in the table. */}
      <KpiGrid cols={4}>
        <StatCard
          label="Vouchers in scope"
          value={scopeTotals.total.toLocaleString()}
          sub={scopeTotals.archived ? `${scopeTotals.archived.toLocaleString()} archived` : "All packages"}
          icon={<Ticket size={17} />}
          color="indigo"
          onClick={() => applyStatus("")}
        />
        <StatCard
          label="Unused stock"
          value={scopeTotals.unused.toLocaleString()}
          sub="Not yet activated"
          icon={<PackageOpen size={17} />}
          color="blue"
          onClick={() => applyStatus("1")}
        />
        <StatCard
          label="In use"
          value={scopeTotals.active.toLocaleString()}
          sub="Connected or part-used"
          icon={<Wifi size={17} />}
          color="emerald"
          onClick={() => applyStatus("2")}
        />
        <StatCard
          label="Expired"
          value={scopeTotals.expired.toLocaleString()}
          sub="Past their validity"
          icon={<Hourglass size={17} />}
          color="amber"
          onClick={() => applyStatus("3")}
        />
      </KpiGrid>

      {/* ----- Filters ----- */}
      <Toolbar>
        <SearchInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search code, name, email…"
          width="w-64"
        />

        {/* Not a SearchInput: this one needs its own icon and a disabled state,
            because phone lookup only exists on the active list endpoint. */}
        <div className="relative w-48">
          <Phone
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[var(--fg-muted)] pointer-events-none"
          />
          <Input
            type="tel"
            inputMode="tel"
            placeholder={phoneDisabled ? "Clear search to use" : "Payer phone…"}
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            disabled={phoneDisabled}
            title={
              phoneDisabled
                ? "Phone search works on the active list — clear the Search box / switch off Historical"
                : ""
            }
            className="h-9! rounded-full! bg-[var(--bg-surface)]! pl-9 pr-8"
          />
          {phoneInput && (
            <button
              onClick={() => setPhoneInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              aria-label="Clear phone filter"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <Segmented
          value={viewMode}
          onChange={(mode) => {
            setViewMode(mode);
            setPage(1);
          }}
          options={[
            { value: "active", label: "Active" },
            { value: "historical", label: "Historical" },
          ]}
        />

        <div className="w-44">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Status filter"
            className="h-9! rounded-full! bg-[var(--bg-surface)]!"
          >
            <option value="">All status</option>
            <option value="sold">Sold (not unused)</option>
            <option value="1">Unused</option>
            <option value="2">Active</option>
            <option value="3">Expired</option>
            <option value="0">Inactive</option>
          </Select>
        </div>

        {packages.length > 0 && (
          <div className="w-52">
            <Select
              value={packageFilter}
              onChange={(e) => {
                setPackageFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Package filter"
              className="h-9! rounded-full! bg-[var(--bg-surface)]!"
            >
              <option value="">All packages</option>
              {packages.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setSearchInput("");
              setPhoneInput("");
              setStatusFilter("");
              setPackageFilter("");
              setPage(1);
            }}
            iconLeft={<X size={13} />}
          >
            Clear filters
          </Button>
        )}
      </Toolbar>

      {/* ----- List ----- */}
      {loading ? (
        <SkeletonTable rows={8} cols={colCount} />
      ) : vouchers.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={Ticket}
            title="No vouchers found"
            description={
              hasFilters ? "Try adjusting filters or clearing search." : "Generate some vouchers to get started."
            }
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput("");
                    setPhoneInput("");
                    setStatusFilter("");
                    setPackageFilter("");
                    setPage(1);
                  }}
                  iconLeft={<X size={13} />}
                >
                  Clear filters
                </Button>
              ) : isAdmin ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowCreate(true)}
                  iconLeft={<Sparkles size={13} />}
                >
                  Generate vouchers
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <Panel
          title={viewMode === "historical" ? "Archived vouchers" : "Voucher records"}
          subtitle={`${total.toLocaleString()} record${total === 1 ? "" : "s"} · page ${page} of ${Math.max(
            1,
            totalPages
          )}`}
          icon={<Ticket size={15} />}
          tone="indigo"
          padding={false}
        >
          {/* Bulk bar sits inside the card, directly above the rows it acts on —
              loose above the table it read as a page-level banner. */}
          <AnimatePresence>
            {isAdmin && selected.size > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 bg-[var(--brand-soft)] border-b border-[var(--border-subtle)]">
                  <span className="text-[12.5px] font-semibold text-[var(--brand-fg-on-soft)] font-display">
                    {selected.size} selected
                  </span>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-[11.5px] font-semibold text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors font-display"
                  >
                    Clear selection
                  </button>
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

          <DataTable>
            <thead>
              <tr>
                {isAdmin && (
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      checked={vouchers.length > 0 && selected.size === vouchers.length}
                      onChange={toggleAll}
                      aria-label="Select all vouchers on this page"
                      className="accent-[var(--brand)] cursor-pointer align-middle"
                    />
                  </Th>
                )}
                <Th>Voucher</Th>
                <Th>Package</Th>
                <Th>Status</Th>
                <Th>Payer phone</Th>
                <Th align="right">Clients</Th>
                <Th align="right">Time</Th>
                <Th align="right">Data</Th>
                <Th>Created</Th>
                <Th align="right">Usage</Th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => {
                const isSelected = selected.has(v.uuid);
                // Tint the cells, not the row: .sf-table's row hover is a more
                // specific selector and would paint over a row-level selection.
                return (
                  <tr
                    key={v.uuid}
                    onClick={() => openDetail(v.uuid)}
                    className={"cursor-pointer " + (isSelected ? "[&>td]:bg-[var(--brand-soft)]" : "")}
                  >
                    {isAdmin && (
                      // A raw <td> here on purpose: the whole cell — padding
                      // included — must swallow the click, or ticking a box
                      // would also open the record. It still inherits
                      // .sf-table's cell padding.
                      <td className="w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(v.uuid)}
                          aria-label={`Select ${v.voucher_code}`}
                          className="accent-[var(--brand)] cursor-pointer align-middle"
                        />
                      </td>
                    )}
                    <Td nowrap>
                      <span className="font-mono text-[13px] font-semibold tracking-tight text-[var(--fg-primary)] truncate block">
                        {v.voucher_code}
                      </span>
                    </Td>
                    <Td>
                      <span className="block truncate max-w-[180px]">{v.package_name || "—"}</span>
                    </Td>
                    <Td>
                      <StatusBadge status={v.status} />
                    </Td>
                    <Td mono nowrap>
                      {v.payer_phone || "—"}
                    </Td>
                    <Td align="right" nowrap className="tabular-nums">
                      <span className="font-semibold text-[var(--fg-primary)]">{v.current_clients}</span>
                      <span className="text-[var(--fg-subtle)] mx-0.5">/</span>
                      <span>{v.max_clients}</span>
                    </Td>
                    <Td align="right" nowrap className="tabular-nums">
                      <span className="font-semibold text-[var(--fg-primary)]">{formatMin(v.used_time)}</span>
                      <span className="text-[var(--fg-subtle)] mx-0.5">/</span>
                      <span>{formatMin(v.time_period)}</span>
                    </Td>
                    <Td align="right" nowrap className="tabular-nums">
                      <span className="font-semibold text-[var(--fg-primary)]">{formatMB(v.used_quota)}</span>
                      <span className="text-[var(--fg-subtle)] mx-0.5">/</span>
                      <span>{formatMB(v.quota)}</span>
                    </Td>
                    <Td muted nowrap className="tabular-nums">
                      {v.create_time ? fmtShortDate(Number(v.create_time)) : "—"}
                    </Td>
                    <Td align="right" nowrap>
                      <a
                        href={usageUrl(v)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={`Open ${v.voucher_code} usage page`}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-[var(--brand)] transition-colors font-display"
                      >
                        <ExternalLink size={12} /> Usage
                      </a>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>

          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </Panel>
      )}

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
    </PageShell>
  );
}

/* ------------ Local helpers ------------------------------------------------ */

// "16 Sep 2026" — the console's date shape everywhere else. A bare
// toLocaleDateString() renders "9/16/2026", which is the one ambiguous format
// in a product used across Fiji and read by people who write dates day-first.
function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
