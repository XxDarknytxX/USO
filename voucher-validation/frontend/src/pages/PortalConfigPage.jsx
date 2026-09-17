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

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { portalConfigApi, voucherApi } from "../services/api";
import { Callout } from "../components/campaigns/campaignUi";
import {
  allocationLabel,
  allocationParts,
  dataDrifts,
  dataGbShown,
  formatQuotaMb,
  groupKey,
  isAutoAllowance,
  portalDataLabel,
} from "../utils/allocation";
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
  RefreshCw,
  Undo2,
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
// User groups, per village
//
// A plan's allocation is only as current as the last time the console asked
// Ruijie. Each village's list is kept separately (a late answer for one village
// can never land on another), a load for a village already in flight is shared,
// and every completed load gets a sequence number so the plan form can tell an
// answer it asked for from one it merely found lying around.
// ---------------------------------------------------------------------------
function useUserGroupsByVillage() {
  const [byVillage, setByVillage] = useState({});
  const inflight = useRef(new Map());
  const seq = useRef(0);

  const load = useCallback((groupId) => {
    const key = groupId ? String(groupId) : "";
    if (inflight.current.has(key)) return inflight.current.get(key);
    setByVillage((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), loading: true, error: null } }));
    const request = voucherApi
      .userGroups(groupId ? { groupId } : {})
      .then((data) => {
        const n = ++seq.current;
        setByVillage((prev) => ({
          ...prev,
          [key]: {
            groups: data.userGroups || [],
            cloudSync: data.cloudSync === true,
            cloudError: data.cloudError || null,
            fetchedAt: data.fetchedAt || new Date().toISOString(),
            seq: n,
            loading: false,
            error: null,
          },
        }));
      })
      .catch((err) => {
        setByVillage((prev) => ({
          ...prev,
          [key]: { ...(prev[key] || {}), loading: false, error: err?.message || "Could not load user groups" },
        }));
      })
      .finally(() => inflight.current.delete(key));
    inflight.current.set(key, request);
    return request;
  }, []);

  return [byVillage, load];
}

const villageKey = (groupId) => (groupId ? String(groupId) : "");

/** Groups Ruijie itself lists (not ones known only from the voucher mirror). */
const listedInRuijie = (entry, g) => !!g && !(entry?.cloudSync && g.inRuijie === false);

/** A group Ruijie lists under the same name as `name` but a different id. */
function sameNameInRuijie(entry, name, notId) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || !entry?.cloudSync) return null;
  return (entry.groups || []).find(
    (g) => g.inRuijie !== false && groupKey(g) !== String(notId) && String(g.name || "").trim().toLowerCase() === n
  ) || null;
}

/**
 * How a saved plan compares with its user group in Ruijie, when that village's
 * groups have been loaded live. Empty when all is well or nothing is known.
 */
function planDrift(plan, entry) {
  if (!entry?.cloudSync || !plan.userGroup) return [];
  const live = (entry.groups || []).find((g) => groupKey(g) === String(plan.userGroup));
  if (!listedInRuijie(entry, live)) {
    const twin = sameNameInRuijie(entry, plan.userGroupName, plan.userGroup);
    return [twin
      ? { tone: "danger", text: "Recreated in Ruijie", title: `Ruijie no longer has this group's id, but has "${twin.name}" under a new one. Edit the plan and choose it.` }
      : { tone: "danger", text: "Not in Ruijie", title: "Ruijie no longer lists this user group for the village. Edit the plan and choose the group it should sell." }];
  }
  const out = [];
  if (live.name && plan.userGroupName && live.name !== plan.userGroupName) {
    out.push({
      tone: "warning",
      text: "Renamed in Ruijie",
      title: `Ruijie now calls this group "${live.name}". Edit and save the plan so its name matches.`,
    });
  }
  const label = allocationLabel(live);
  if (dataDrifts(plan.dataAllowance, live)) {
    out.push({
      tone: "warning",
      text: `Ruijie: ${formatQuotaMb(live.quota)}`,
      title: `The portal shows ${portalDataLabel(dataGbShown(plan.dataAllowance))} for this plan, but the group now gives ${formatQuotaMb(live.quota)}. Edit the plan to update it.`,
    });
  } else if (
    label &&
    plan.dataAllowance !== label &&
    isAutoAllowance(plan.dataAllowance, [plan.userGroupName, plan.name, live.name, live.localName])
  ) {
    out.push({
      tone: "info",
      text: "Allowance out of date",
      title: `Ruijie now gives ${label}. Edit the plan to update the wording customers see.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------
export default function PortalConfigPage() {
  const { isAdmin } = useAuth();
  const { activeGroupId, visibleSiteIds, sites, activeSite, isGlobal } = useSite();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupsByVillage, loadGroups] = useUserGroupsByVillage();

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

  // With one village selected, its groups are loaded so each plan can be
  // checked against Ruijie. "All villages" loads nothing up front — that would
  // be a Ruijie call per village on every visit; a village's plans are checked
  // once its groups have been loaded by opening one of them.
  useEffect(() => {
    if (isAdmin && activeGroupId) loadGroups(activeGroupId);
  }, [isAdmin, activeGroupId, loadGroups]);

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
        // The form says which village: the selected one, or the one chosen in
        // the form under "All villages".
        await portalConfigApi.create({ ...formData, groupId: formData.groupId || activeGroupId });
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
          // The inline pill width would leave the box short of its full-width
          // row on a phone; !important is what outranks an inline style.
          className="max-sm:w-full! max-sm:h-10!"
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
                  // On a phone each plan is a card: name and key on the left of
                  // the title line with price and category opposite, then the
                  // Ruijie side, then one footer of the live switch and the
                  // row's actions. Category, Price and (for an admin) Active
                  // stand down as rows of their own — they are already on the
                  // card — which takes the card from seven lines to four.
                  <tr key={plan._id || plan.id}>
                    <Td>
                      <div className="flex items-center gap-2 min-w-0 max-sm:w-full max-sm:items-start">
                        <RecordCell
                          tone={CATEGORY_TILES[plan.category] || "violet"}
                          icon={<Layers size={14} />}
                          title={plan.name}
                          subtitle={plan.planKey}
                          mono
                        />
                        {Boolean(plan.popular) && (
                          <span title="Popular" className="shrink-0 text-[var(--warning-fg)] max-sm:mt-1">
                            <Star size={12} className="fill-current" strokeWidth={1.5} />
                          </span>
                        )}
                        <span className="sm:hidden ml-auto shrink-0 flex flex-col items-end gap-1 pl-2">
                          <span className="whitespace-nowrap">
                            <span className="text-[11.5px] text-[var(--fg-muted)]">{plan.currency || "FJD"} </span>
                            <span className="font-semibold text-[var(--fg-primary)] tabular-nums">
                              {Number(plan.price || 0).toFixed(2)}
                            </span>
                          </span>
                          <StatusPill tone={CATEGORY_TONES[plan.category] || "neutral"} dot={false}>
                            {plan.category}
                          </StatusPill>
                        </span>
                      </div>
                    </Td>
                    <Td className="max-sm:hidden!">
                      <StatusPill tone={CATEGORY_TONES[plan.category] || "neutral"} dot={false}>
                        {plan.category}
                      </StatusPill>
                    </Td>
                    <Td align="right" nowrap className="max-sm:hidden!">
                      <span className="text-[11.5px] text-[var(--fg-muted)]">
                        {plan.currency || "FJD"}{" "}
                      </span>
                      <span className="font-semibold text-[var(--fg-primary)] tabular-nums">
                        {Number(plan.price || 0).toFixed(2)}
                      </span>
                    </Td>
                    <Td>
                      {/* One wrapper, so a phone card keeps the group and its
                          allowance together at the right instead of spreading
                          the two lines across the card. */}
                      <span className="block">
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
                        {(() => {
                          const drift = isAdmin ? planDrift(plan, groupsByVillage[villageKey(plan.groupId)]) : [];
                          if (!drift.length) return null;
                          return (
                            <span className="mt-1 flex flex-wrap gap-1 max-sm:justify-end">
                              {drift.map((d) => (
                                <button
                                  key={d.text}
                                  type="button"
                                  onClick={() => handleEdit(plan)}
                                  title={d.title}
                                  className="rounded-full focus-ring pointer-coarse:min-h-8"
                                >
                                  <StatusPill tone={d.tone} dot={false}>{d.text}</StatusPill>
                                </button>
                              ))}
                            </span>
                          );
                        })()}
                      </span>
                    </Td>
                    <Td align="right">
                      <Badge tone="neutral" icon={<Tag size={10} strokeWidth={2} />}>
                        {plan.availableVouchers ?? "—"}
                      </Badge>
                    </Td>
                    <Td align="center" className={isAdmin ? "max-sm:hidden!" : undefined}>
                      <div className="flex justify-center">
                        <Toggle
                          checked={!!plan.isActive}
                          onChange={() => isAdmin && handleToggleActive(plan)}
                          disabled={!isAdmin}
                        />
                      </div>
                    </Td>
                    {isAdmin && (
                      <Td align="right" className="max-sm:before:hidden! max-sm:pt-1!">
                        <div className="flex items-center justify-end gap-0.5 max-sm:w-full! max-sm:gap-2">
                          {/* The Active column's switch, brought into the
                              card's footer on a phone with a label a thumb
                              can hit as well as the track. */}
                          <span className="sm:hidden mr-auto">
                            <Toggle
                              checked={!!plan.isActive}
                              onChange={() => handleToggleActive(plan)}
                              label={plan.isActive ? "Live on portal" : "Hidden"}
                            />
                          </span>
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
        activeGroupId={activeGroupId}
        sites={sites}
        groupsByVillage={groupsByVillage}
        onLoadGroups={loadGroups}
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
function PlanFormModal({ open, plan, activeGroupId, sites, groupsByVillage, onLoadGroups, scopeLabel, onSave, onClose }) {
  const isEditing = !!plan;
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Under "All villages" a new plan needs a village chosen in the form: user
  // groups belong to one Ruijie project, and a plan created without one would
  // land in the server's default village.
  const [pickedVillage, setPickedVillage] = useState("");
  // Fields brought up to date from Ruijie since the form opened, so the admin
  // sees what changed and that it is not live for customers until saved.
  const [liveChanges, setLiveChanges] = useState([]);
  // Bumped with every reset, so the effect that applies Ruijie's figures runs
  // against the form that was just opened, not the previous one.
  const [openToken, setOpenToken] = useState(0);
  const seqAtLoad = useRef(0);
  const applied = useRef("");
  // Once the admin types in Data allowance, an answer from Ruijie never
  // replaces it — even text that happens to look autofilled ("5 GB" half-way
  // through typing "5 GB weekend special").
  const allowanceTouched = useRef(false);

  const villageId = isEditing ? plan.groupId || activeGroupId || null : activeGroupId || pickedVillage || null;
  const villageName = villageId
    ? (sites || []).find((x) => String(x.ruijieGroupId) === String(villageId))?.name || null
    : null;
  const needsVillage = !isEditing && !activeGroupId;
  const groups = villageId ? groupsByVillage[villageKey(villageId)] : undefined;
  const userGroups = groups?.groups || [];
  const cloudSync = groups?.cloudSync === true;

  // Reset form when modal opens or plan changes
  useEffect(() => {
    if (!open) {
      // Cleared on close, so the next "New plan" never asks Ruijie about the
      // village picked last time before its own reset lands.
      setPickedVillage("");
      return;
    }
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
    setPickedVillage("");
    setLiveChanges([]);
    setOpenToken((t) => t + 1);
    allowanceTouched.current = false;
  }, [open, plan]);

  // Whatever list is already held may predate a change made in Ruijie a minute
  // ago: ask again whenever the form opens or its village changes, and only
  // trust an answer that arrives after asking.
  useEffect(() => {
    if (!open || !villageId) return;
    seqAtLoad.current = groupsByVillage[villageKey(villageId)]?.seq || 0;
    applied.current = "";
    onLoadGroups(villageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openToken, villageId]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const findGroup = (id) => (id ? userGroups.find((g) => groupKey(g) === String(id)) : null);

  /**
   * Note changes made to match Ruijie. `replace` starts the entry afresh (an
   * admin's "Use this" undoes back to their own wording, not to the text the
   * form opened with); otherwise the first `from` is kept so Undo goes all the
   * way back.
   */
  function recordChanges(changes, { replace = false } = {}) {
    if (!changes.length) return;
    setLiveChanges((prev) => {
      const next = [...prev];
      for (const c of changes) {
        const i = next.findIndex((x) => x.field === c.field);
        if (i >= 0 && !replace) next[i] = { ...next[i], to: c.to };
        else if (i >= 0) next[i] = c;
        else next.push(c);
      }
      return next.filter((c) => c.from !== c.to);
    });
  }

  // Names an older console wrote into the allowance when it had no figures.
  const fallbackNames = (f, g) => [f.userGroupName, f.name, plan?.userGroupName, plan?.name, g?.name, g?.localName];

  /**
   * Bring the form in line with a group as Ruijie reports it now. The name
   * always follows Ruijie; the allowance follows it only while it is text the
   * console wrote and the admin has not typed in the field. Wording an admin
   * typed is left alone and a suggestion is shown beside it instead.
   */
  function applyGroup(prevForm, id, { fromSelect }) {
    const group = findGroup(id);
    const prevGroup = findGroup(prevForm.userGroup);
    const next = { ...prevForm, userGroup: id };
    const changes = [];
    const consoleText =
      !allowanceTouched.current && isAutoAllowance(prevForm.dataAllowance, fallbackNames(prevForm, prevGroup));
    if (!group) {
      if (fromSelect) {
        next.userGroupName = "";
        // The allowance described the group just unpicked.
        if (consoleText) next.dataAllowance = "";
      }
      return { next, changes };
    }
    // Without Ruijie the name is the voucher mirror's, which can be the old one;
    // only an explicit pick uses it.
    const liveName = group.name || group.groupName || "";
    if (liveName && liveName !== prevForm.userGroupName && (cloudSync || fromSelect)) {
      next.userGroupName = liveName;
      changes.push({ field: "userGroupName", label: "User group name", from: prevForm.userGroupName, to: liveName });
    }
    const label = cloudSync && listedInRuijie(groups, group) ? allocationLabel(group) : null;
    if (consoleText) {
      if (label && label !== prevForm.dataAllowance) {
        next.dataAllowance = label;
        changes.push({ field: "dataAllowance", label: "Data allowance", from: prevForm.dataAllowance, to: label });
      } else if (!label && fromSelect && String(id) !== String(prevForm.userGroup)) {
        // A different group, and no figures for it (Ruijie did not answer, or
        // does not list it): the old text described the previous group. Clear
        // it rather than sell this group with that group's data amount.
        next.dataAllowance = "";
      }
    }
    return { next, changes };
  }

  // A fresh answer from Ruijie (the one requested on open, or a Refresh):
  // re-derive the autofilled fields for the group already on the form. This is
  // what makes an allocation changed in Ruijie show up without re-picking.
  useEffect(() => {
    if (!open || !groups || groups.loading || !groups.seq || groups.seq <= seqAtLoad.current) return;
    const key = `${openToken}|${villageId}|${groups.seq}`;
    if (applied.current === key) return;
    applied.current = key;
    if (!form.userGroup) return;
    const { next, changes } = applyGroup(form, form.userGroup, { fromSelect: false });
    if (changes.length) {
      setForm(next);
      recordChanges(changes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openToken, villageId, groups?.seq, groups?.loading]);

  // Picking a group is the admin's own change: the fields visibly follow it,
  // and any earlier "updated to match Ruijie" note no longer describes the form.
  const handleUserGroupChange = (value) => {
    const { next } = applyGroup(form, value, { fromSelect: true });
    setForm(next);
    setLiveChanges([]);
  };

  const handleAllowanceChange = (value) => {
    allowanceTouched.current = true;
    set("dataAllowance", value);
    // What the admin types replaces any automatic change to this field.
    setLiveChanges((prev) => prev.filter((c) => c.field !== "dataAllowance"));
  };

  const handleVillagePick = (value) => {
    setPickedVillage(value);
    // Groups belong to one village; a group picked for another is meaningless.
    setForm((prev) => ({
      ...prev,
      userGroup: "",
      userGroupName: "",
      dataAllowance: allowanceTouched.current ? prev.dataAllowance : "",
    }));
    setLiveChanges([]);
  };

  // Undo only what is still as Ruijie left it.
  const undoLiveChanges = () => {
    setForm((prev) => {
      const next = { ...prev };
      for (const c of liveChanges) if (prev[c.field] === c.to) next[c.field] = c.from;
      return next;
    });
    setLiveChanges([]);
  };

  const selectedGroup = findGroup(form.userGroup);
  const selectedListed = listedInRuijie(groups, selectedGroup);
  const liveLabel = cloudSync && selectedListed ? allocationLabel(selectedGroup) : null;
  const customAllowance = !isAutoAllowance(form.dataAllowance, fallbackNames(form, selectedGroup));
  const suggestLive =
    !!liveLabel && form.dataAllowance.trim() !== liveLabel && (customAllowance || allowanceTouched.current);
  const suggestTone = suggestLive && dataDrifts(form.dataAllowance, selectedGroup) ? "warning" : "info";
  const groupMissing = !!form.userGroup && cloudSync && !groups?.loading && !selectedListed;
  const twin = groupMissing ? sameNameInRuijie(groups, form.userGroupName, form.userGroup) : null;
  const noFigures = !!form.userGroup && !groups?.loading && !liveLabel && !groupMissing;
  const checkedAt = groups?.fetchedAt
    ? new Date(groups.fetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : null;
  const villageOptions = (sites || []).filter((x) => x.ruijieGroupId);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (needsVillage && !villageId) {
      toast.error("Choose the village this plan is for");
      return;
    }
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
        ...(isEditing ? {} : { groupId: villageId }),
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
            ? "Update pricing, capacity, and copy. Customers see changes within a minute of saving."
            : "Map a price to a Ruijie user group. Customers will see this on the portal."
        }
        onClose={onClose}
      />

      <Modal.Body>
        <form onSubmit={handleSubmit}>
          {/* A plan belongs to whichever village scope is active, and the scope
              lives in the sidebar — so say which one this will land in rather
              than letting the modal imply it is estate-wide. */}
          {!isEditing && !needsVillage && (
            <div className="mb-7 flex items-start gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
              <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
              <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">
                This plan will be created for{" "}
                <span className="font-semibold text-[var(--fg-primary)]">{scopeLabel}</span>. Change the
                scope in the sidebar first to publish it somewhere else.
              </p>
            </div>
          )}
          {needsVillage && (
            <div className="mb-7 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
              <Field
                label="Village"
                required
                hint="A plan sells one village's vouchers, and its user groups come from that village in Ruijie."
              >
                <Select value={pickedVillage} onChange={(e) => handleVillagePick(e.target.value)}>
                  <option value="">Choose a village…</option>
                  {villageOptions.map((x) => (
                    <option key={x.id} value={String(x.ruijieGroupId)}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
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
            pairOnPhone
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
            {/* Where these figures came from, and when. */}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2.5">
              <span className="min-w-0 flex-1 text-[12px] text-[var(--fg-secondary)]">
                {!villageId ? (
                  "Choose the village first — its user groups are loaded from Ruijie."
                ) : groups?.loading ? (
                  <>Checking Ruijie{villageName ? ` for ${villageName}` : ""}…</>
                ) : groups?.error ? (
                  <span className="text-[var(--danger-fg)]">Could not load user groups: {groups.error}</span>
                ) : cloudSync ? (
                  <>
                    Live from Ruijie{villageName ? ` · ${villageName}` : ""}
                    {checkedAt ? <span className="text-[var(--fg-muted)]"> · checked {checkedAt}</span> : null}
                  </>
                ) : groups ? (
                  <span className="text-[var(--warning-fg)]">
                    Ruijie did not answer{groups.cloudError ? ` (${groups.cloudError})` : ""}. Showing the groups the
                    console knows from its vouchers; allocations were not checked and nothing was changed.
                  </span>
                ) : (
                  "User groups not loaded yet."
                )}
              </span>
              {villageId && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onLoadGroups(villageId)}
                  loading={!!groups?.loading}
                  iconLeft={!groups?.loading ? <RefreshCw size={12} /> : null}
                  className="shrink-0"
                >
                  Refresh from Ruijie
                </Button>
              )}
            </div>

            {liveChanges.length > 0 && (
              <Callout
                tone="info"
                className="sm:col-span-2"
                title="Updated to match Ruijie"
                action={
                  <Button variant="ghost" size="xs" iconLeft={<Undo2 size={12} />} onClick={undoLiveChanges}>
                    Undo
                  </Button>
                }
              >
                <ul className="flex flex-col gap-0.5">
                  {liveChanges.map((c) => (
                    <li key={c.field} className="[overflow-wrap:anywhere]">
                      {c.label}: <span className="line-through opacity-70">{c.from || "empty"}</span> →{" "}
                      <span className="font-semibold">{c.to}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  {isEditing ? "Customers keep seeing the old text until you save." : "Saved with the plan."}
                </p>
              </Callout>
            )}

            <Field
              label="Ruijie user group"
              hint="Vouchers are claimed from this group on purchase."
            >
              <Select
                value={form.userGroup}
                onChange={(e) => handleUserGroupChange(e.target.value)}
                disabled={!villageId}
              >
                <option value="">{villageId ? "Select user group…" : "Choose the village first"}</option>
                {/* The plan's saved group, while the list loads or when Ruijie no
                    longer lists it: without this the picker would show the
                    placeholder and hide which group the plan actually uses. */}
                {form.userGroup && !selectedGroup && (
                  <option value={form.userGroup}>
                    {form.userGroupName || form.userGroup}
                    {groups?.loading ? " (checking…)" : cloudSync ? " (not in Ruijie)" : ""}
                  </option>
                )}
                {userGroups.map((g) => {
                  const id = groupKey(g);
                  const listed = listedInRuijie(groups, g);
                  const label = cloudSync && listed ? allocationLabel(g) : null;
                  return (
                    <option key={id} value={id}>
                      {(g.name || g.groupName || id) + (label ? ` — ${label}` : "") + (listed ? "" : " (not in Ruijie)")}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label="User group name" hint="Follows the name in Ruijie.">
              <Input
                value={form.userGroupName}
                readOnly
                className="bg-[var(--surface-sunken)] cursor-not-allowed"
                placeholder="Select a user group above"
              />
            </Field>

            {groupMissing && (
              <Callout
                tone="danger"
                className="sm:col-span-2"
                title={twin ? "This user group was recreated in Ruijie" : "This user group is not in Ruijie"}
                action={
                  twin ? (
                    <Button variant="secondary" size="xs" onClick={() => handleUserGroupChange(groupKey(twin))}>
                      Use the new group
                    </Button>
                  ) : null
                }
              >
                {twin ? (
                  <>
                    Ruijie no longer has id <span className="font-mono">{form.userGroup}</span>, but lists a group
                    called “{twin.name}” under id <span className="font-mono">{groupKey(twin)}</span>. New vouchers are
                    made in that one.
                  </>
                ) : (
                  <>
                    Ruijie does not list id <span className="font-mono">{form.userGroup}</span>
                    {villageName ? ` in ${villageName}` : ""}. It may have been deleted or belong to another village.
                    Choose the group this plan should sell.
                  </>
                )}
              </Callout>
            )}

            {cloudSync && selectedListed && allocationParts(selectedGroup).length > 0 && (
              <dl className="sm:col-span-2 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[var(--border-subtle)] px-3.5 py-3 sm:grid-cols-5">
                {allocationParts(selectedGroup).map((p) => (
                  <div key={p.label} className="min-w-0">
                    <dt className="text-label">{p.label}</dt>
                    <dd className="mt-0.5 text-[12.5px] font-semibold text-[var(--fg-primary)] tabular-nums">{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <Field
              label="Data allowance"
              hint="What customers read on the plan card and receipt. Kept in step with Ruijie unless you write your own wording."
              className="sm:col-span-2"
            >
              <Input
                value={form.dataAllowance}
                onChange={(e) => handleAllowanceChange(e.target.value)}
                placeholder="e.g. 2 GB / 1 day / 4 Mbps"
              />
            </Field>

            {suggestLive && (
              <Callout
                tone={suggestTone}
                className="sm:col-span-2"
                title={suggestTone === "warning" ? "Ruijie gives a different amount of data" : "Ruijie's allocation"}
                action={
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      recordChanges(
                        [{ field: "dataAllowance", label: "Data allowance", from: form.dataAllowance, to: liveLabel }],
                        { replace: true }
                      );
                      allowanceTouched.current = false;
                      set("dataAllowance", liveLabel);
                    }}
                  >
                    Use this
                  </Button>
                }
              >
                {suggestTone === "warning" ? (
                  <>
                    The portal shows <span className="font-semibold">{portalDataLabel(dataGbShown(form.dataAllowance))}</span>{" "}
                    for this wording, but the group now gives <span className="font-semibold">{liveLabel}</span>.
                  </>
                ) : (
                  <>
                    The group now gives <span className="font-semibold">{liveLabel}</span>. Your wording was kept.
                  </>
                )}
              </Callout>
            )}

            {noFigures && !form.dataAllowance.trim() && (
              <p className="sm:col-span-2 -mt-2 text-[12px] text-[var(--warning-fg)]">
                No allocation figures for this group{cloudSync ? " from Ruijie" : " — Ruijie did not answer"}, so the
                allowance was left empty and the portal card will show no data amount. Type it, or refresh from Ruijie.
              </p>
            )}
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
        {/* On a phone the summary stands down (the key and price are in the
            form just above) and the two buttons split the row, so the primary
            action is a full thumb's width rather than a pill squeezed beside a
            truncated key. */}
        <div className="flex-1 min-w-0 text-[11.5px] text-[var(--fg-muted)] flex items-center gap-2 max-sm:hidden">
          <Sparkles size={11} className="opacity-70 shrink-0" />
          <span className="font-mono truncate">
            {form.planKey || "—"} · {form.currency} {Number(form.price || 0).toFixed(2)}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving} className="max-sm:flex-1 max-sm:h-11!">
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          loading={saving}
          iconLeft={!saving ? <Check size={14} /> : null}
          className="max-sm:flex-1 max-sm:h-11!"
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
function FormSection({ title, description, pairOnPhone = false, children }) {
  return (
    <section className="grid gap-x-8 gap-y-4 max-sm:gap-y-3.5 md:grid-cols-[200px_minmax(0,1fr)] border-t border-[var(--border-subtle)] pt-7 mt-7 max-sm:pt-6 max-sm:mt-6 first:border-0 first:pt-0 first:mt-0">
      <div>
        <h3 className="font-display text-[13.5px] font-bold tracking-tight text-[var(--fg-primary)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">{description}</p>
        )}
      </div>
      {/* Short values (a price, a currency code, a sort number) stay two-up on
          a phone; a column of four half-empty boxes reads as more form than it
          is. Everything else goes single column. */}
      <div
        className={
          "min-w-0 grid sm:grid-cols-2 gap-x-5 gap-y-5 " +
          (pairOnPhone ? "grid-cols-2 max-sm:gap-x-3" : "grid-cols-1")
        }
      >
        {children}
      </div>
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
