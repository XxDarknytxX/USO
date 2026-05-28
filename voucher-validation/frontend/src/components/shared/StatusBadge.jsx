// src/components/shared/StatusBadge.jsx
// Pill badge for Ruijie voucher status codes.
//   '1' = Unused (not yet activated)  — info
//   '2' = In-use (active / connected) — success
//   '3' = Expired                     — danger
//   '0' = Inactive (fallback)         — neutral
//
// Built on the design-system Badge primitive so it picks up theme tokens
// (light/dark mode) and matches the rest of the admin chrome.

import { Badge } from "../ui";

const STATUS = {
  "1": { label: "Unused", tone: "info" },
  "2": { label: "Active", tone: "success" },
  "3": { label: "Expired", tone: "danger" },
  "0": { label: "Inactive", tone: "neutral" },
};

const DOT_BG = {
  info: "bg-[var(--info-fg)]",
  success: "bg-[var(--success-fg)]",
  danger: "bg-[var(--danger-fg)]",
  neutral: "bg-[var(--text-quaternary)]",
};

export default function StatusBadge({ status, className = "" }) {
  const cfg = STATUS[String(status)] || STATUS["0"];
  return (
    <Badge
      tone={cfg.tone}
      className={className}
      icon={
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${DOT_BG[cfg.tone]}`}
        />
      }
    >
      {cfg.label}
    </Badge>
  );
}
