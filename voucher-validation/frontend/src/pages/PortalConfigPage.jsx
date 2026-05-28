// src/pages/PortalConfigPage.jsx
//
// Portal Plans management page.
// Rebuilt on the "Operations Console" design system — IBM Plex typography,
// Vodafone red as the only chromatic punctuation, hairline borders, dense
// table with breathable modal forms.

import { useEffect, useState, useCallback } from "react";
import { portalConfigApi, voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import toast from "react-hot-toast";
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Filter,
  Star,
  Layers,
  Tag,
  Sparkles,
} from "lucide-react";

import Button, { IconButton } from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import {
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  TagInput,
} from "../components/ui/Field";
import {
  Card,
  Badge,
  Section,
  EmptyState,
} from "../components/ui/Surface";

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

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userGroups, setUserGroups] = useState([]);

  const [categoryFilter, setCategoryFilter] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (categoryFilter) params.category = categoryFilter;
      const data = await portalConfigApi.list(params);
      setPlans(data.plans || []);
    } catch (err) {
      toast.error("Failed to load plans: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    voucherApi
      .userGroups()
      .then((data) => setUserGroups(data.userGroups || []))
      .catch(() => {});
  }, []);

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
        await portalConfigApi.create(formData);
        toast.success("Plan created");
      }
      setShowModal(false);
      fetchPlans();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const hasFilters = !!categoryFilter;

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="page-header">
        <div className="flex items-start gap-3 min-w-0">
          <span className="brand-mark mt-0.5">
            <Globe size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="page-eyebrow">Portal · Configuration</div>
            <h1 className="page-title">Portal Plans</h1>
            <p className="page-subtitle">
              {plans.length} plan{plans.length !== 1 && "s"} configured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <FilterPicker value={categoryFilter} onChange={setCategoryFilter} />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<X size={13} />}
              onClick={() => setCategoryFilter("")}
            >
              Clear
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="primary"
              size="md"
              iconLeft={<Plus size={14} />}
              onClick={handleCreate}
            >
              New Plan
            </Button>
          )}
        </div>
      </header>

      {/* Table */}
      <div className="flex-1 min-h-0 px-8 pb-8 pt-5">
        <Card className="h-full flex flex-col overflow-hidden">
          {loading ? (
            <LoadingTable />
          ) : plans.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No plans configured yet"
              description={
                hasFilters
                  ? "Try clearing the filter, or add a new plan in the selected category."
                  : "Plans appear here once you create them. Each plan maps a price to a Ruijie user group."
              }
              action={
                isAdmin && (
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={<Plus size={13} />}
                    onClick={handleCreate}
                  >
                    Create first plan
                  </Button>
                )
              }
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)]/95 backdrop-blur">
                  <tr className="text-left text-[12px] font-medium text-[var(--text-tertiary)]">
                    <Th>Key</Th>
                    <Th>Name</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Price</Th>
                    <Th>User group</Th>
                    <Th className="text-right">Available</Th>
                    <Th className="text-center">Active</Th>
                    {isAdmin && <Th className="text-right pr-5">·</Th>}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan, i) => (
                    <tr
                      key={plan._id || plan.id}
                      className={
                        "transition-colors hover:bg-[var(--surface-hover)] " +
                        (i !== 0
                          ? "border-t border-[var(--border-subtle)]"
                          : "")
                      }
                    >
                      <Td>
                        <span className="font-mono text-[12.5px] text-[var(--text-secondary)] tabular">
                          {plan.planKey}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-[var(--text-primary)] truncate">
                            {plan.name}
                          </span>
                          {plan.popular && (
                            <span
                              title="Popular"
                              className="text-[var(--warning-fg)]"
                            >
                              <Star
                                size={12}
                                className="fill-current"
                                strokeWidth={1.5}
                              />
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={CATEGORY_TONES[plan.category]}>
                          {plan.category}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        <span className="font-mono text-[var(--text-primary)] tabular">
                          {plan.currency || "FJD"}{" "}
                          <span className="font-semibold">
                            {Number(plan.price || 0).toFixed(2)}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[var(--text-tertiary)] truncate inline-block max-w-[180px]">
                          {plan.userGroupName || plan.userGroup || (
                            <span className="text-[var(--text-quaternary)]">
                              —
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <Badge
                          tone="neutral"
                          icon={<Tag size={10} strokeWidth={2} />}
                        >
                          {plan.availableVouchers ?? "—"}
                        </Badge>
                      </Td>
                      <Td className="text-center">
                        <div className="flex justify-center">
                          <Toggle
                            checked={!!plan.isActive}
                            onChange={() => isAdmin && handleToggleActive(plan)}
                            disabled={!isAdmin}
                          />
                        </div>
                      </Td>
                      {isAdmin && (
                        <Td className="text-right pr-3">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton
                              size="sm"
                              onClick={() => handleEdit(plan)}
                              aria-label="Edit"
                              title="Edit plan"
                            >
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Create / Edit Modal */}
      <PlanFormModal
        open={showModal}
        plan={editingPlan}
        userGroups={userGroups}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan Form Modal
// ---------------------------------------------------------------------------
function PlanFormModal({ open, plan, userGroups, onSave, onClose }) {
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
    <Modal open={open} onClose={onClose} width="xl">
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

      <Modal.Body className="space-y-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* -- Identity -------------------------------------------------- */}
          <Section label="Identity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field
                label="Plan key"
                required
                hint="Lowercase, hyphens only. Used in URLs and audit logs."
              >
                <Input
                  mono
                  value={form.planKey}
                  onChange={(e) =>
                    set(
                      "planKey",
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")
                    )
                  }
                  placeholder="daily-basic"
                  disabled={isEditing}
                />
              </Field>
              <Field
                label="Display name"
                required
                hint="Customer-facing name on the portal."
              >
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Daily Light"
                />
              </Field>
            </div>
          </Section>

          {/* -- Pricing --------------------------------------------------- */}
          <Section label="Pricing">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </Select>
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
                  onChange={(e) =>
                    set("currency", e.target.value.toUpperCase())
                  }
                  placeholder="FJD"
                  maxLength={4}
                />
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
            </div>
          </Section>

          {/* -- Capacity / Ruijie mapping --------------------------------- */}
          <Section label="Capacity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field
                label="Ruijie user group"
                hint="Vouchers are claimed from this group on purchase."
              >
                <Select
                  value={form.userGroup}
                  onChange={(e) => handleUserGroupChange(e.target.value)}
                >
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
              <Field
                label="User group name"
                hint="Auto-filled from selection."
              >
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
                className="md:col-span-2"
              >
                <Input
                  value={form.dataAllowance}
                  onChange={(e) => set("dataAllowance", e.target.value)}
                  placeholder="e.g. 1GB / 24h / ↓5Mbps"
                />
              </Field>
            </div>
          </Section>

          {/* -- Presentation ---------------------------------------------- */}
          <Section label="Presentation">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Icon">
                <Select
                  value={form.icon}
                  onChange={(e) => set("icon", e.target.value)}
                >
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
                className="md:col-span-2"
              >
                <TagInput
                  value={form.features}
                  onChange={(features) => set("features", features)}
                  placeholder="Unlimited streaming…"
                />
              </Field>
            </div>
          </Section>

          {/* -- Flags ----------------------------------------------------- */}
          <Section label="Visibility">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
            </div>
          </Section>
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex-1 text-[11.5px] text-[var(--text-quaternary)] flex items-center gap-2">
          <Sparkles size={11} className="opacity-70" />
          <span className="font-mono">
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
function FilterPicker({ value, onChange }) {
  return (
    <div className="relative">
      <Filter
        size={13}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] pointer-events-none"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "appearance-none h-9 pl-8 pr-7 text-[12.5px] " +
          "bg-[var(--surface-raised)] text-[var(--text-secondary)] " +
          "border border-[var(--border-default)] rounded-md cursor-pointer " +
          "hover:border-[var(--border-strong)] focus-input"
        }
      >
        <option value="">All categories</option>
        {CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={
        "px-4 py-2.5 font-medium border-b border-[var(--border-subtle)] " +
        className
      }
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }) {
  return (
    <td className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}

function LoadingTable() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden p-5">
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4"
            style={{ opacity: 1 - i * 0.12 }}
          >
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
