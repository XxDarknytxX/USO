// src/services/campaignAudience.js
//
// Who an email campaign can reach: the customers in mpaisa_mappings, one row
// per INBOX.
//
// ── Where the people come from ───────────────────────────────────────────
// mpaisa_mappings maps an M-PAiSA wallet number to the email registered on it.
// It is the same table purchase receipts are sent from, so a campaign reaches
// exactly the inbox that already gets that customer's receipts. There is no
// other trustworthy source of customer email in this database (voucher contact
// fields are admin-typed and nearly always empty).
//
// ── Deduplication ────────────────────────────────────────────────────────
// Recipient identity is the email ADDRESS, extracted and lower-cased. Report
// imports are not validated, so the cell can hold "<ana@x.fj>", "ana@x.fj;",
// "mailto:ana@x.fj" or "Ana <ana@x.fj>" — which the mail library would happily
// deliver to ana@x.fj. Keyed on the raw text, each would be a separate "inbox"
// that the Excluded list does not match and that gets its own copy. So every
// address is parsed down to the bare address first (parseEmail), that bare
// address is what is keyed, excluded, stored and sent to, and anything that
// does not reduce to exactly one plain address is dropped.
//
// Email is not unique in the mapping — a family inbox can sit on several
// numbers — and one inbox gets one email. The number shown for it is the one
// that actually buys (most purchases, most recent), then an imported row over a
// hand-typed one.
//
// ── Purchases and villages ───────────────────────────────────────────────
// Joined on the LAST SEVEN DIGITS of the number, the key the receipt lookup,
// Manual Assistance and the Unmapped list already use (numbers arrive as
// 7771234, 6797771234 or 07771234). A purchase is a transaction with a
// payment_success event — the dashboards' definition of a sale — and its
// village is resolved exactly as billing resolves it (plan_key, then
// user_group_id, through portal_plan_configs).
//
// Done in JavaScript rather than one large SQL statement: the tables are small
// (hundreds of mappings), and the rules above read and test far more clearly
// here than as window functions over a collation-sensitive join.

// A plain address: no whitespace, no quotes, brackets, commas, semicolons or
// colons anywhere, one @, a dot in the domain.
const STRICT_EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"'.]{2,}$/;

/**
 * The bare address in a stored or typed value, or null. Unwraps the forms a
 * spreadsheet or copy-paste leaves behind — surrounding quotes, "mailto:",
 * "Name <address>", a trailing comma or semicolon — and rejects anything else,
 * including lists of addresses.
 */
export function parseEmail(raw) {
  let s = String(raw ?? "").trim();
  if (!s || s.length > 320) return null;
  s = s.replace(/^["']+|["']+$/g, "").trim();
  s = s.replace(/[,;]+$/, "").trim();
  const angle = /^[^<>]*<([^<>]+)>$/.exec(s);
  if (angle) s = angle[1].trim();
  s = s.replace(/^mailto:/i, "").trim();
  if (s.length > 254 || !STRICT_EMAIL_RE.test(s)) return null;
  return s;
}

/** The key an inbox is known by: its parsed address, lower-cased. "" if unusable. */
export const normEmail = (e) => (parseEmail(e) || "").toLowerCase();
export const isEmail = (e) => parseEmail(e) !== null;
const phoneKey = (p) => String(p ?? "").replace(/\D/g, "").slice(-7);

// Building the list aggregates the whole audit log, and the campaign screens ask
// for it repeatedly (the stats row, each search in the picker, each audience
// change). It is cached briefly and shared; anything that changes who is in it
// — an exclusion, an M-PAiSA mapping edit or upload — clears the cache, and the
// moment a campaign is actually sent reads it fresh.
const CONTACTS_TTL_MS = 30_000;
let contactsCache = null; // { at, promise }

export function invalidateContacts() {
  contactsCache = null;
}

/**
 * Every contact with a usable email, deduplicated by inbox, with purchase
 * history and suppression flag. Sorted: most recent buyers first.
 * Pass { fresh: true } where the answer must be exact (freezing an audience).
 * The returned array and objects are shared: callers must not mutate them.
 */
export function loadContacts(pool, { fresh = false } = {}) {
  if (!fresh && contactsCache && Date.now() - contactsCache.at < CONTACTS_TTL_MS) return contactsCache.promise;
  const promise = buildContacts(pool);
  contactsCache = { at: Date.now(), promise };
  promise.catch(() => {
    if (contactsCache?.promise === promise) contactsCache = null;
  });
  return promise;
}

async function buildContacts(pool) {
  const [mappings] = await pool.query(
    `SELECT number, email, source, updated_at
       FROM mpaisa_mappings
      WHERE email IS NOT NULL AND TRIM(email) <> ''`
  );
  const [suppressed] = await pool.query("SELECT email_norm FROM email_suppressions");
  const suppressedSet = new Set(suppressed.map((r) => r.email_norm));

  // Paid transactions, one row each, with the phone and plan that identify the
  // buyer and the village.
  const [txns] = await pool.query(
    `SELECT transaction_id,
            MAX(customer_phone) AS phone,
            MAX(plan_key)       AS plan_key,
            MAX(user_group_id)  AS user_group_id,
            MAX(CASE WHEN event_type = 'payment_success' THEN event_timestamp END) AS paid_at
       FROM portal_audit_logs
      WHERE transaction_id IS NOT NULL
      GROUP BY transaction_id
     HAVING paid_at IS NOT NULL AND phone IS NOT NULL`
  );
  const [plans] = await pool.query("SELECT plan_key, group_id, user_group_id FROM portal_plan_configs");
  // Ordered so a group shared by two villages always resolves to the same name.
  const [projects] = await pool.query("SELECT name, ruijie_group_id FROM network_projects ORDER BY sort_order, name");

  const byPlanKey = {};
  const byUserGroup = {};
  for (const p of plans) {
    if (p.plan_key) byPlanKey[p.plan_key] = p.group_id || null;
    if (p.user_group_id) byUserGroup[String(p.user_group_id)] = p.group_id || null;
  }
  const villageByGroup = new Map();
  for (const p of projects) {
    const g = p.ruijie_group_id == null ? "" : String(p.ruijie_group_id).trim();
    if (g && !villageByGroup.has(g)) villageByGroup.set(g, p.name);
  }

  // Purchase history per 7-digit key.
  const buyers = new Map();
  for (const t of txns) {
    const key = phoneKey(t.phone);
    if (key.length < 7) continue;
    const g = byPlanKey[t.plan_key] ?? byUserGroup[String(t.user_group_id)] ?? null;
    const group = g == null ? null : String(g).trim();
    const b = buyers.get(key) || { purchases: 0, lastPurchaseAt: null, groups: new Map() };
    b.purchases += 1;
    const at = t.paid_at ? new Date(t.paid_at) : null;
    if (at && (!b.lastPurchaseAt || at > b.lastPurchaseAt)) b.lastPurchaseAt = at;
    if (group) {
      const prev = b.groups.get(group);
      if (!prev || (at && at > prev)) b.groups.set(group, at || prev || new Date(0));
    }
    buyers.set(key, b);
  }

  // One entry per inbox.
  const byInbox = new Map();
  for (const m of mappings) {
    const address = parseEmail(m.email);
    if (!address) continue;
    const emailNorm = address.toLowerCase();
    const key = phoneKey(m.number);
    const b = key.length === 7 ? buyers.get(key) : null;
    const candidate = {
      number: String(m.number),
      // The parsed address, never the raw cell: this is what gets stored on the
      // recipient row and handed to the mail library.
      email: address,
      source: m.source,
      updatedAt: m.updated_at ? new Date(m.updated_at) : new Date(0),
      purchases: b?.purchases || 0,
      lastPurchaseAt: b?.lastPurchaseAt || null,
      groups: b?.groups || new Map(),
    };
    const entry = byInbox.get(emailNorm) || { emailNorm, numbers: [] };
    entry.numbers.push(candidate);
    byInbox.set(emailNorm, entry);
  }

  const rank = (a, b) =>
    (b.purchases > 0) - (a.purchases > 0) ||
    (b.lastPurchaseAt?.getTime() || 0) - (a.lastPurchaseAt?.getTime() || 0) ||
    (b.source === "import") - (a.source === "import") ||
    b.updatedAt.getTime() - a.updatedAt.getTime();

  const contacts = [];
  for (const entry of byInbox.values()) {
    entry.numbers.sort(rank);
    const best = entry.numbers[0];
    // Villages across every number on this inbox, most recent first.
    const groups = new Map();
    let purchases = 0;
    let lastPurchaseAt = null;
    // A number can appear twice under different spellings (7771234 and
    // 6797771234); count each 7-digit key once.
    const seenKeys = new Set();
    for (const n of entry.numbers) {
      const key = phoneKey(n.number);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      purchases += n.purchases;
      if (n.lastPurchaseAt && (!lastPurchaseAt || n.lastPurchaseAt > lastPurchaseAt)) lastPurchaseAt = n.lastPurchaseAt;
      for (const [g, at] of n.groups) {
        const prev = groups.get(g);
        if (!prev || at > prev) groups.set(g, at);
      }
    }
    const groupIds = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    contacts.push({
      emailNorm: entry.emailNorm,
      email: best.email,
      phone: best.number,
      phones: entry.numbers.map((n) => n.number),
      purchases,
      lastPurchaseAt,
      groupIds,
      villages: groupIds.map((g) => villageByGroup.get(g)).filter(Boolean),
      suppressed: suppressedSet.has(entry.emailNorm),
    });
  }

  contacts.sort(
    (a, b) =>
      (b.lastPurchaseAt?.getTime() || 0) - (a.lastPurchaseAt?.getTime() || 0) ||
      a.emailNorm.localeCompare(b.emailNorm)
  );
  return contacts;
}

/** A stored or submitted audience, normalised. Anything unrecognised is dropped. */
export function normaliseAudience(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const mode = a.mode === "selected" ? "selected" : "all";
  const groupIds = Array.isArray(a.groupIds)
    ? [...new Set(a.groupIds.map((g) => String(g ?? "").trim()).filter(Boolean))].slice(0, 500)
    : [];
  const selected = Array.isArray(a.selected)
    ? [...new Set(a.selected.map(normEmail).filter(Boolean))].slice(0, 5000)
    : [];
  return { mode, purchasersOnly: a.purchasersOnly === true, groupIds, selected };
}

/**
 * The contacts an audience reaches right now. Suppressed contacts are never
 * included; `suppressedExcluded` says how many were left out for that reason,
 * so the admin sees it instead of wondering why a number is smaller.
 */
export function resolveAudience(contacts, rawAudience) {
  const audience = normaliseAudience(rawAudience);
  let matched;
  if (audience.mode === "selected") {
    const wanted = new Set(audience.selected);
    matched = contacts.filter((c) => wanted.has(c.emailNorm));
  } else {
    matched = contacts.filter((c) => {
      if (audience.purchasersOnly && c.purchases < 1) return false;
      if (audience.groupIds.length && !c.groupIds.some((g) => audience.groupIds.includes(g))) return false;
      return true;
    });
  }
  const recipients = matched.filter((c) => !c.suppressed);
  return { audience, recipients, suppressedExcluded: matched.length - recipients.length };
}

export function searchContacts(contacts, { search = "", purchasersOnly = false, groupIds = [] } = {}) {
  const q = String(search || "").trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return contacts.filter((c) => {
    if (purchasersOnly && c.purchases < 1) return false;
    if (groupIds.length && !c.groupIds.some((g) => groupIds.includes(g))) return false;
    if (!q) return true;
    if (c.emailNorm.includes(q)) return true;
    if (digits.length >= 3 && c.phones.some((p) => String(p).includes(digits))) return true;
    return c.villages.some((v) => v.toLowerCase().includes(q));
  });
}
