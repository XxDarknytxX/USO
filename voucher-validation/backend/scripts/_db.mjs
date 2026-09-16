// scripts/_db.mjs — shared connection for the maintenance scripts.
//
// PM2 runs the server with its cwd set to the backend directory, so the server
// gets away with a bare `import "dotenv/config"`. A script run from anywhere
// else gets nothing, and mysql2 reports the resulting blank username as
// "Access denied for user ''@'localhost'" — which sends you looking at grants
// rather than at the environment. So the env is resolved from THIS file's
// location, not the working directory.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND = path.resolve(HERE, "..");

for (const p of [
  path.join(BACKEND, ".env"),
  path.join(BACKEND, "..", ".env"),
  path.join(BACKEND, "..", "..", ".env"),
]) {
  dotenv.config({ path: p, quiet: true });
}

export const unquote = (v) => (v || "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

/**
 * A plain pool. Deliberately NOT config/db.js's getPool(), which issues
 * CREATE DATABASE IF NOT EXISTS on the way up — a maintenance script should
 * need neither that privilege nor that side effect.
 */
export function openPool({ quiet = false } = {}) {
  const user = unquote(process.env.DATABASE_USER);
  if (!user) {
    console.error(
      "DATABASE_USER is not set.\nLooked for .env in:\n" +
        [
          path.join(BACKEND, ".env"),
          path.resolve(BACKEND, "../.env"),
          path.resolve(BACKEND, "../../.env"),
        ]
          .map((p) => `  ${p}`)
          .join("\n") +
        "\n\nRun it from the backend directory, or pass the values inline:\n" +
        "  DATABASE_USER=... DATABASE_PASSWORD=... DATABASE_NAME=... node scripts/<script>.mjs"
    );
    process.exit(1);
  }
  const db = process.env.DATABASE_NAME;
  if (!quiet) {
    console.log(
      `DB ${db || "(no DATABASE_NAME)"} on ${process.env.DATABASE_HOST || "localhost"} as ${user}`
    );
  }
  return mysql.createPool({
    host: process.env.DATABASE_HOST || "localhost",
    port: Number(process.env.DATABASE_PORT || 3306),
    user,
    password: unquote(process.env.DATABASE_PASSWORD),
    database: db,
    waitForConnections: true,
    connectionLimit: 2,
  });
}
