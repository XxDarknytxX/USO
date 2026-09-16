// src/pages/PortalConfigPage.jsx
//
// Portal plans — the catalogue the captive portal sells from. A plan is two
// things at once: a price card a villager reads on their phone, and a mapping
// onto a Ruijie user group that vouchers are claimed from. The page is laid out
// so those two jobs stay visibly separate.
//
// Rebuilt on the Lightning primitives: one list instead of a wall of cards,
// filters in a Toolbar, and — the piece that mattered most — a create/edit form
// with room to think in. The old modal packed fifteen fields into a three- and
// four-column grid with no grouping, so nothing told you which fields a customer
// sees and which ones talk to Ruijie. It is now grouped sections with a label
// rail carrying that explanation.

import { useEffect, useMemo, useState, useCallback } from "react";
import { portalConfigApi, voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
import toast from "react-hot-toast";
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Star,
  Layers,
  Tag,
  Ticket,
  MapPin,
  Sparkles,
} from "lucide-react";

import {
  Button,
  IconButton,
  Modal,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  TagInput,
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PageShell,
  KpiGrid,
  StatCard,
  Toolbar,
  SearchInput,
  StatusPill,
  DataTable,
  Th,
  Td,
  TableMessage,
  RecordCell,
} from "../components/ui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CATEGORIES = ["daily", "weekly", "monthly", "custom"];

const CATEGORY_TONES = {
  daily: "info",
  weekly: "warning",
  monthly: "success",
  custom: "brand",
};

// Object-tile colour per category, so a long list is scannable by hue alone —
// the one place colour is allowed to live on this page.
const CATEGORY_TILES = {
  daily: "blue",
  weekly: "orange",
  monthly: "green",
  custom: "violet",
};

// Toolbar controls are 36px pills. The Field primitives default to 40px and a
// small radius; inline is the one override Tailwind's class ordering cannot
// undo, so the filter strip stays a single height.
const PILL = { height: 36, borderRadius: 999 };

const ICON_OPTIONS = [
  { value: "fa-wifi", label: "WiFi" },
  { value: "fa-bolt", label: "Bolt" },
  { value: "fa-rocket", label: "Rocket" },
  { value: "fa-star", label: "Star" },
  { value: "fa-crown", label: "Crown" },
  { value: "fa-gem", label: "Gem" },
  { value: "fa-fire", label: "Fire" },
  { value: "fa-globe", label: "Globe" },
  { value: "fa-signal", label: "Signal" },
  { value: "fa-gauge-high", label: "Gauge High" },
  { value: "fa-cloud", label: "Cloud" },
  { value: "fa-shield", label: "Shield" },
  { value: "fa-zap", label: "Zap" },
  { value: "fa-database", label: "Database" },
  { value: "fa-server", label: "Server" },
];

const EMPTY_FORM = {
  planKey: "",
  name: "",
  category: "daily",
  price: 0,
  currency: "FJD",
  dataAllowance: "",
  icon: "fa-wifi",
  popular: false,
  description: "",
  features: [],
  sortOrder: 0,
  isActive: true,
  userGroup: "",
  userGroupName: "",
};

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------
export default function PortalConfigPage() {
  const { isAdmin } = useAuth();
  const { activeGroupId, visibleSiteIds, sites, activeSite, isGlobal } = useSite();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userGroups, setUserGroups] = useState([]);

  const [categoryFilter, setCategoryFilter] = useState("");
  const [query, setQuery] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (categoryFilter) params.category = categoryFilter;
      if (activeGroupId) {
        // A single village is selected → just that village.
        params.groupId = activeGroupId;
      } else if (visibleSiteIds) {
        // "All Villages" with some villages hidden by the display filter → show
        // only the visible ones (map project ids → their Ruijie group ids).
        const idset = new Set(visibleSiteIds.map(String));
        const ids = sites
          .filter((s) => idset.has(String(s.id)))
          .map((s) => s.ruijieGroupId)
          .filter(Boolean);
        if (ids.length) params.groupIds = ids.join(",");
      }
      const data = await portalConfigApi.list(params);
      setPlans(data.plans || []);
    } catch (err) {
      toast.error("Failed to load plans: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, activeGroupId, visibleSiteIds, sites]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    const params = activeGroupId ? { groupId: activeGroupId } : {};
    voucherApi
      .userGroups(params)
      .then((data) => setUserGroups(data.userGroups || []))
      .catch(() => {});
  }, [activeGroupId]);

  const handleCreate = () => {
    setEditingPlan(null);
    setShowModal(true);
  };

  const handleEdit = (plan) => {
    setEditingPlan(plan);
    setShowModal(true);
  };

  const handleDelete = (plan) => {
    setConfirm({
      plan,
      title: `Delete "${plan.name}"?`,
      message:
        "This will permanently remove this plan configuration. This action cannot be undone.",
      onConfirm: async () => {
        setConfirm(null);
        try {
          await portalConfigApi.remove(plan._id || plan.id);
          toast.success("Plan deleted");
          fetchPlans();
        } catch (err) {
          toast.error("Delete failed: " + err.message);
        }
      },
    });
  };

  const handleToggleActive = async (plan) => {
    try {
      await portalConfigApi.update(plan._id || plan.id, {
        ...plan,
        isActive: !plan.isActive,
      });
      toast.success(`Plan ${!plan.isActive ? "activated" : "deactivated"}`);
      fetchPlans();
    } catch (err) {
      toast.error("Toggle failed: " + err.message);
    }
  };

  const handleSave = async (formData) => {
    try {
      if (editingPlan) {
        await portalConfigApi.update(
          editingPlan._id || editingPlan.id,
          formData
        );
        toast.success("Plan updated");
      } else {
        await portalConfigApi.create({ ...formData, groupId: activeGroupId });
        toast.success("Plan created");
      }
      setShowModal(false);
      fetchPlans();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Category is a server-side filter (it changes what we fetch); the search box
  // is local, because the list is small enough that a round-trip per keystroke
  // would be the slower answer.
  const visiblePlans = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return plans;
    return plans.filter((p) =>
      [p.planKey, p.name, p.category, p.userGroupName, p.userGroup, p.dataAllowance]
        .some((v) => String(v || "").toLowerCase().includes(needle))
    );
  }, [plans, query]);

  const stats = useMemo(() => {
    const active = plans.filter((p) => p.isActive).length;
    const featured = plans.filter((p) => p.popular).length;
    const withStock = plans.filter((p) => p.availableVouchers != null);
    return {
      active,
      featured,
      stock: withStock.length
        ? withStock.reduce((n, p) => n + Number(p.availableVouchers || 0), 0)
        : null,
    };
  }, [plans]);

  const hasFilters = !!categoryFilter || !!query.trim();
  const scopeLabel = isGlobal ? "All villages" : activeSite?.name || "the selected village";
  const colSpan = isAdmin ? 7 : 6;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Portal"
        title="Portal Plans"
        subtitle="What the captive portal offers, and the Ruijie user group each offer draws its vouchers from."
        icon={<Globe size={22} />}
        tone="violet"
        actions={
          isAdmin && (
            <Button variant="primary" size="md" iconLeft={<Plus size={14} />} onClick={handleCreate}>
              New plan
            </Button>
          )
        }
      />

      <KpiGrid>
        <StatCard
          label="Plans configured"
          value={plans.length}
          sub={categoryFilter ? `${categoryFilter} only` : "all categories"}
          icon={<Layers size={18} />}
          color="violet"
        />
        <StatCard
          label="Live on the portal"
          value={stats.active}
          sub={`${plans.length - stats.active} hidden from customers`}
          icon={<Globe size={18} />}
          color="green"
        />
        <StatCard
          label="Featured"
          value={stats.featured}
          sub="carry the popular star"
          icon={<Star size={18} />}
          color="amber"
        />
        <StatCard
          label="Vouchers available"
          value={stats.stock == null ? "—" : stats.stock.toLocaleString()}
          sub="across the mapped user groups"
          icon={<Ticket size={18} />}
          color="indigo"
        />
      </KpiGrid>

      <Toolbar>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plans, keys, user groups…"
          width="w-72"
        />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...PILL, width: 180 }}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<X size={13} />}
            onClick={() => {
              setCategoryFilter("");
              setQuery("");
            }}
          >
            Clear
          </Button>
        )}
        <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums">
          {visiblePlans.length} of {plans.length} plan{plans.length !== 1 ? "s" : ""} · {scopeLabel}
        </span>
      </Toolbar>

      <Panel
        title="Plan catalogue"
        subtitle="Sort order decides the running order on the portal."
        icon={<Layers size={15} />}
        tone="violet"
        padding={false}
      >
        {loading ? (
          <LoadingTable />
        ) : plans.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No plans configured yet"
            description={
              categoryFilter
                ? "Try clearing the filter, or add a new plan in the selected category."
                : "Plans appear here once you create them. Each plan maps a price to a Ruijie user group."
            }
            action={
              isAdmin && (
                <Button variant="primary" size="sm" iconLeft={<Plus size={13} />} onClick={handleCreate}>
                  Create first plan
                </Button>
              )
            }
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Category</Th>
                <Th align="right">Price</Th>
                <Th>Ruijie user group</Th>
                <Th align="right">Available</Th>
                <Th align="center">Active</Th>
                {isAdmin && <Th align="right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {visiblePlans.length === 0 ? (
                <TableMessage colSpan={colSpan}>No plan matches “{query.trim()}”.</TableMessage>
              ) : (
                visiblePlans.map((plan) => (
                  <tr key={plan._id || plan.id}>
                    <Td>
                      <div className="flex items-center gap-2 min-w-0">
                        <RecordCell
                          tone={CATEGORY_TILES[plan.category] || "violet"}
                          icon={<Layers size={14} />}
                          title={plan.name}
                          subtitle={plan.planKey}
                          mono
                        />
                        {Boolean(plan.popular) && (
                          <span title="Popular" className="shrink-0 text-[var(--warning-fg)]">
                            <Star size={12} className="fill-current" strokeWidth={1.5} />
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <StatusPill tone={CATEGORY_TONES[plan.category] || "neutral"} dot={false}>
                        {plan.category}
                      </StatusPill>
                    </Td>
                    <Td align="right" nowrap>
                      <span className="text-[11.5px] text-[var(--fg-muted)]">
                        {plan.currency || "FJD"}{" "}
                      </span>
                      <span className="font-semibold text-[var(--fg-primary)] tabular-nums">
                        {Number(plan.price || 0).toFixed(2)}
                      </span>
                    </Td>
                    <Td>
                      <span className="truncate inline-block max-w-[200px] align-middle">
                        {plan.userGroupName || plan.userGroup || (
                          <span className="text-[var(--fg-muted)]">—</span>
                        )}
                      </span>
                      {plan.dataAllowance && (
                        <span className="block text-[11.5px] text-[var(--fg-muted)] truncate max-w-[200px]">
                          {plan.dataAllowance}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Badge tone="neutral" icon={<Tag size={10} strokeWidth={2} />}>
                        {plan.availableVouchers ?? "—"}
                      </Badge>
                    </Td>
                    <Td align="center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={!!plan.isActive}
                          onChange={() => isAdmin && handleToggleActive(plan)}
                          disabled={!isAdmin}
                        />
                      </div>
                    </Td>
                    {isAdmin && (
                      <Td align="right">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton size="sm" onClick={() => handleEdit(plan)} aria-label="Edit" title="Edit plan">
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton
                            size="sm"
                            onClick={() => handleDelete(plan)}
                            aria-label="Delete"
                            title="Delete plan"
                            className="hover:text-[var(--brand)]"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {/* Create / Edit Modal */}
      <PlanFormModal
        open={showModal}
        plan={editingPlan}
        userGroups={userGroups}
        scopeLabel={scopeLabel}
        onSave={handleSave}
        onClose={() => setShowModal(false)}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Delete plan"
        variant="danger"
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Plan Form Modal
//
// The most consequential form in the console: a wrong user group here sells a
// customer a plan whose vouchers do not exist. Hence the label rail — each
// group states, in words, who the fields beside it are for.
// ---------------------------------------------------------------------------
function PlanFormModal({ open, plan, userGroups, scopeLabel, onSave, onClose }) {
  const isEditing = !!plan;
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Reset form when modal opens or plan changes
  useEffect(() => {
    if (!open) return;
    if (plan) {
      setForm({
        planKey: plan.planKey || "",
        name: plan.name || "",
        category: plan.category || "daily",
        price: plan.price ?? 0,
        currency: plan.currency || "FJD",
        dataAllowance: plan.dataAllowance || "",
        icon: plan.icon || "fa-wifi",
        popular: !!plan.popular,
        description: plan.description || "",
        features: Array.isArray(plan.features) ? plan.features : [],
        sortOrder: plan.sortOrder ?? 0,
        isActive: plan.isActive !== false,
        userGroup: plan.userGroup || "",
        userGroupName: plan.userGroupName || "",
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
  }, [open, plan]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleUserGroupChange = (value) => {
    const group = userGroups.find(
      (g) => String(g.id ?? g._id ?? g.name) === value
    );
    set("userGroup", value);
    set("userGroupName", group?.name || group?.groupName || "");

    // Auto-fill data allowance from user group info
    if (group) {
      const parts = [];
      if (group.quota) parts.push(group.quota);
      if (group.timePeriod) parts.push(`${group.timePeriod}s`);
      if (group.downloadRateLimit) parts.push(`↓${group.downloadRateLimit}`);
      const autoAllowance =
        parts.length > 0
          ? parts.join(" / ")
          : group.name || group.groupName || "";
      if (!form.dataAllowance || form.dataAllowance === "") {
        set("dataAllowance", autoAllowance);
      }
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.planKey.trim()) {
      toast.error("Plan key is required");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        price: Number(form.price),
        sortOrder: Number(form.sortOrder),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width="2xl">
      <Modal.Header
        icon={Globe}
        eyebrow={isEditing ? "Editing plan" : "New plan"}
        title={isEditing ? form.name || "Edit plan" : "Create a portal plan"}
        subtitle={
          isEditing
            ? "Update pricing, capacity, and copy. Changes apply immediately."
            : "Map a price to a Ruijie user group. Customers will see this on the portal."
        }
        onClose={onClose}
      />

      <Modal.Body>
        <form onSubmit={handleSubmit}>
          {/* A plan belongs to whichever village scope is active, and the scope
              lives in the sidebar — so say which one this will land in rather
              than letting the modal imply it is estate-wide. */}
          {!isEditing && (
            <div className="mb-7 flex items-start gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
              <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
              <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">
                This plan will be created for{" "}
                <span className="font-semibold text-[var(--fg-primary)]">{scopeLabel}</span>. Change the
                scope in the sidebar first to publish it somewhere else.
              </p>
            </div>
          )}

          <FormSection
            title="Identity"
            description="How the plan is referenced internally, and what the customer reads on the card."
          >
            <Field
              label="Plan key"
              required
              hint="Lowercase, hyphens only. Used in URLs and audit logs."
            >
              <Input
                mono
                value={form.planKey}
                onChange={(e) =>
                  set("planKey", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
                }
                placeholder="daily-basic"
                disabled={isEditing}
              />
            </Field>
            <Field label="Display name" required hint="Customer-facing name on the portal.">
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Daily Light"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Pricing"
            description="What M-PAiSA charges, and where the plan sits in the running order."
          >
            <Field label="Category">
              <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort order" hint="Lower = shown first.">
              <Input
                mono
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
              />
            </Field>
            <Field label="Price">
              <Input
                mono
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </Field>
            <Field label="Currency">
              <Input
                mono
                value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                placeholder="FJD"
                maxLength={4}
              />
            </Field>
          </FormSection>

          <FormSection
            title="Capacity"
            description="The Ruijie side. Vouchers are claimed from this group the moment a payment clears, so it must exist and have stock."
          >
            <Field
              label="Ruijie user group"
              hint="Vouchers are claimed from this group on purchase."
            >
              <Select value={form.userGroup} onChange={(e) => handleUserGroupChange(e.target.value)}>
                <option value="">Select user group…</option>
                {userGroups.map((g) => {
                  const id = String(g.id ?? g._id ?? g.name);
                  return (
                    <option key={id} value={id}>
                      {g.name || g.groupName || id}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label="User group name" hint="Auto-filled from selection.">
              <Input
                value={form.userGroupName}
                readOnly
                className="bg-[var(--surface-sunken)] cursor-not-allowed"
                placeholder="Select a user group above"
              />
            </Field>
            <Field
              label="Data allowance"
              hint="Auto-filled if the user group exposes a quota."
              className="sm:col-span-2"
            >
              <Input
                value={form.dataAllowance}
                onChange={(e) => set("dataAllowance", e.target.value)}
                placeholder="e.g. 1GB / 24h / ↓5Mbps"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Presentation"
            description="Everything here is customer-facing copy on the portal card."
          >
            <Field label="Icon">
              <Select value={form.icon} onChange={(e) => set("icon", e.target.value)}>
                {ICON_OPTIONS.map((ico) => (
                  <option key={ico.value} value={ico.value}>
                    {ico.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Short tagline shown under the price…"
              />
            </Field>
            <Field
              label="Features"
              hint="Press Enter to add a feature. Backspace to remove the last."
              className="sm:col-span-2"
            >
              <TagInput
                value={form.features}
                onChange={(features) => set("features", features)}
                placeholder="Unlimited streaming…"
              />
            </Field>
          </FormSection>

          <FormSection
            title="Visibility"
            description="Deactivating hides a plan from the portal without deleting its history."
          >
            <Toggle
              checked={form.popular}
              onChange={(v) => set("popular", v)}
              label="Mark as popular"
              hint="Adds a star badge on the portal card."
            />
            <Toggle
              checked={form.isActive}
              onChange={(v) => set("isActive", v)}
              label="Active"
              hint="Inactive plans are hidden from the portal but kept in the DB."
            />
          </FormSection>

          {/* Submits on Enter from any field without the footer buttons having
              to live inside the scrolling body. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex-1 min-w-0 text-[11.5px] text-[var(--fg-muted)] flex items-center gap-2">
          <Sparkles size={11} className="opacity-70 shrink-0" />
          <span className="font-mono truncate">
            {form.planKey || "—"} · {form.currency} {Number(form.price || 0).toFixed(2)}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          loading={saving}
          iconLeft={!saving ? <Check size={14} /> : null}
        >
          {isEditing ? "Save changes" : "Create plan"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small bits
// ---------------------------------------------------------------------------

/**
 * A titled group inside the plan form. The label rail on the left is what buys
 * the fields their space: the explanation moves out of the field hints and into
 * a column of its own, so two fields per row is enough.
 */
function FormSection({ title, description, children }) {
  return (
    <section className="grid gap-x-8 gap-y-4 md:grid-cols-[200px_minmax(0,1fr)] border-t border-[var(--border-subtle)] pt-7 mt-7 first:border-0 first:pt-0 first:mt-0">
      <div>
        <h3 className="font-display text-[13.5px] font-bold tracking-tight text-[var(--fg-primary)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">{description}</p>
        )}
      </div>
      <div className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">{children}</div>
    </section>
  );
}

function LoadingTable() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden p-5">
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4" style={{ opacity: 1 - i * 0.12 }}>
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-40" />
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
