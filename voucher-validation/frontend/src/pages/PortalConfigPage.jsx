// src/pages/PortalConfigPage.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { portalConfigApi, voucherApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Filter,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Tag,
  Star,
  Layers,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CATEGORIES = ["daily", "weekly", "monthly", "custom"];

const CATEGORY_COLORS = {
  daily: "bg-blue-50 text-blue-700 ring-blue-200",
  weekly: "bg-amber-50 text-amber-700 ring-amber-200",
  monthly: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  custom: "bg-purple-50 text-purple-700 ring-purple-200",
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

const INPUT_CLASS =
  "w-full px-3.5 py-2.5 bg-gray-50/80 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent focus:bg-white transition-all placeholder:text-gray-300";

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

  // Data
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userGroups, setUserGroups] = useState([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("");

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [confirm, setConfirm] = useState(null);

  // ------- Fetch plans -------
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

  // ------- Fetch user groups once -------
  useEffect(() => {
    voucherApi
      .userGroups()
      .then((data) => setUserGroups(data.userGroups || []))
      .catch(() => {});
  }, []);

  // ------- Handlers -------
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
      toast.success(
        `Plan ${!plan.isActive ? "activated" : "deactivated"}`
      );
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Portal Plans
              </h1>
              <p className="text-xs text-gray-400 font-medium mt-0.5">
                {plans.length} plan configuration{plans.length !== 1 && "s"}
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 active:scale-[0.97]"
            >
              <Plus size={16} />
              Add Plan
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 mt-4">
          {/* Category filter */}
          <div className="relative">
            <Filter
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none pl-8 pr-8 py-2.5 bg-gray-50/80 border border-gray-100 rounded-xl text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none"
            />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={() => setCategoryFilter("")}
              className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm h-full flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-9 h-9 border-[3px] border-purple-100 border-t-purple-500 rounded-full animate-spin" />
            </div>
          ) : plans.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
              <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                <Layers size={28} className="text-gray-200" />
              </div>
              <p className="text-sm font-medium text-gray-400">
                No plans found
              </p>
              <p className="text-xs text-gray-300 mt-1">
                {hasFilters
                  ? "Try adjusting your filters"
                  : "Add a plan to get started"}
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50/90 backdrop-blur-sm text-left text-[11px] text-gray-400 uppercase tracking-wider font-semibold">
                    <th className="px-4 py-3">Plan Key</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">User Group</th>
                    <th className="px-4 py-3">Vouchers</th>
                    <th className="px-4 py-3">Active</th>
                    {isAdmin && (
                      <th className="px-4 py-3 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {plans.map((plan) => (
                    <tr
                      key={plan._id || plan.id}
                      className="transition-colors hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[13px] font-semibold text-purple-600 bg-purple-50/60 px-2 py-0.5 rounded-md">
                          {plan.planKey}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-800 font-medium text-sm">
                            {plan.name}
                          </span>
                          {plan.popular && (
                            <Star
                              size={13}
                              className="text-amber-400 fill-amber-400"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <CategoryBadge category={plan.category} />
                      </td>
                      <td className="px-4 py-3.5 text-gray-700 text-sm font-semibold">
                        {plan.currency || "FJD"}{" "}
                        {Number(plan.price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-gray-600 text-xs font-medium truncate max-w-[140px]">
                        {plan.userGroupName || plan.userGroup || "---"}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-50 text-gray-600 text-xs font-semibold rounded-md">
                          <Tag size={11} />
                          {plan.availableVouchers ?? "---"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <button
                          onClick={() => isAdmin && handleToggleActive(plan)}
                          disabled={!isAdmin}
                          className="focus:outline-none disabled:cursor-default"
                          title={
                            plan.isActive
                              ? "Click to deactivate"
                              : "Click to activate"
                          }
                        >
                          {plan.isActive ? (
                            <ToggleRight
                              size={24}
                              className="text-green-500"
                            />
                          ) : (
                            <ToggleLeft
                              size={24}
                              className="text-gray-300"
                            />
                          )}
                        </button>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEdit(plan)}
                              className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
                              title="Edit plan"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => handleDelete(plan)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              title="Delete plan"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <PlanFormModal
            plan={editingPlan}
            userGroups={userGroups}
            onSave={handleSave}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Confirm Dialog */}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Badge
// ---------------------------------------------------------------------------
function CategoryBadge({ category }) {
  const color =
    CATEGORY_COLORS[category] || "bg-gray-50 text-gray-600 ring-gray-200";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold capitalize rounded-full ring-1 ring-inset ${color}`}
    >
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Plan Form Modal
// ---------------------------------------------------------------------------
function PlanFormModal({ plan, userGroups, onSave, onClose }) {
  const isEditing = !!plan;
  const [form, setForm] = useState(() => {
    if (plan) {
      return {
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
      };
    }
    return { ...EMPTY_FORM };
  });

  const [saving, setSaving] = useState(false);
  const [featureInput, setFeatureInput] = useState("");
  const featureRef = useRef(null);

  const set = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

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
      const autoAllowance = parts.length > 0
        ? parts.join(" / ")
        : group.name || group.groupName || "";
      if (!form.dataAllowance || form.dataAllowance === "") {
        set("dataAllowance", autoAllowance);
      }
    }
  };

  const addFeature = () => {
    const tag = featureInput.trim();
    if (tag && !form.features.includes(tag)) {
      set("features", [...form.features, tag]);
    }
    setFeatureInput("");
    featureRef.current?.focus();
  };

  const removeFeature = (tag) => {
    set(
      "features",
      form.features.filter((f) => f !== tag)
    );
  };

  const handleFeatureKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFeature();
    }
    if (e.key === "Backspace" && !featureInput && form.features.length) {
      removeFeature(form.features[form.features.length - 1]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient bar */}
        <div className="h-1 bg-gradient-to-r from-purple-500 to-pink-500" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEditing ? "Edit Plan" : "New Plan"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* Row: Plan Key + Name */}
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Plan Key" required>
              <input
                type="text"
                value={form.planKey}
                onChange={(e) =>
                  set(
                    "planKey",
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                  )
                }
                placeholder="daily-basic"
                className={INPUT_CLASS}
              />
            </FieldGroup>
            <FieldGroup label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Daily Light"
                className={INPUT_CLASS}
              />
            </FieldGroup>
          </div>

          {/* Row: Category + Price + Currency */}
          <div className="grid grid-cols-3 gap-4">
            <FieldGroup label="Category">
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className={INPUT_CLASS}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Price">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className={INPUT_CLASS}
              />
            </FieldGroup>
            <FieldGroup label="Currency">
              <input
                type="text"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                placeholder="FJD"
                className={INPUT_CLASS}
              />
            </FieldGroup>
          </div>

          {/* Row: Data Allowance + Icon + Sort Order */}
          <div className="grid grid-cols-3 gap-4">
            <FieldGroup label="Data Allowance (optional)">
              <input
                type="text"
                value={form.dataAllowance}
                onChange={(e) => set("dataAllowance", e.target.value)}
                placeholder="Auto-filled from user group"
                className={INPUT_CLASS}
              />
            </FieldGroup>
            <FieldGroup label="Icon">
              <select
                value={form.icon}
                onChange={(e) => set("icon", e.target.value)}
                className={INPUT_CLASS}
              >
                {ICON_OPTIONS.map((ico) => (
                  <option key={ico.value} value={ico.value}>
                    {ico.label}
                  </option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Sort Order">
              <input
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                className={INPUT_CLASS}
              />
            </FieldGroup>
          </div>

          {/* Row: User Group */}
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="User Group">
              <select
                value={form.userGroup}
                onChange={(e) => handleUserGroupChange(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Select group...</option>
                {userGroups.map((g) => {
                  const id = String(g.id ?? g._id ?? g.name);
                  return (
                    <option key={id} value={id}>
                      {g.name || g.groupName || id}
                    </option>
                  );
                })}
              </select>
            </FieldGroup>
            <FieldGroup label="User Group Name">
              <input
                type="text"
                value={form.userGroupName}
                readOnly
                className={`${INPUT_CLASS} bg-gray-50 cursor-not-allowed`}
                placeholder="Auto-filled from selection"
              />
            </FieldGroup>
          </div>

          {/* Description */}
          <FieldGroup label="Description">
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Brief description of this plan..."
              className={`${INPUT_CLASS} resize-none`}
            />
          </FieldGroup>

          {/* Features (multi-tag) */}
          <FieldGroup label="Features">
            <div className="min-h-[42px] flex flex-wrap items-center gap-1.5 p-2 bg-gray-50/80 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-purple-400 focus-within:border-transparent focus-within:bg-white transition-all">
              {form.features.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-semibold rounded-lg"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeFeature(tag)}
                    className="text-purple-400 hover:text-purple-700 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                ref={featureRef}
                type="text"
                value={featureInput}
                onChange={(e) => setFeatureInput(e.target.value)}
                onKeyDown={handleFeatureKeyDown}
                placeholder={
                  form.features.length === 0 ? "Type and press Enter..." : ""
                }
                className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-gray-300 py-0.5"
              />
            </div>
          </FieldGroup>

          {/* Checkboxes */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.popular}
                onChange={(e) => set("popular", e.target.checked)}
                className="rounded-md border-gray-300 text-purple-500 focus:ring-purple-400"
              />
              <span className="text-sm font-medium text-gray-700">
                Popular
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
                className="rounded-md border-gray-300 text-purple-500 focus:ring-purple-400"
              />
              <span className="text-sm font-medium text-gray-700">
                Active
              </span>
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {isEditing ? "Save Changes" : "Create Plan"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Field Group Helper
// ---------------------------------------------------------------------------
function FieldGroup({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
