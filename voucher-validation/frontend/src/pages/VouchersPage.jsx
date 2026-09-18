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

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Ticket,
  Sparkles,
  Trash2,
  Ban,
  Check,
  CheckCircle,
  ChevronRight,
  X,
  Phone,
  ExternalLink,
  PackageOpen,
  Wifi,
  Hourglass,
  SlidersHorizontal,
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
import { usePhone } from "../components/ui/phone";

export default function VouchersPage() {
  const { uuid: routeUuid } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const { activeSite, activeGroupId, sites, visibleSiteIds } = useSite();
  const phone = usePhone();

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
  // The sold-window a dashboard drilled in with. Held as state so the banner
  // below can show it and offer to clear it — an invisible filter that silently
  // shrinks a list is how someone concludes vouchers are missing.
  const [soldFrom, setSoldFrom] = useState(() => searchParams.get("soldFrom") || "");
  const [soldTo, setSoldTo] = useState(() => searchParams.get("soldTo") || "");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [packages, setPackages] = useState([]);
  const [stats, setStats] = useState(null);
  const [viewMode, setViewMode] = useState("active");

  // Phone only: the secondary filters fold behind one button so the list is
  // not three screens down. Desktop always shows them inline.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Selection
  const [selected, setSelected] = useState(new Set());
  // Phone only: selecting is a mode, the way it is in a mail or photos app. A
  // checkbox on every row is desktop furniture — it costs a column of chrome on
  // every card for something an operator does once a week, and it makes a
  // one-tap list into a two-target one. Desktop keeps its checkbox column.
  const [selectMode, setSelectMode] = useState(false);

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
      if (soldFrom) params.soldFrom = soldFrom;
      if (soldTo) params.soldTo = soldTo;

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
  }, [page, limit, statusFilter, packageFilter, searchQuery, phoneFilter, viewMode, scopeParams, soldFrom, soldTo]);

  useEffect(() => {
    fetchVouchers();
  }, [fetchVouchers]);

  useEffect(() => {
    if (routeUuid) setDetailUuid(routeUuid);
  }, [routeUuid]);

  // Phone: a selection only covers the rows it was made on. Once the page or
  // any filter changes, those rows are gone from the screen while the sticky
  // bar would still act on them — an invisible selection is how the wrong
  // vouchers get deleted. Drop it with the list it belonged to. Selection MODE
  // stays on, so an operator who is mid-task keeps the checkmarks and starts
  // again. Desktop keeps its cross-page selection unchanged.
  useEffect(() => {
    if (phone) setSelected(new Set());
  }, [phone, page, statusFilter, packageFilter, searchQuery, phoneFilter, viewMode, scopeParams, soldFrom, soldTo]);

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

  // The same four figures the KPI tiles carry, plus the two states that only
  // the dropdown had. On a phone they are the filter itself (see below).
  const statusChips = useMemo(
    () => [
      { value: "", label: "All", count: scopeTotals.total },
      { value: "1", label: "Unused", count: scopeTotals.unused },
      { value: "2", label: "In use", count: scopeTotals.active },
      { value: "3", label: "Expired", count: scopeTotals.expired },
      { value: "sold", label: "Sold" },
      { value: "0", label: "Inactive" },
    ],
    [scopeTotals]
  );

  // The chip row is wider than a phone screen, and a status can arrive from the
  // URL rather than from a tap (a dashboard card drilling in to ?status=0), in
  // which case the selected chip sits past the right edge and the page reads as
  // unfiltered. Same treatment the Tabs strip got: bring the active chip into
  // view, clear of the edge, whenever the filter changes. A no-op on desktop,
  // where the strip is display:none and both widths are 0.
  const chipStripRef = useRef(null);
  useLayoutEffect(() => {
    const el = chipStripRef.current;
    const btn = el?.querySelector("[data-active]");
    if (!btn || el.scrollWidth <= el.clientWidth) return;
    const EDGE = 12; // leave the chip clear of the track's edge
    const s = el.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    if (b.left < s.left + EDGE) el.scrollLeft += b.left - s.left - EDGE;
    else if (b.right > s.right - EDGE) el.scrollLeft += b.right - s.right + EDGE;
  }, [statusFilter, viewMode, statusChips]);

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
    const n = selected.size;
    setConfirm({
      // The phone's confirm sheet is the whole screen's headline, where a
      // lower-case "disable 3 voucher(s)?" reads as a bug. Desktop's wording
      // is left exactly as it was.
      title: phone
        ? `${labels[action].charAt(0).toUpperCase() + labels[action].slice(1)} ${n} voucher${n === 1 ? "" : "s"}?`
        : `${labels[action]} ${n} voucher(s)?`,
      message: `This will ${labels[action]} the selected vouchers.`,
      variant: action === "enable" ? "info" : "danger",
      confirmLabel: labels[action].charAt(0).toUpperCase() + labels[action].slice(1),
      onConfirm: async () => {
        setConfirm(null);
        try {
          // The endpoint answers 200 whatever happens and reports the outcome
          // in the body: it walks the uuids one at a time and counts them. A
          // flat "Bulk disable completed" told an operator three vouchers had
          // been disabled when the call had disabled none of them, which is
          // worse than an error — they walk away believing the estate changed.
          const res = await voucherApi.bulk(action, [...selected]);
          const done = Number(res?.processed ?? 0);
          const failed = Number(res?.failed ?? 0);
          const verb = `${labels[action]}d`; // deleted / disabled / enabled
          const noun = (n) => `${n} voucher${n === 1 ? "" : "s"}`;
          if (failed && !done) {
            toast.error(`Could not ${labels[action]} ${noun(failed)}${res?.errors?.[0] ? ` — ${res.errors[0]}` : ""}`);
          } else if (failed) {
            toast.error(`${noun(done)} ${verb}, ${failed} failed`);
          } else {
            toast.success(`${noun(done)} ${verb}`);
          }
          // Keep the selection when nothing changed, so a retry is one tap
          // rather than picking the same rows again.
          if (done) setSelected(new Set());
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
  // The filters folded behind the phone "Filters" button, counted so a
  // narrowed list never looks unexplained. Status is not among them on a phone:
  // it is on screen as the chip row.
  const foldedFilterCount = [phoneInput, packageFilter].filter(Boolean).length;
  const allOnPageSelected = vouchers.length > 0 && selected.size === vouchers.length;
  const colCount = isAdmin ? 10 : 9;

  // Leaving selection mode drops the selection with it: an invisible selection
  // that a later bulk action would act on is how the wrong vouchers get deleted.
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow={activeSite ? `Village · ${activeSite.name}` : "Inventory"}
        title="Vouchers"
        // A phone says this figure twice already — the "All 80" chip in the row
        // below and the panel's own "80 records · page 1 of 4" — so the hero
        // keeps only the button that acts on the page. Desktop is unchanged.
        subtitle={
          phone
            ? null
            : viewMode === "historical"
              ? `${total.toLocaleString()} archived vouchers`
              : `${total.toLocaleString()} voucher${total === 1 ? "" : "s"}${
                  hasFilters ? " matching the current filters" : " in scope"
                }`
        }
        icon={<Ticket size={22} />}
        tone="indigo"
        // With no sentence, the phone hero is the Generate button alone, and
        // the header's column gap still spaces it from the (empty, sr-only)
        // title block — 16px of dead card above the button. Close it on
        // phones only; desktop keeps its subtitle and its spacing.
        className="max-sm:[&>div]:gap-0"
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
          can still sell, so it sits next to the total rather than in the table.
          Phones get the same figures as the chip row in the toolbar below: four
          tiles that exist to be tapped are two rows of cards doing a filter's
          job, and they pushed the list a screen and a half down. */}
      <KpiGrid cols={4} className="max-sm:hidden">
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
      {/* A drilled-in window narrows this list to the vouchers sold in it —
          which is the point, but silently is how someone decides vouchers have
          gone missing. Say it, and offer the way out. */}
      {(soldFrom || soldTo) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--info-border,var(--border-default))] bg-[var(--bg-elevated)] px-4 py-2.5">
          <span className="text-[13px] text-[var(--fg-primary)]">
            Showing only vouchers <strong>sold</strong>
            {soldFrom ? ` from ${new Date(soldFrom).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
            {soldTo ? ` to ${new Date(new Date(soldTo).getTime() - 1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
            {packageFilter ? ` on ${packageFilter}` : ""}.
          </span>
          <Button
            variant="secondary"
            size="xs"
            className="ml-auto max-sm:w-full"
            onClick={() => { setSoldFrom(""); setSoldTo(""); setPage(1); }}
          >
            Show all vouchers
          </Button>
        </div>
      )}

      <Toolbar>
        {/* On a phone the search shares its row with the Filters button; from
            sm up the wrapper dissolves (display: contents) and both sit in the
            toolbar exactly as before — the button itself is phone-only. */}
        <div className="flex items-center gap-2 sm:contents">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, name, email…"
            width="w-64"
            className="max-sm:w-auto max-sm:flex-1 max-sm:min-w-0 max-sm:[&_input]:text-ellipsis"
          />
          <Button
            variant={foldedFilterCount ? "brand-ghost" : "secondary"}
            size="md"
            className="sm:hidden shrink-0"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            iconLeft={<SlidersHorizontal size={14} />}
          >
            {foldedFilterCount ? `Filters · ${foldedFilterCount}` : "Filters"}
          </Button>
        </div>

        {/* The phone, status and package filters fold behind that button on a
            phone, and the view switch moves above them (flex order) so the
            always-visible controls stay together. Desktop order is untouched. */}
        {/* Not a SearchInput: this one needs its own icon and a disabled state,
            because phone lookup only exists on the active list endpoint. */}
        <div className={"relative w-48 max-sm:order-2 " + (filtersOpen ? "" : "max-sm:hidden")}>
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
            className="h-9! max-sm:h-10! rounded-full! bg-[var(--bg-surface)]! pl-9 pr-8"
          />
          {phoneInput && (
            <button
              onClick={() => setPhoneInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] max-sm:right-1 max-sm:h-9 max-sm:w-9 max-sm:flex max-sm:items-center max-sm:justify-center"
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
          className="max-sm:order-1 max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
        />

        <div className="w-44 max-sm:hidden!">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Status filter"
            className="h-9! max-sm:h-10! rounded-full! bg-[var(--bg-surface)]!"
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
          <div className={"w-52 max-sm:order-2 " + (filtersOpen ? "" : "max-sm:hidden")}>
            <Select
              value={packageFilter}
              onChange={(e) => {
                setPackageFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Package filter"
              className="h-9! max-sm:h-10! rounded-full! bg-[var(--bg-surface)]!"
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
            className="ml-auto max-sm:order-3"
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

      {/* Phone: status is a row of chips carrying the stock figures, not a
          dropdown — it is this page's most-used filter and its most-read
          number, and as chips it is both at once, on one line, immediately
          above the list it narrows. The track scrolls sideways so the page
          never does; the negative margin lets it run to the screen edges
          while the first chip still lines up with the cards. */}
      <div
        ref={chipStripRef}
        className="sm:hidden -mx-3 px-3 overflow-x-auto overscroll-x-contain scrollbar-none"
        role="group"
        aria-label="Filter by status"
      >
        <div className="flex w-max items-center gap-2">
          {statusChips.map((c) => {
            const active = statusFilter === c.value;
            return (
              <button
                key={c.value || "all"}
                type="button"
                data-active={active || undefined}
                aria-pressed={active}
                onClick={() => applyStatus(c.value)}
                className={
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 " +
                  "text-[12.5px] font-semibold font-display transition-colors " +
                  (active
                    ? "border-transparent bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] active:bg-[var(--surface-pressed)]")
                }
              >
                {c.label}
                {/* The figures describe the live inventory, so they are left
                    off while the archive is on screen rather than counting
                    something the list is not showing. */}
                {c.count != null && viewMode !== "historical" && (
                  <span className={"tabular-nums text-[11.5px] font-bold " + (active ? "" : "text-[var(--fg-muted)]")}>
                    {c.count.toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
          actions={
            isAdmin ? (
              <Button
                variant={selectMode ? "brand-ghost" : "secondary"}
                size="xs"
                className="sm:hidden"
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                aria-pressed={selectMode}
              >
                {selectMode ? "Done" : "Select"}
              </Button>
            ) : null
          }
        >
          {/* Bulk bar sits inside the card, directly above the rows it acts on —
              loose above the table it read as a page-level banner. */}
          <AnimatePresence>
            {isAdmin && selected.size > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                // A phone gets its own bar pinned to the bottom of the screen
                // (below the list), since this one scrolls away with the header.
                className="overflow-hidden max-sm:hidden"
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

          {/* Phone list. Not the stacked table: ten columns folded into ten
              labelled lines is a 450px card per voucher, and twenty of those
              is nine thousand pixels of scrolling for a list you are meant to
              scan. The four things an operator reads in a village — which code,
              what state, which plan and who bought it, how much is left — on
              three lines; everything else is one tap away in the record. */}
          <div className="sm:hidden divide-y divide-[var(--border-subtle)]">
            {vouchers.map((v) => (
              <VoucherPhoneCard
                key={v.uuid}
                voucher={v}
                selectMode={isAdmin && selectMode}
                selected={selected.has(v.uuid)}
                onOpen={() => openDetail(v.uuid)}
                onToggle={() => toggleSelect(v.uuid)}
              />
            ))}
          </div>

          <DataTable className="max-sm:hidden!">
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
                    className={
                      // Tint the cells, not the row (see above).
                      "cursor-pointer " + (isSelected ? "[&>td]:bg-[var(--brand-soft)]" : "")
                    }
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

      {/* Room for the bar to hover over at the end of the list, so the page
          controls under the last card are never left behind it. Without it the
          bar is still stuck when the page bottoms out and sits on top of the
          pager. Only while there is a bar to make room for. */}
      {isAdmin && (selectMode || selected.size > 0) && vouchers.length > 0 && (
        <div aria-hidden="true" className="sm:hidden h-16 shrink-0" />
      )}

      {/* Phone bulk bar. Sticky, not fixed: it rides the bottom of the screen
          while the list scrolls, then settles into its own place below the
          pagination, so at the end of the page it covers nothing. It is the
          whole of selection mode's chrome — count, select-all, and the three
          things you can do — so the list above it stays a list. */}
      <AnimatePresence>
        {isAdmin && (selectMode || selected.size > 0) && vouchers.length > 0 && (
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="sm:hidden sticky bottom-[calc(var(--phone-nav)+0.75rem)] z-30 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-elevated)] p-3"
            role="region"
            aria-label="Bulk actions"
          >
            <div className="flex items-center justify-between gap-2 mb-2.5 pl-1">
              <span className="text-[13px] font-semibold text-[var(--fg-primary)] font-display">
                {selected.size ? `${selected.size} selected` : "Tap vouchers to select"}
              </span>
              <Button variant="ghost" size="xs" onClick={toggleAll}>
                {allOnPageSelected ? "Clear page" : `Select all ${vouchers.length}`}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!selected.size}
                onClick={() => handleBulk("enable")}
                iconLeft={<CheckCircle size={13} />}
              >
                Enable
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selected.size}
                onClick={() => handleBulk("disable")}
                iconLeft={<Ban size={13} />}
              >
                Disable
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!selected.size}
                onClick={() => handleBulk("delete")}
                iconLeft={<Trash2 size={13} />}
              >
                Delete
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

/**
 * One voucher as a phone row.
 *
 * Three lines, fixed: the code with its state, what it is and who bought it,
 * and the three consumption figures. The whole row is the tap target — in
 * selection mode it toggles instead of opening, which is why the checkmark is
 * drawn rather than a real checkbox: two targets in one row means half the taps
 * land on the wrong one.
 */
function VoucherPhoneCard({ voucher: v, selectMode, selected, onOpen, onToggle }) {
  const act = () => (selectMode ? onToggle() : onOpen());
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectMode ? selected : undefined}
      aria-label={
        selectMode ? `${selected ? "Deselect" : "Select"} ${v.voucher_code}` : `Open ${v.voucher_code}`
      }
      onClick={act}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          act();
        }
      }}
      className={
        "flex items-center gap-3 px-4 py-3 transition-colors active:bg-[var(--surface-pressed)] " +
        (selected ? "bg-[var(--brand-soft)]" : "")
      }
    >
      {selectMode && (
        <span
          aria-hidden="true"
          className={
            "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border transition-colors " +
            (selected
              ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--text-on-brand)]"
              : "border-[var(--border-strong)]")
          }
        >
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-[15px] font-semibold tracking-tight text-[var(--fg-primary)]">
            {v.voucher_code}
          </span>
          <span className="ml-auto shrink-0">
            <StatusBadge status={v.status} />
          </span>
        </span>
        {/* The payer phone has its own end of the line rather than trailing the
            package name through the same ellipsis: "Monthly Wi-Fi unlimited-
            night streaming bundle" used to eat the number entirely, and who
            bought a voucher is half of why you opened the list. Only the
            package name truncates. */}
        <span className="mt-1 flex items-baseline gap-2 text-[12.5px] text-[var(--fg-secondary)]">
          <span className="min-w-0 flex-1 truncate">{v.package_name || "No package"}</span>
          {v.payer_phone && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--fg-muted)]">
              {v.payer_phone}
            </span>
          )}
        </span>
        {/* Fixed tracks, not justify-between: with the figures spaced by their
            own widths the middle and right ones landed at a different x in
            every row, so the column could not be read down the list. The first
            two are sized to their longest value ("10/10 devices", "23h of
            365d"); data, the widest figure, takes the rest, so "1023MB of
            100.0GB" still fits on a 320px screen where equal thirds cut it. */}
        <span className="mt-1.5 grid grid-cols-[4.25rem_3.75rem_minmax(0,1fr)] gap-2 text-[11.5px] tabular-nums text-[var(--fg-muted)]">
          <span className="truncate">
            {v.current_clients ?? 0}/{v.max_clients ?? 0} devices
          </span>
          <span className="truncate">
            {formatMin(v.used_time)} of {formatMin(v.time_period)}
          </span>
          <span className="truncate">
            {formatMB(v.used_quota)} of {formatMB(v.quota)}
          </span>
        </span>
      </span>

      {!selectMode && <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--fg-subtle)]" />}
    </div>
  );
}

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
