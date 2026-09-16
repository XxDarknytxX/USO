// src/services/estateScope.js
//
// The ESTATE DEFAULT — app_settings.global_visible_villages — read in one place.
//
// It decides which villages every viewer, engineer and billing account sees,
// and which villages the monthly bill covers. It used to be parsed separately
// by attachScope, the preferences endpoint and the billing service; three
// copies of a rule that decides who sees what is two chances for them to drift.
//
// What is stored, and what it means:
//   no row              "unset"      — never saved. Every active village.
//   row, NULL value     "all"        — saved with every village ticked. Every
//                                      active village, INCLUDING ones added later.
//   "[1,2,3]"           "list"       — exactly those villages.
//   "[]"                "none"       — cleared on purpose. No village.
//   anything else       "unreadable" — treated as every village, so a corrupt
//                                      setting widens the view rather than taking
//                                      the console away from everyone at once.
//                                      The writer validates, so this should not
//                                      occur; it is reported, not hidden.
//
// "unset" and "all" behave the same. They are kept apart because they are not
// the same statement: one is a decision, the other is the absence of one, and
// a page that says "estate default: every village" should be able to say which.
//
// A database error is THROWN, never folded into "every village". Each caller
// picks its own failure: attachScope fails closed, billing refuses to bill.

const KEY = "global_visible_villages";

function parseIds(value) {
  if (value == null || String(value).trim() === "") return { mode: "all", ids: null };
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return { mode: "unreadable", ids: null };
    const ids = [...new Set(parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    return ids.length ? { mode: "list", ids } : { mode: "none", ids: [] };
  } catch {
    return { mode: "unreadable", ids: null };
  }
}

/**
 * @returns {Promise<{
 *   mode: "unset"|"all"|"list"|"none"|"unreadable",
 *   ids: number[]|null,          // null = no restriction
 *   updatedAt: Date|null,
 *   updatedById: number|null,
 *   updatedByName: string|null,
 * }>}
 */
export async function readEstateDefault(pool) {
  let row;
  try {
    [[row]] = await pool.query(
      `SELECT s.setting_value, s.updated_at, s.updated_by, u.name AS updated_by_name, u.email AS updated_by_email
         FROM app_settings s
         LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.setting_key = ?`,
      [KEY]
    );
  } catch (e) {
    // An older app_settings without updated_at/updated_by still has the value,
    // and the value is what matters. Anything else is a real failure.
    if (e?.code !== "ER_BAD_FIELD_ERROR") throw e;
    [[row]] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key = ?", [KEY]);
  }

  if (!row) {
    return { mode: "unset", ids: null, updatedAt: null, updatedById: null, updatedByName: null };
  }
  const { mode, ids } = parseIds(row.setting_value);
  return {
    mode,
    ids,
    updatedAt: row.updated_at ?? null,
    updatedById: row.updated_by ?? null,
    updatedByName: row.updated_by_name || (row.updated_by_email ? String(row.updated_by_email).split("@")[0] : null),
  };
}

/**
 * Validates a value about to be written as the estate default. Returns the
 * canonical string to store (or null for "every village"), or throws with
 * code BAD_ESTATE_DEFAULT. Keeps "unreadable" a state that cannot be written
 * through the API.
 */
export function canonicalEstateValue(value) {
  const bad = () =>
    Object.assign(new Error("The estate default must be a list of village ids"), { code: "BAD_ESTATE_DEFAULT" });
  // Only null, undefined or a BLANK STRING mean "every village". The check is
  // by type: String([]) is "", and an empty array — "no villages" — must never
  // be read as its opposite.
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  let parsed;
  if (Array.isArray(value)) parsed = value;
  else if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw bad();
    }
  } else throw bad();
  if (!Array.isArray(parsed)) throw bad();
  const ids = parsed.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw bad();
  return JSON.stringify([...new Set(ids)]);
}

export const ESTATE_DEFAULT_KEY = KEY;
