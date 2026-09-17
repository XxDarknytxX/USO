// src/components/vouchers/VoucherCreateForm.jsx
//
// "Generate vouchers" — pick a profile, pick a quantity, fire.
//
// Two decisions, so the modal is two blocks and nothing else. The profile list
// is a scrollable radio group rather than a select, because the numbers being
// compared (duration, quota, devices) have to stay visible while choosing — a
// dropdown would hide exactly the thing you are choosing between.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Ticket,
  Sparkles,
  Clock,
  HardDrive,
  Users,
  Minus,
  Plus,
  Loader2,
  Check,
  Inbox,
} from "lucide-react";

import { voucherApi } from "../../services/api";
import { Modal, Field, Input, Button, Badge, EmptyState, ObjectTile, Segmented } from "../ui";

const QUICK_QTYS = [1, 5, 10, 25, 50];

export default function VoucherCreateForm({ groupId, siteName, onClose, onCreated }) {
  const [userGroups, setUserGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    loadUserGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function loadUserGroups() {
    setLoadingGroups(true);
    try {
      const data = await voucherApi.userGroups(groupId ? { groupId } : {});
      setUserGroups(data.userGroups || []);
    } catch (err) {
      toast.error("Failed to load profiles: " + err.message);
    } finally {
      setLoadingGroups(false);
    }
  }

  async function handleSubmit() {
    if (!selectedGroup) {
      toast.error("Please select a profile");
      return;
    }
    if (quantity < 1 || quantity > 100) {
      toast.error("Quantity must be between 1 and 100");
      return;
    }
    setSubmitting(true);
    try {
      const gid = String(selectedGroup.id || selectedGroup.userGroupId);
      const gname = selectedGroup.name || selectedGroup.userGroupName || "";
      const payload = {
        user_group_id: gid,
        user_group_name: gname,
        profile: selectedGroup.authProfileId || gid,
        package_name: gname,
        quantity,
        groupId: groupId || undefined,
      };
      const result = await voucherApi.create(payload);
      const count = result.count || 1;
      toast.success(`${count} voucher${count > 1 ? "s" : ""} created successfully`);
      onCreated();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedId = useMemo(
    () => (selectedGroup ? String(selectedGroup.id || selectedGroup.userGroupId) : null),
    [selectedGroup]
  );

  return (
    <Modal open onClose={onClose} width="lg">
      <Modal.Header
        eyebrow={siteName ? `Village · ${siteName}` : "Vouchers"}
        title="Generate vouchers"
        subtitle="Pick a profile and how many codes to mint. They appear in the Vouchers list immediately."
        icon={Ticket}
        onClose={onClose}
      />

      <Modal.Body>
        <div className="flex flex-col gap-6">
          {/* Profile picker */}
          <Field
            label="Profile"
            required
            hint="The plan defines time period, data quota, and concurrent client limit."
          >
            {loadingGroups ? (
              <ProfileSkeleton />
            ) : userGroups.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
                <EmptyState
                  icon={Inbox}
                  title="No profiles found"
                  description="Check your Ruijie API connection and try again."
                />
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="Voucher profile"
                // Phone: no inner scroll box. The sheet body already scrolls,
                // and a scroll area inside a scrolling sheet traps the thumb.
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1 max-sm:max-h-none max-sm:overflow-visible max-sm:pr-0"
              >
                {userGroups.map((g) => {
                  const gid = String(g.id || g.userGroupId);
                  return (
                    <ProfileCard
                      key={gid}
                      group={g}
                      selected={selectedId === gid}
                      onSelect={() => setSelectedGroup(g)}
                    />
                  );
                })}
              </div>
            )}
          </Field>

          {/* Quantity */}
          <Field label="Quantity" required hint="Between 1 and 100. Each voucher gets a unique code.">
            {/* Phone: the stepper spans the row (input takes the slack) and the
                quick picks sit under it as equal, thumb-sized segments. */}
            <div className="flex flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch">
              <div className="flex items-center gap-2 max-sm:w-full">
                <QtyStepButton onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">
                  <Minus size={14} />
                </QtyStepButton>

                <Input
                  mono
                  type="number"
                  min={1}
                  max={100}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  aria-label="Quantity"
                  className="text-center w-20 max-sm:flex-1 max-sm:min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />

                <QtyStepButton onClick={() => setQuantity(Math.min(100, quantity + 1))} aria-label="Increase quantity">
                  <Plus size={14} />
                </QtyStepButton>
              </div>

              {/* Quick picks cover the batch sizes a village actually orders. */}
              <Segmented
                size="sm"
                value={quantity}
                onChange={(n) => setQuantity(n)}
                options={QUICK_QTYS.map((n) => ({ value: n, label: String(n) }))}
                className="ml-auto max-sm:ml-0 max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center max-sm:[&>button]:h-9"
              />
            </div>
          </Field>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {/* Phone: the summary takes its own line and the two buttons share the
            next one equally, so the primary action is wide and easy to hit. */}
        <span className="mr-auto text-[12.5px] text-[var(--fg-muted)] min-w-0 truncate max-sm:basis-full max-sm:mr-0">
          {selectedGroup ? (
            <>
              {(selectedGroup.name || selectedGroup.userGroupName) + " · "}
              <span className="text-[var(--fg-secondary)] font-semibold tabular-nums">
                {quantity} code{quantity > 1 ? "s" : ""}
              </span>
            </>
          ) : (
            "No profile selected"
          )}
        </span>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting} className="max-sm:flex-1">
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="max-sm:flex-[2]"
          onClick={handleSubmit}
          loading={submitting}
          disabled={loadingGroups || !selectedGroup}
          iconLeft={!submitting && <Sparkles size={14} />}
        >
          {submitting
            ? "Generating…"
            : `Generate ${quantity > 1 ? quantity + " " : ""}voucher${quantity > 1 ? "s" : ""}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/* ------------ Profile card (radio-as-card) ------------------------------- */
function ProfileCard({ group, selected, onSelect }) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      whileTap={{ scale: 0.99 }}
      className={
        "group text-left p-3 rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 focus-ring " +
        (selected
          ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_0_0_3px_var(--brand-soft)]"
          : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface)]")
      }
    >
      <div className="flex items-start gap-2.5">
        <ObjectTile tone={selected ? "brand" : "indigo"} size="sm">
          <Ticket size={14} />
        </ObjectTile>
        <span className="min-w-0 flex-1">
          <span
            className={
              "block text-[13px] font-semibold tracking-tight truncate font-display " +
              (selected ? "text-[var(--brand-fg-on-soft)]" : "text-[var(--fg-primary)]")
            }
          >
            {group.name || group.userGroupName}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--fg-muted)]">
            {group.timePeriod != null && (
              <span className="flex items-center gap-1 tabular-nums">
                <Clock size={11} /> {formatTime(group.timePeriod)}
              </span>
            )}
            {group.quota != null && (
              <span className="flex items-center gap-1 tabular-nums">
                <HardDrive size={11} /> {formatQuota(group.quota)}
              </span>
            )}
            {group.noOfDevice != null && (
              <span className="flex items-center gap-1 tabular-nums">
                <Users size={11} /> {Number(group.noOfDevice) === 0 ? "Any devices" : `${group.noOfDevice} dev`}
              </span>
            )}
            {group.voucherCount > 0 && (
              <Badge tone="brand" size="sm">
                {group.voucherCount} active
              </Badge>
            )}
          </span>
        </span>

        <span
          className={
            "shrink-0 mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center transition-colors " +
            (selected
              ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--text-on-brand)]"
              : "border-[var(--border-strong)] bg-transparent text-transparent group-hover:border-[var(--fg-muted)]")
          }
        >
          <Check size={10} strokeWidth={3} />
        </span>
      </div>
    </motion.button>
  );
}

/* ------------ Quantity stepper button ------------------------------------ */
function QtyStepButton({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={
        "h-10 w-10 shrink-0 flex items-center justify-center rounded-full " +
        "bg-[var(--surface)] border border-[var(--input-border)] " +
        "text-[var(--fg-secondary)] shadow-[var(--shadow-xs)] " +
        "hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)] " +
        "active:bg-[var(--surface-pressed)] focus-ring transition-colors"
      }
    >
      {children}
    </button>
  );
}

/* ------------ Loading skeleton for the profile grid ---------------------- */
function ProfileSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[74px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] skeleton" />
      ))}
      <div className="col-span-full flex items-center justify-center gap-2 text-[12px] text-[var(--fg-muted)] py-1">
        <Loader2 size={12} className="animate-spin" /> Loading profiles…
      </div>
    </div>
  );
}

/* ------------ Formatters -------------------------------------------------- */
// Ruijie uses 0 for "no limit" on a user group.
function formatTime(minutes) {
  const m = Number(minutes || 0);
  if (m === 0) return "No expiry";
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function formatQuota(mb) {
  const val = Number(mb || 0);
  if (val === 0) return "Unlimited data";
  if (val < 1024) return `${val} MB`;
  return `${(val / 1024).toFixed(1)} GB`;
}
