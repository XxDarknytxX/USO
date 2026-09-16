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
// Active villages in the ESTATE DEFAULT (app_settings.global_visible_villages),
// the same set every viewer and engineer sees. That is where test villages are
// excluded, and billing a test village for a deficit would be wrong. It is the
// estate default and NOT the administrator's personal view: a bill must not
// change because the person looking at it ticked a box for themselves.
//
// A village with no Ruijie group cannot have any sale attributed to it, so its
// revenue would read as zero and its deficit as the full target — a figure
// that looks exact and is not. Such villages are listed separately and kept out
// of both totals.
//
// Revenue that resolves to no village, or to one outside the estate default, is
// reported too, so the billed totals reconcile with the dashboard's instead of
// quietly disagreeing.

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

/** The estate default: an array of village ids, or null for every village. */
async function estateVillageIds(pool) {
  try {
    const [[row]] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'global_visible_villages'"
    );
    if (!row?.setting_value) return null;
    const parsed = JSON.parse(row.setting_value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : null;
  } catch {
    return null;
  }
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

export async function computeBilling(pool, { month, now = new Date() } = {}) {
  const period = resolveMonth(month, now);
  const target = await readTarget(pool);
  const targetCents = cents(target);

  // Villages to bill.
  const estate = await estateVillageIds(pool);
  const [projects] = await pool.query(
    `SELECT id, name, hostname, ruijie_group_id, is_active
       FROM network_projects
      ORDER BY sort_order, name`
  );
  const inEstate = (p) => Number(p.is_active) === 1 && (estate == null || estate.includes(Number(p.id)));
  const billed = projects.filter(inEstate);
  const groupToVillage = new Map();
  for (const p of billed) {
    const g = p.ruijie_group_id == null ? "" : String(p.ruijie_group_id).trim();
    if (g) groupToVillage.set(g, p);
  }

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
  for (const t of txns) {
    const amt = Number(t.amount) || 0;
    if (!(amt > 0)) continue;
    const grp = resolveGroup(t);
    if (grp == null) { unattributedCents += cents(amt); unattributedTxns++; continue; }
    const village = groupToVillage.get(String(grp));
    if (!village) { outsideCents += cents(amt); outsideTxns++; continue; }
    revenueCents.set(village.id, (revenueCents.get(village.id) || 0) + cents(amt));
    txnCount.set(village.id, (txnCount.get(village.id) || 0) + 1);
  }

  const rows = [];
  const noGroup = [];
  for (const p of billed) {
    const g = p.ruijie_group_id == null ? "" : String(p.ruijie_group_id).trim();
    if (!g) {
      noGroup.push({ projectId: p.id, name: p.name, hostname: p.hostname });
      continue;
    }
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
      unattributed: { revenue: dollars(unattributedCents), transactions: unattributedTxns },
      outsideEstate: { revenue: dollars(outsideCents), transactions: outsideTxns },
    },
  };
}
