// src/components/vouchers/VoucherCreateForm.jsx
// "Generate Vouchers" modal — pick a profile, pick a quantity, fire.
// Rebuilt on the design system: Modal + Field + Input + Button + Badge.

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
import { Modal, Field, Input, Button, Badge, EmptyState } from "../ui";

const QUICK_QTYS = [1, 5, 10, 25, 50];

export default function VoucherCreateForm({ onClose, onCreated }) {
  const [userGroups, setUserGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    loadUserGroups();
  }, []);

  async function loadUserGroups() {
    setLoadingGroups(true);
    try {
      const data = await voucherApi.userGroups();
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
      };
      const result = await voucherApi.create(payload);
      const count = result.count || 1;
      toast.success(
        `${count} voucher${count > 1 ? "s" : ""} created successfully`
      );
      onCreated();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedId = useMemo(
    () =>
      selectedGroup
        ? String(selectedGroup.id || selectedGroup.userGroupId)
        : null,
    [selectedGroup]
  );

  return (
    <Modal open onClose={onClose} width="lg">
      <Modal.Header
        eyebrow="Vouchers"
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
              <div className="border border-[var(--border-subtle)] rounded-md bg-[var(--surface-sunken)]">
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
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1"
              >
                {userGroups.map((g) => {
                  const gid = String(g.id || g.userGroupId);
                  const isSelected = selectedId === gid;
                  return (
                    <ProfileCard
                      key={gid}
                      group={g}
                      selected={isSelected}
                      onSelect={() => setSelectedGroup(g)}
                    />
                  );
                })}
              </div>
            )}
          </Field>

          {/* Quantity */}
          <Field
            label="Quantity"
            required
            hint="Between 1 and 100. Each voucher gets a unique code."
          >
            <div className="flex items-center gap-2">
              <QtyStepButton
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                aria-label="Decrease quantity"
              >
                <Minus size={14} />
              </QtyStepButton>

              <Input
                mono
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    Math.max(1, Math.min(100, Number(e.target.value) || 1))
                  )
                }
                className="text-center w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              <QtyStepButton
                onClick={() => setQuantity(Math.min(100, quantity + 1))}
                aria-label="Increase quantity"
              >
                <Plus size={14} />
              </QtyStepButton>

              <span className="flex-1" />

              <div className="flex items-center gap-1">
                {QUICK_QTYS.map((n) => {
                  const active = quantity === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuantity(n)}
                      className={
                        "px-2 h-7 text-[12px] font-mono rounded transition-colors " +
                        (active
                          ? "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] border border-[var(--brand-soft-hover)]"
                          : "bg-transparent text-[var(--text-tertiary)] border border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
                      }
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          </Field>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <span className="mr-auto text-[12px] text-[var(--text-tertiary)] font-mono">
          {selectedGroup ? (
            <>
              {(selectedGroup.name || selectedGroup.userGroupName) + " · "}
              <span className="text-[var(--text-secondary)]">
                {quantity} code{quantity > 1 ? "s" : ""}
              </span>
            </>
          ) : (
            "No profile selected"
          )}
        </span>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          loading={submitting}
          disabled={loadingGroups || !selectedGroup}
          iconLeft={!submitting && <Sparkles size={14} />}
        >
          {submitting
            ? "Generating…"
            : `Generate ${quantity > 1 ? quantity + " " : ""}voucher${
                quantity > 1 ? "s" : ""
              }`}
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
        "group text-left p-3 rounded-md border transition-[border-color,background-color,box-shadow] duration-150 " +
        (selected
          ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_0_0_3px_var(--brand-soft)]"
          : "border-[var(--border-default)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]")
      }
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span
          className={
            "text-[13px] font-semibold tracking-tight truncate " +
            (selected
              ? "text-[var(--brand-fg-on-soft)]"
              : "text-[var(--text-primary)]")
          }
        >
          {group.name || group.userGroupName}
        </span>
        <span
          className={
            "shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors " +
            (selected
              ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--text-on-brand)]"
              : "border-[var(--border-strong)] bg-transparent text-transparent group-hover:border-[var(--text-tertiary)]")
          }
        >
          <Check size={10} strokeWidth={3} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-tertiary)] font-mono">
        {group.timePeriod != null && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> {formatTime(group.timePeriod)}
          </span>
        )}
        {group.quota != null && (
          <span className="flex items-center gap-1">
            <HardDrive size={11} /> {formatQuota(group.quota)}
          </span>
        )}
        {group.noOfDevice != null && (
          <span className="flex items-center gap-1">
            <Users size={11} /> {group.noOfDevice} dev
          </span>
        )}
        {group.voucherCount > 0 && (
          <Badge tone="brand" size="sm">
            {group.voucherCount} active
          </Badge>
        )}
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
        "h-9 w-9 flex items-center justify-center rounded-md " +
        "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
        "text-[var(--text-secondary)] " +
        "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] " +
        "active:bg-[var(--surface-pressed)] focus-ring transition-colors"
      }
    />
  );
}

/* ------------ Loading skeleton for the profile grid ---------------------- */
function ProfileSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[78px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] skeleton"
        />
      ))}
      <div className="col-span-full flex items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)] py-1">
        <Loader2 size={12} className="animate-spin" /> Loading profiles…
      </div>
    </div>
  );
}

/* ------------ Formatters -------------------------------------------------- */
function formatTime(minutes) {
  const m = Number(minutes || 0);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function formatQuota(mb) {
  const val = Number(mb || 0);
  if (val < 1024) return `${val} MB`;
  return `${(val / 1024).toFixed(1)} GB`;
}
