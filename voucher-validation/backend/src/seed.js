import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool } from "./config/db.js";

async function seed() {
  const pool = await getPool();

  const email = "kritish.vodafone@gmail.com";
  const name = "Kritish";
  const plainPassword = "abcd1234";
  const role = "admin";
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  await pool.query(
    "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
    [email, passwordHash, name, role]
  );

  console.log(`Seeded user: ${email} / ${plainPassword} (${role})`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
