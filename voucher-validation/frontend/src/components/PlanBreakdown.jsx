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

import { useState } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { DataTable, Th, Td, StatusPill, EmptyState, CHART_SERIES } from "./ui";
import { PHONE_ROWS, PhoneBarRow, PhoneFacts, PhoneList, PhoneMore, usePhone } from "./ui/phone";

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
  // Phones list the first few plans and offer the rest; see PhoneMore.
  const [showAll, setShowAll] = useState(false);
  const phone = usePhone();
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
    // The illustration is 72px of a 375px screen and says nothing the sentence
    // does not; on a phone the sentence is the whole message.
    return <EmptyState className="max-sm:py-8" icon={phone ? null : PackageOpen} title="No voucher packages yet" description="Plans appear once vouchers are synced." />;
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
        <div className="flex items-start gap-2.5 px-4 sm:px-5 py-3.5 bg-[var(--warning-soft)] border-b border-[var(--warning-border)]">
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

      {/* A phone reads a plan as one row: the name, whether there is stock to
          sell, a bar for how much of the pool has gone, and the counts as small
          print. The eight columns as eight labelled lines were a 155px card a
          plan, and there can be ninety of them. */}
      <PhoneList>
        {rows.slice(0, showAll ? undefined : PHONE_ROWS).map((r, i) => (
          <PhoneBarRow
            key={r.name}
            label={
              // Inline content, not a flex row: PhoneBarRow's label cell clamps
              // to two lines, and an inline-flex child is one unbreakable box
              // that the clamp cannot wrap — the name was cut mid-word with no
              // ellipsis, and a phone has no hover to recover the rest. The
              // hanging indent (swatch 10px + gap 8px) starts a wrapped second
              // line under the name rather than under the swatch.
              <span className="block pl-[18px] -indent-[18px]">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-[3px] mr-2 align-middle indent-0"
                  style={{ background: color || CHART_SERIES[i % CHART_SERIES.length] }}
                />
                {r.name}
              </span>
            }
            value={<StockPill stock={r.stock} />}
            amount={r.sold}
            total={r.total}
            color={color || CHART_SERIES[i % CHART_SERIES.length]}
            onClick={onSelect ? () => onSelect(r.name) : undefined}
            title={onSelect ? `View ${r.name} vouchers` : undefined}
            sub={
              <PhoneFacts
                items={[
                  { v: `${fmtNum(r.sold)}/${fmtNum(r.total)}`, l: "sold" },
                  { v: fmtNum(r.active), l: "active" },
                  r.expired ? { v: fmtNum(r.expired), l: "expired" } : null,
                  { v: fmtNum(r.left), l: "left" },
                  r.usedMb ? { v: formatQuota(r.usedMb), l: "used" } : null,
                ]}
              />
            }
          />
        ))}
        {/* Directly under the rows it expands, above the totals that close the
            list — outside it the control read as if it belonged to the table.
            Inside a divide-y list the row above already draws the rule, so
            PhoneMore's own top border is dropped or the line doubles. Only
            rendered when there is something to expand: an empty wrapper would
            still be a divided child and draw a stray second rule. */}
        {rows.length > PHONE_ROWS && (
          <div className="[&>div]:border-t-0">
            <PhoneMore total={rows.length} expanded={showAll} onToggle={() => setShowAll((v) => !v)} noun="plans" />
          </div>
        )}
        {/* The panel's corners are rounded but it does not clip, so the tinted
            totals block rounds its own bottom (the card radius less its 1px
            border) instead of poking square corners past the card's. */}
        <div className="px-4 py-3 bg-[var(--bg-surface)] rounded-b-[11px]">
          <p className="text-[13px] font-semibold text-[var(--fg-primary)]">All plans</p>
          <PhoneFacts
            className="mt-1"
            items={[
              { v: `${fmtNum(t.sold)}/${fmtNum(t.total)}`, l: "sold" },
              { v: fmtNum(t.active), l: "active" },
              { v: fmtNum(t.expired), l: "expired" },
              { v: fmtNum(t.left), l: "left" },
              { v: formatQuota(t.usedMb), l: "used" },
            ]}
          />
        </div>
      </PhoneList>

      {/* There are ninety-odd plans across the estate — one per village per
          package — so this list runs far longer than the village one. Same
          contained scroll, same reasoning. */}
      <DataTable maxHeight={320} className="max-sm:hidden!">
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
              className={onSelect ? "cursor-pointer" : ""}
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
