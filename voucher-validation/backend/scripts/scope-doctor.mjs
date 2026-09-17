#!/usr/bin/env node
// scripts/scope-doctor.mjs
//
// Which villages does the console think are in scope, and why?
//
//     node scripts/scope-doctor.mjs                       # the estate default
//     node scripts/scope-doctor.mjs someone@example.com   # ... and that account's own view
//
// Read-only. Settles "the estate default IS saved" against "the bill says it
// was never saved" by printing what the database actually holds, through the
// same reader the console uses (src/services/estateScope.js), next to the raw
// row — so a key stored under a slightly different name, or a value that does
// not parse, shows up instead of being guessed at.

import { openPool } from "./_db.mjs";

const { readEstateDefault } = await import("../src/services/estateScope.js");

const email = process.argv[2];
const pool = openPool();
const line = (k, v) => console.log(`  ${k.padEnd(24)} ${v}`);

try {
  const [projects] = await pool.query(
    "SELECT id, name, hostname, ruijie_group_id, is_active FROM network_projects ORDER BY sort_order, name"
  );
  const nameOf = (id) => projects.find((p) => Number(p.id) === Number(id))?.name || `#${id} (no such village)`;
  const active = projects.filter((p) => Number(p.is_active) === 1);

  console.log(`\nVillages: ${projects.length} (${active.length} active)`);

  // Every settings row that looks like a village scope, raw — catches a value
  // saved under a near-miss key.
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value, setting_type, updated_at, updated_by
       FROM app_settings
      WHERE setting_key LIKE '%visible%' OR setting_key LIKE '%village%'`
  );
  console.log(`\nRaw app_settings rows matching %visible% / %village%: ${rows.length}`);
  for (const r of rows) {
    const v = r.setting_value == null ? "NULL" : String(r.setting_value);
    line(JSON.stringify(r.setting_key), `${v.length > 120 ? v.slice(0, 120) + "…" : v}  (updated ${r.updated_at ? new Date(r.updated_at).toISOString() : "—"} by #${r.updated_by ?? "—"})`);
  }

  const d = await readEstateDefault(pool);
  console.log("\nEstate default, as the console reads it:");
  line("mode", d.mode);
  line("saved", d.updatedAt ? `${new Date(d.updatedAt).toISOString()} by ${d.updatedByName || `#${d.updatedById}`}` : "never");
  if (d.ids) {
    line("villages", `${d.ids.length}`);
    for (const id of d.ids) line("", nameOf(id));
  } else {
    line("villages", d.mode === "none" ? "none" : `every active village (${active.length})`);
  }

  if (email) {
    const [[u]] = await pool.query("SELECT id, email, role FROM users WHERE email = ?", [email]);
    if (!u) {
      console.log(`\nNo account with the address ${email}`);
    } else {
      const [[pref]] = await pool.query("SELECT prefs FROM user_preferences WHERE user_id = ?", [u.id]);
      const prefs = pref?.prefs ? (typeof pref.prefs === "string" ? JSON.parse(pref.prefs) : pref.prefs) : {};
      console.log(`\nAccount #${u.id} ${u.email} (${u.role}) — own view:`);
      if (Array.isArray(prefs.visibleSiteIds)) {
        line("your view", `${prefs.visibleSiteIds.length} villages (this is what Dashboard and Billing follow)`);
        for (const id of prefs.visibleSiteIds) line("", nameOf(id));
      } else {
        line("your view", "not set — follows the estate default");
      }
      line("switcher village", prefs.activeSiteId == null ? "none (all villages)" : nameOf(prefs.activeSiteId));
    }
  }
  console.log("");
} finally {
  await pool.end();
}
