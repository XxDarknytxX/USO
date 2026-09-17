#!/usr/bin/env node
// scripts/set-superadmin.mjs — make an EXISTING console account a superadmin.
//
//     node scripts/set-superadmin.mjs someone@vodafone.com.fj
//
// Run on the server. Deliberately not possible from the console for an admin:
// the superadmin decides the estate default, credentials and security policy.
// The account must already exist (create it under Users first). The person
// signs out and back in for the new role to take effect.

import { openPool } from "./_db.mjs";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/set-superadmin.mjs <email>");
  process.exit(1);
}
const pool = openPool();
try {
  const [[user]] = await pool.query("SELECT id, email, role FROM users WHERE LOWER(email) = ?", [email]);
  if (!user) {
    console.error(`No account with the address ${email}. Create it under Users first.`);
    process.exitCode = 1;
  } else if (user.role === "superadmin") {
    console.log(`${user.email} is already a superadmin.`);
  } else {
    await pool.query("UPDATE users SET role = 'superadmin' WHERE id = ?", [user.id]);
    console.log(`${user.email}: ${user.role} → superadmin. They need to sign out and back in.`);
  }
} finally {
  await pool.end();
}
