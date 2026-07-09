// src/components/PlanBreakdown.jsx
// Complete per-plan voucher breakdown, grouped by plan name (package_name).
// Works for the global dashboard (all villages merged by plan name) and a
// single village (stats already scoped by groupId). Shows, per plan:
//   Total · Sold · Active · Expired · Left (unused/available) · Data used
// and flags plans that are running LOW on sellable stock so ops knows to
// generate more of that voucher type.
import { AlertTriangle, PackageOpen } from "lucide-react";

const fmtNum = (n) => Number(n || 0).toLocaleString();

function defaultFmtQuota(mb) {
  const v = Number(mb || 0);
  if (v < 1024) return `${Math.round(v)} MB`;
  const gb = v / 1024;
  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

// A plan is "low" when its sellable stock (unused vouchers) is ≤ lowPct of the
// pool (default 15%), and "out" when none remain.
function stockOf(left, total, lowPct) {
  if (total > 0 && left === 0) return "out";
  if (total > 0 && left / total <= lowPct) return "low";
  return "ok";
}

export default function PlanBreakdown({
  packages = [],
  formatQuota = defaultFmtQuota,
  onSelect,
  lowPct = 0.15,
  color = "var(--brand)",
}) {
  const rows = packages
    .map((p) => {
      const total = Number(p.total || 0);
      const active = Number(p.active || 0);
      const expired = Number(p.expired || 0);
      const inactive = Number(p.inactive || 0);
      const left = Number(p.unused || 0); // status '1' — available to sell
      const sold = Math.max(0, total - left); // claimed/used (active+expired+inactive)
      const usedMb = Number(p.total_used_quota_mb || 0);
      const quotaMb = Number(p.total_quota_mb || 0);
      return {
        name: p.package_name || "Unknown",
        total, active, expired, inactive, left, sold, usedMb, quotaMb,
        soldPct: total ? Math.round((sold / total) * 100) : 0,
        stock: stockOf(left, total, lowPct),
      };
    })
    .sort((a, b) => b.total - a.total);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <PackageOpen size={22} className="text-[var(--text-quaternary)] mb-2" />
        <p className="text-[13px] text-[var(--text-tertiary)]">No voucher packages yet</p>
      </div>
    );
  }

  const t = rows.reduce(
    (a, r) => ({
      total: a.total + r.total, sold: a.sold + r.sold, active: a.active + r.active,
      expired: a.expired + r.expired, left: a.left + r.left, usedMb: a.usedMb + r.usedMb,
    }),
    { total: 0, sold: 0, active: 0, expired: 0, left: 0, usedMb: 0 }
  );
  const lowPlans = rows.filter((r) => r.stock !== "ok");

  return (
    <div>
      {/* Restock alert */}
      {lowPlans.length > 0 && (
        <div className="flex items-start gap-2.5 mb-3 px-3.5 py-2.5 rounded-lg bg-[var(--warning-soft)] border border-transparent">
          <AlertTriangle size={15} className="text-[var(--warning-fg)] mt-0.5 shrink-0" />
          <div className="text-[12.5px] text-[var(--warning-fg)] leading-relaxed">
            <span className="font-semibold">
              {lowPlans.length} plan{lowPlans.length === 1 ? "" : "s"} need restocking.
            </span>{" "}
            {lowPlans
              .map((r) => `${r.name} (${r.left === 0 ? "sold out" : `${fmtNum(r.left)} left`})`)
              .join(", ")}
            . Generate more of {lowPlans.length === 1 ? "this voucher type" : "these voucher types"} in Ruijie Cloud.
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left border-b border-[var(--border-default)] bg-[var(--surface-sunken)]">
              <Th className="text-left">Plan</Th>
              <Th>Total</Th>
              <Th>Sold</Th>
              <Th>Active</Th>
              <Th>Expired</Th>
              <Th>Left</Th>
              <Th>Data used</Th>
              <Th className="text-left">Stock</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {rows.map((r) => (
              <tr
                key={r.name}
                onClick={onSelect ? () => onSelect(r.name) : undefined}
                className={
                  "transition-colors " +
                  (onSelect ? "cursor-pointer hover:bg-[var(--surface-hover)]" : "")
                }
              >
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 font-medium text-[var(--text-primary)] truncate">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    {r.name}
                  </span>
                </td>
                <Td>{fmtNum(r.total)}</Td>
                <Td>
                  <span className="text-[var(--text-primary)] font-semibold">{fmtNum(r.sold)}</span>
                  <span className="text-[var(--text-quaternary)] ml-1">· {r.soldPct}%</span>
                </Td>
                <Td className="text-[var(--success-fg)]">{fmtNum(r.active)}</Td>
                <Td className="text-[var(--text-tertiary)]">{fmtNum(r.expired)}</Td>
                <Td>
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        r.stock === "out"
                          ? "var(--error, #dc2626)"
                          : r.stock === "low"
                          ? "var(--warning-fg)"
                          : "var(--text-primary)",
                    }}
                  >
                    {fmtNum(r.left)}
                  </span>
                </Td>
                <Td className="text-[var(--text-secondary)]">{formatQuota(r.usedMb)}</Td>
                <td className="px-3 py-2.5">
                  <StockBadge stock={r.stock} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border-default)] bg-[var(--surface-sunken)] font-semibold text-[var(--text-primary)]">
              <td className="px-3 py-2.5">All plans</td>
              <Td>{fmtNum(t.total)}</Td>
              <Td>{fmtNum(t.sold)}</Td>
              <Td>{fmtNum(t.active)}</Td>
              <Td>{fmtNum(t.expired)}</Td>
              <Td>{fmtNum(t.left)}</Td>
              <Td>{formatQuota(t.usedMb)}</Td>
              <td className="px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = "text-right" }) {
  return (
    <th className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-quaternary)] ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "text-[var(--text-secondary)]" }) {
  return <td className={`px-3 py-2.5 text-right tabular-nums ${className}`}>{children}</td>;
}

function StockBadge({ stock }) {
  if (stock === "out") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[var(--error-soft,rgba(220,38,38,0.12))] text-[var(--error,#dc2626)]">
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> Sold out
      </span>
    );
  }
  if (stock === "low") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[var(--warning-soft)] text-[var(--warning-fg)]">
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> Low
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-[var(--success-soft,rgba(22,163,74,0.1))] text-[var(--success-fg)]">
      <span className="w-1.5 h-1.5 rounded-full bg-current" /> OK
    </span>
  );
}
