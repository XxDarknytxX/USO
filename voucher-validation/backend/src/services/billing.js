// src/services/billing.js
//
// Monthly billing: each village's revenue for one calendar month against a
// per-village monthly target (FJD 168 by default). Villages below it carry a
// DEFICIT, the amount short of the target; villages above it bring in
// ADDITIONAL revenue, the amount over it.
//
// ── Where the numbers come from ──────────────────────────────────────────
// Exactly the transactions and village attribution the dashboard's revenue
// breakdown uses (portalConfigController getBreakdown), so a village's billing
// revenue and its dashboard revenue are the same number:
//   • a sale is a transaction_id with a payment_success event in the month
//   • its amount is MAX(amount) across that transaction's rows
//   • amounts that are not positive are skipped
//   • its village is resolved from plan_key first, then user_group_id, through
//     portal_plan_configs, onto network_projects.ruijie_group_id
// Keep the two in step. There is a test asserting they agree.
//
// Summed in integer CENTS, not floats. The dashboard can add floats and round
// once for display; a figure that is billed should not be able to drift by a
// cent because 0.1 + 0.2 is not 0.3.
//
// ── Which villages ───────────────────────────────────────────────────────
// The same villages the reader's DASHBOARD shows. Billing follows the console's
// scope exactly as the dashboards do:
//   • a village picked in the switcher      -> that village
//   • else the reader's own "Your view"      -> those villages
//   • else the ESTATE DEFAULT                -> app_settings.global_visible_villages,
//                                               read through services/estateScope.js
// The page resolves the first two (it holds them, as the dashboards do) and
// passes them as `selection`. With no selection the server bills the estate
// default itself, so the default case never depends on a copy in the browser.
//
// A selection never widens what a non-administrator may see: it is clamped to
// req.scope (their estate default). An administrator is unrestricted, which is
// the point of an admin's view — looking at a test village for an afternoon.
//
// If the estate default cannot be READ, the bill is refused (the error is
// thrown). Falling back to "every village" would put test villages on a bill
// because of a transient database error.
//
// Every village lands in exactly one place — billed, or excluded for a reason:
//   inactive               switched off under Network
//   not_in_estate_default  left out of the estate default (no selection)
//   not_in_view            left out of the reader's selection
//   no_ruijie_group        no group, so no sale can be attributed; its revenue
//                          would read as zero and its deficit as the full
//                          target — a figure that looks exact and is not
//   shared_group           two billable villages on ONE Ruijie group. A sale
//                          cannot be told apart between them, and crediting all
//                          of it to whichever came last in a Map would bill one
//                          village's revenue as another's. Both are left out and
//                          the group's revenue is reported, not guessed.
//
// Revenue that resolves to no village, to a village not on this bill, or to a
// shared group is reported too, so the billed totals reconcile with the
// dashboard's instead of quietly disagreeing.
//
// Shared groups are detected among the villages being BILLED. A village left
// out (a test village given the main site's group by the boot backfill, say)
// does not knock a real village off the bill.
//
// ── Who sees what ────────────────────────────────────────────────────────
// Administrators get the full picture. A billing account gets the same figures
// for the same villages, but is never told about villages outside its own scope
// (names or revenue): it cannot see those anywhere else in the console either.

import { readEstateDefault } from "./estateScope.js";

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => Math.round(c) / 100;
const pad = (n) => String(n).padStart(2, "0");
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export const DEFAULT_TARGET = 168;

export async function readTarget(pool) {
  try {
    const [[row]] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'billing_monthly_target'"
    );
    const n = Number(row?.setting_value);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
}

export async function writeTarget(pool, value, userId) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) {
    throw Object.assign(new Error("The target must be a positive amount"), { code: "BAD_TARGET" });
  }
  const rounded = Math.round(n * 100) / 100;
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, setting_type, description, updated_by)
     VALUES ('billing_monthly_target', ?, 'number', 'Monthly revenue target per village (FJD).', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [String(rounded), userId ?? null]
  );
  return rounded;
}


/**
 * The month being billed. A YYYY-MM string, or by default the most recent
 * COMPLETE month — a bill for a month still in progress reads every village as
 * short, and the page should not open on that.
 */
export function resolveMonth(param, now = new Date()) {
  let y, m;
  if (/^\d{4}-\d{2}$/.test(String(param || ""))) {
    [y, m] = String(param).split("-").map(Number);
  } else {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    y = prev.getFullYear();
    m = prev.getMonth() + 1;
  }
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  const key = ym(from);
  const currentKey = ym(now);
  const daysInMonth = new Date(y, m, 0).getDate();
  const inProgress = key === currentKey;
  const future = key > currentKey;
  return {
    key, from, to, daysInMonth, inProgress, future,
    daysElapsed: inProgress ? now.getDate() : future ? 0 : daysInMonth,
  };
}

/** The last `count` months ending with the current one, newest first. */
export function recentMonths(count = 12, now = new Date()) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: ym(d), label: d.toLocaleString("en", { month: "long", year: "numeric" }) });
  }
  return out;
}

/**
 * @param pool
 * @param {object}  opts
 * @param {string}  [opts.month]   YYYY-MM; default the last complete month
 * @param {Date}    [opts.now]
 * @param {object}  [opts.scope]   req.scope for a non-admin. With no selection
 *   it is resolved from the same estate default the bill reads, so it names the
 *   same villages; if they disagree (the setting changed between the two reads)
 *   the bill is refused with code SCOPE_CHANGED rather than returned with
 *   villages silently missing. With a selection, the selection is clamped to it.
 * @param {number[]|null} [opts.selection]  the reader's view (switcher village
 *   or "Your view"), or null for the estate default.
 * @param {boolean} [opts.detail]  true for an administrator: names every
 *   excluded village and reports revenue from villages not on the bill.
 */
export async function computeBilling(pool, { month, now = new Date(), scope = null, selection = null, detail = false } = {}) {
  const period = resolveMonth(month, now);
  const target = await readTarget(pool);
  const targetCents = cents(target);

  // Villages to bill. readEstateDefault THROWS on a database error, and the
  // bill is refused rather than widened to every village.
  const estate = await readEstateDefault(pool);
  const [projects] = await pool.query(
    `SELECT id, name, hostname, ruijie_group_id, is_active
       FROM network_projects
      ORDER BY sort_order, name`
  );
  const restrictTo = scope?.isViewer ? new Set((scope.projectIds || []).map(Number)) : null;
  const selected = Array.isArray(selection) ? new Set(selection.map(Number)) : null;
  const groupOf = (p) => (p.ruijie_group_id == null ? "" : String(p.ruijie_group_id).trim());

  // Classify every village exactly once.
  const excluded = [];
  const candidates = [];
  for (const p of projects) {
    const id = Number(p.id);
    const base = { projectId: p.id, name: p.name, hostname: p.hostname };
    if (Number(p.is_active) !== 1) excluded.push({ ...base, reason: "inactive" });
    else if (selected) {
      // The reader's own view. Outside a non-admin's scope comes first, so a
      // village they may not see is never named to them — not even as "not in
      // your view".
      if (restrictTo && !restrictTo.has(id)) excluded.push({ ...base, reason: "outside_your_scope" });
      else if (!selected.has(id)) excluded.push({ ...base, reason: "not_in_view" });
      else if (!groupOf(p)) excluded.push({ ...base, reason: "no_ruijie_group" });
      else candidates.push(p);
    }
    else if (estate.ids != null && !estate.ids.includes(id)) excluded.push({ ...base, reason: "not_in_estate_default" });
    else if (restrictTo && !restrictTo.has(id)) {
      // The request's scope and the estate default are read from the same
      // setting, so they can only disagree if it changed in between. Billing
      // the reader a quietly partial list would be worse than asking again.
      throw Object.assign(
        new Error("The estate default changed while the bill was being prepared — please reload"),
        { code: "SCOPE_CHANGED" }
      );
    }
    else if (!groupOf(p)) excluded.push({ ...base, reason: "no_ruijie_group" });
    else candidates.push(p);
  }
  const byGroup = new Map();
  for (const p of candidates) {
    const g = groupOf(p);
    byGroup.set(g, [...(byGroup.get(g) || []), p]);
  }
  const billed = [];
  const groupToVillage = new Map();
  const sharedGroups = new Set();
  for (const [g, villages] of byGroup) {
    if (villages.length === 1) {
      billed.push(villages[0]);
      groupToVillage.set(g, villages[0]);
      continue;
    }
    sharedGroups.add(g);
    for (const p of villages) {
      excluded.push({
        projectId: p.id, name: p.name, hostname: p.hostname, reason: "shared_group", groupId: g,
        sharedWith: villages.filter((o) => o !== p).map((o) => o.name),
      });
    }
  }
  // Keep the page's order (sort_order, name) rather than the group map's.
  const order = new Map(projects.map((p, i) => [p.id, i]));
  billed.sort((a, b) => order.get(a.id) - order.get(b.id));
  excluded.sort((a, b) => order.get(a.projectId) - order.get(b.projectId));

  // Sales in the month — the dashboard's definition, verbatim.
  const [txns] = await pool.query(
    `SELECT l.transaction_id,
            MAX(l.amount)        AS amount,
            MAX(l.plan_key)      AS plan_key,
            MAX(l.user_group_id) AS user_group_id
       FROM portal_audit_logs l
       JOIN (SELECT DISTINCT transaction_id
               FROM portal_audit_logs
              WHERE event_type='payment_success' AND transaction_id IS NOT NULL
                AND event_timestamp >= ? AND event_timestamp < ?) w
         ON w.transaction_id = l.transaction_id
      GROUP BY l.transaction_id`,
    [period.from, period.to]
  );
  const [plans] = await pool.query(
    "SELECT plan_key, group_id, user_group_id FROM portal_plan_configs"
  );
  const byPlanKey = {}, byUserGroup = {};
  for (const p of plans) {
    if (p.plan_key) byPlanKey[p.plan_key] = p.group_id || null;
    if (p.user_group_id) byUserGroup[String(p.user_group_id)] = p.group_id || null;
  }
  const resolveGroup = (t) => byPlanKey[t.plan_key] ?? byUserGroup[String(t.user_group_id)] ?? null;

  const revenueCents = new Map(); // village id -> cents
  const txnCount = new Map();
  let unattributedCents = 0, unattributedTxns = 0;
  let outsideCents = 0, outsideTxns = 0;
  let sharedCents = 0, sharedTxns = 0;
  for (const t of txns) {
    const amt = Number(t.amount) || 0;
    if (!(amt > 0)) continue;
    const grp = resolveGroup(t);
    if (grp == null) { unattributedCents += cents(amt); unattributedTxns++; continue; }
    if (sharedGroups.has(String(grp).trim())) { sharedCents += cents(amt); sharedTxns++; continue; }
    const village = groupToVillage.get(String(grp).trim());
    if (!village) { outsideCents += cents(amt); outsideTxns++; continue; }
    revenueCents.set(village.id, (revenueCents.get(village.id) || 0) + cents(amt));
    txnCount.set(village.id, (txnCount.get(village.id) || 0) + 1);
  }

  const rows = [];
  for (const p of billed) {
    const g = groupOf(p);
    const rc = revenueCents.get(p.id) || 0;
    const delta = rc - targetCents;
    rows.push({
      projectId: p.id,
      name: p.name,
      hostname: p.hostname,
      groupId: g,
      revenue: dollars(rc),
      transactions: txnCount.get(p.id) || 0,
      // Share of the target reached, capped for display; the exact figure is revenue.
      pctOfTarget: targetCents > 0 ? Math.round((rc / targetCents) * 1000) / 10 : 0,
      deficit: delta < 0 ? dollars(-delta) : 0,
      excess: delta > 0 ? dollars(delta) : 0,
      _delta: delta,
    });
  }

  // Strictly below the target is a deficit. Meeting it exactly is not short,
  // so it sits with the villages at or above target, contributing nothing extra.
  const under = rows.filter((r) => r._delta < 0).sort((a, b) => a._delta - b._delta);
  const over = rows.filter((r) => r._delta >= 0).sort((a, b) => b._delta - a._delta);
  const sum = (list, key) => dollars(list.reduce((s, r) => s + cents(r[key]), 0));

  const deficitTotal = sum(under, "deficit");
  const excessTotal = sum(over, "excess");
  const strip = ({ _delta, ...r }) => r;

  // What a non-administrator is told about villages that were not billed: only
  // the ones it can see anyway. A village outside its scope is not named to it,
  // and inactive villages are not part of its console at all.
  const visibleReasons = new Set(["no_ruijie_group", "shared_group", "not_in_view"]);
  const shownExcluded = detail ? excluded : excluded.filter((x) => visibleReasons.has(x.reason));
  const noGroup = shownExcluded
    .filter((x) => x.reason === "no_ruijie_group")
    .map(({ projectId, name, hostname }) => ({ projectId, name, hostname }));

  return {
    month: period.key,
    inProgress: period.inProgress,
    future: period.future,
    daysElapsed: period.daysElapsed,
    daysInMonth: period.daysInMonth,
    months: recentMonths(12, now),
    target,
    currency: "FJD",
    under: under.map(strip),
    over: over.map(strip),
    noGroup,
    scope: {
      // "selection" when the reader's view was billed, "estate_default" when not.
      source: selected ? "selection" : "estate_default",
      // The estate default is reported either way, so the page can say what
      // everyone else's bill follows.
      mode: estate.mode,
      setAt: estate.updatedAt,
      setBy: detail ? estate.updatedByName : null,
      estateCount: estate.ids == null ? null : estate.ids.length,
      billedCount: billed.length,
      billedIds: billed.map((p) => p.id),
      // Every village in exactly one of billedIds / excluded — for an admin.
      totalVillages: detail ? projects.length : null,
      excluded: shownExcluded,
    },
    totals: {
      villages: rows.length,
      underCount: under.length,
      overCount: over.length,
      deficit: deficitTotal,
      excess: excessTotal,
      // Additional revenue less the shortfall across the billed villages.
      net: dollars(cents(excessTotal) - cents(deficitTotal)),
      revenue: sum(rows, "revenue"),
      targetTotal: dollars(targetCents * rows.length),
      // Estate-wide leftovers: revenue that is on no bill. Administrators only.
      unattributed: detail ? { revenue: dollars(unattributedCents), transactions: unattributedTxns } : null,
      // Revenue from villages that are real but not on THIS bill (outside the
      // view or the estate default, inactive, or without a village of their own).
      outsideBill: detail ? { revenue: dollars(outsideCents), transactions: outsideTxns } : null,
      sharedGroup: detail || sharedGroups.size
        ? { revenue: dollars(sharedCents), transactions: sharedTxns }
        : null,
    },
  };
}
