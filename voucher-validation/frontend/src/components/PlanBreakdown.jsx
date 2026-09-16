// src/components/PlanBreakdown.jsx
// Complete per-plan voucher breakdown, grouped by plan name (package_name).
// Works for the global dashboard (all villages merged by plan name) and a
// single village (stats already scoped by groupId). Shows, per plan:
//   Total · Sold · Active · Expired · Left (unused/available) · Data used
// and flags plans that are running LOW on sellable stock so ops knows to
// generate more of that voucher type.
//
// It renders the restock notice and a bare DataTable with no card chrome of its
// own: the caller wraps it in an unpadded Panel, so the table's header row sits
// flush against the panel head instead of a card inside a card.

import { AlertTriangle, PackageOpen } from "lucide-react";
import { DataTable, Th, Td, StatusPill, EmptyState, CHART_SERIES } from "./ui";

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
  // Null cycles the shared chart palette so a plan carries the same hue here as
  // it does in the revenue donut. A caller may still pin one colour.
  color = null,
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
    return <EmptyState icon={PackageOpen} title="No voucher packages yet" description="Plans appear once vouchers are synced." />;
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
      {/* Restock notice — the one thing on this table that needs acting on, so
          it sits above the header rather than inside a Stock column footnote. */}
      {lowPlans.length > 0 && (
        <div className="flex items-start gap-2.5 px-5 py-3.5 bg-[var(--warning-soft)] border-b border-[var(--warning-border)]">
          <AlertTriangle size={15} className="text-[var(--warning-fg)] mt-0.5 shrink-0" />
          <div className="text-[12.5px] text-[var(--warning-fg)] leading-relaxed">
            <span className="font-semibold font-display">
              {lowPlans.length} plan{lowPlans.length === 1 ? "" : "s"} need restocking.
            </span>{" "}
            {lowPlans
              .map((r) => `${r.name} (${r.left === 0 ? "sold out" : `${fmtNum(r.left)} left`})`)
              .join(", ")}
            . Generate more of {lowPlans.length === 1 ? "this voucher type" : "these voucher types"} in Ruijie Cloud.
          </div>
        </div>
      )}

      {/* There are ninety-odd plans across the estate — one per village per
          package — so this list runs far longer than the village one. Same
          contained scroll, same reasoning. */}
      <DataTable maxHeight={320}>
        <thead>
          <tr>
            <Th>Plan</Th>
            <Th align="right">Total</Th>
            <Th align="right">Sold</Th>
            <Th align="right">Active</Th>
            <Th align="right">Expired</Th>
            <Th align="right">Left</Th>
            <Th align="right">Data used</Th>
            <Th>Stock</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.name}
              onClick={onSelect ? () => onSelect(r.name) : undefined}
              title={onSelect ? `View ${r.name} vouchers` : undefined}
              className={onSelect ? "cursor-pointer" : undefined}
            >
              <Td strong>
                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    style={{ background: color || CHART_SERIES[i % CHART_SERIES.length] }}
                  />
                  <span className="truncate">{r.name}</span>
                </span>
              </Td>
              <Td align="right" className="tabular-nums">{fmtNum(r.total)}</Td>
              <Td align="right" className="tabular-nums">
                <span className="font-semibold text-[var(--fg-primary)]">{fmtNum(r.sold)}</span>
                <span className="text-[var(--fg-muted)] ml-1">· {r.soldPct}%</span>
              </Td>
              <Td align="right" className="tabular-nums text-[var(--success-fg)] font-semibold">{fmtNum(r.active)}</Td>
              <Td align="right" className="tabular-nums" muted>{fmtNum(r.expired)}</Td>
              <Td align="right" className="tabular-nums">
                <span
                  className="font-semibold"
                  style={{
                    color:
                      r.stock === "out"
                        ? "var(--danger-fg)"
                        : r.stock === "low"
                        ? "var(--warning-fg)"
                        : "var(--fg-primary)",
                  }}
                >
                  {fmtNum(r.left)}
                </span>
              </Td>
              <Td align="right" className="tabular-nums">{formatQuota(r.usedMb)}</Td>
              <Td>
                <StockPill stock={r.stock} />
              </Td>
            </tr>
          ))}
          {/* Totals live in the tbody, not a tfoot: .sf-table only pads
              `tbody td`, so a footer row would sit unpadded and out of grid. */}
          <tr className="bg-[var(--bg-surface)]">
            <Td strong>All plans</Td>
            <Td align="right" strong className="tabular-nums">{fmtNum(t.total)}</Td>
            <Td align="right" strong className="tabular-nums">{fmtNum(t.sold)}</Td>
            <Td align="right" strong className="tabular-nums">{fmtNum(t.active)}</Td>
            <Td align="right" strong className="tabular-nums">{fmtNum(t.expired)}</Td>
            <Td align="right" strong className="tabular-nums">{fmtNum(t.left)}</Td>
            <Td align="right" strong className="tabular-nums">{formatQuota(t.usedMb)}</Td>
            <Td />
          </tr>
        </tbody>
      </DataTable>
    </div>
  );
}

function StockPill({ stock }) {
  if (stock === "out") return <StatusPill tone="danger">Sold out</StatusPill>;
  if (stock === "low") return <StatusPill tone="warning">Low</StatusPill>;
  return <StatusPill tone="success">OK</StatusPill>;
}
