#!/usr/bin/env node
// scripts/encrypt-totp-secrets.mjs
//
// Seals every two-factor secret that is still plaintext, or still under an
// older key, using the key currently in TOTP_ENCRYPTION_KEY.
//
//     node scripts/encrypt-totp-secrets.mjs            # report only
//     node scripts/encrypt-totp-secrets.mjs --apply    # actually write
//
// Safe to run repeatedly: a row already sealed under the current key is left
// alone, so this is also the rotation step — set the new key, move the old one
// to TOTP_ENCRYPTION_KEY_OLD, run it again.
//
// It decrypts before it re-encrypts, so a row it cannot read is REPORTED and
// SKIPPED rather than overwritten. A migration that mangles what it cannot
// understand is how an estate loses its second factors.

import "./_db.mjs";
import { getPool } from "../src/config/db.js";
import {
  seal, open as unseal, needsReseal, isSealed, encryptionEnabled, activeKeyId,
} from "../src/services/secretBox.js";

const apply = process.argv.includes("--apply");

if (!encryptionEnabled) {
  console.error(
    "TOTP_ENCRYPTION_KEY is not set, so there is nothing to seal with.\n" +
    'Generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    "Put it in backend/.env as TOTP_ENCRYPTION_KEY, then run this again."
  );
  process.exit(1);
}

const pool = await getPool();
const [rows] = await pool.query(
  "SELECT id, email, totp_secret FROM users WHERE totp_secret IS NOT NULL ORDER BY id"
);

let sealed = 0, already = 0, failed = 0;
const problems = [];

for (const r of rows) {
  if (!needsReseal(r.totp_secret)) { already++; continue; }

  let plain;
  try {
    plain = unseal(r.totp_secret);
  } catch (e) {
    failed++;
    problems.push(`  #${r.id} ${r.email}: ${e.message}`);
    continue;
  }

  const wrapped = seal(plain);
  if (apply) {
    // Guarded on the value we read, so a sign-in that re-sealed the row
    // underneath us is not overwritten with a stale read.
    const [res] = await pool.query(
      "UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?",
      [wrapped, r.id, r.totp_secret]
    );
    if (res.affectedRows !== 1) {
      problems.push(`  #${r.id} ${r.email}: changed while running, left alone — run again`);
      continue;
    }
  }
  sealed++;
  console.log(`  ${apply ? "sealed " : "would seal "}#${r.id} ${r.email}` +
    `${isSealed(r.totp_secret) ? " (re-key)" : " (was plaintext)"}`);
}

console.log(
  `\n${rows.length} account(s) with a secret · ` +
  `${sealed} ${apply ? "sealed" : "to seal"} · ${already} already under key ${activeKeyId}` +
  (failed ? ` · ${failed} UNREADABLE` : "")
);
if (problems.length) {
  console.log("\nNeeds attention:");
  for (const p of problems) console.log(p);
  console.log(
    "\nA secret that cannot be read was sealed with a key this process does not hold.\n" +
    "Add that key to TOTP_ENCRYPTION_KEY_OLD, or reset two-factor for those accounts\n" +
    "from the Users page — they will enrol again at their next sign-in."
  );
}
if (!apply && sealed) console.log("\nNothing was written. Re-run with --apply.");

await pool.end();
process.exit(failed ? 1 : 0);
