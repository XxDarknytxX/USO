// src/components/ui/ConfirmDialog.jsx
// Compact confirm dialog built on Modal. Use for delete confirmations.

import { AlertTriangle, Info } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";

export default function ConfirmDialog({
  open,
  title = "Confirm action",
  message = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger", // "danger" | "info"
  loading = false,
  onConfirm,
  onCancel,
}) {
  const isDanger = variant === "danger";
  const Icon = isDanger ? AlertTriangle : Info;

  return (
    <Modal open={open} onClose={onCancel} width="sm">
      <div className="px-7 pt-7 pb-2">
        <div className="flex items-start gap-4">
          <span
            className={
              "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center " +
              (isDanger
                ? "bg-[var(--danger-soft)] text-[var(--danger-fg)] border border-[var(--brand-soft-hover)]"
                : "bg-[var(--info-soft)] text-[var(--info-fg)] border border-transparent")
            }
          >
            <Icon size={18} strokeWidth={1.75} />
          </span>
          <div className="flex flex-col min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)] leading-tight">
              {title}
            </h2>
            <p className="text-[13px] text-[var(--text-tertiary)] mt-1 leading-relaxed">
              {message}
            </p>
          </div>
        </div>
      </div>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={isDanger ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
