/**
 * starlink-probe.mjs — one-off diagnostic, safe to run against production.
 *
 * WHY THIS EXISTS
 * Telemetry is keyed by Starlink's DeviceId ("ut5030988e-8610251b-d8c1116b"),
 * but an admin knows a village by its kit. Nothing in this codebase, and
 * nothing in the Starlink Portal either, maps one to the other — the portal's
 * admin simply types the device id in by hand. Before writing a resolver we
 * need to see which field actually carries the link, and that can only be
 * learned by asking the API.
 *
 * This script READS ONLY. It makes no writes, to Starlink or to the database.
 *
 * It prints:
 *   1. the full raw /v2/service-lines/{n} response for one village, so we can
 *      see every field the service currently discards
 *   2. the account's service-line list, if that endpoint answers
 *   3. one batch from the telemetry stream, with the COMPLETE column list per
 *      device type — the thing that decides whether a DeviceId can be tied
 *      back to a service line without a manual mapping
 *
 * SECRETS: credentials are read from the database, never printed. The stream
 * batch is truncated and device ids are shown in full only because they are
 * the thing being diagnosed.
 *
 *   node backend/scripts/starlink-probe.mjs                 # first village with a line
 *   node backend/scripts/starlink-probe.mjs SL-1234-5678-9  # a specific line
 */

// The env is loaded from the BACKEND directory explicitly, resolved from this
// file rather than from the working directory. PM2 runs the server with its cwd
// set there, so a bare `import "dotenv/config"` works for the server but leaves
// this script with no DATABASE_USER when it is run from anywhere else — which
// surfaces as the distinctly unhelpful "Access denied for user ''@'localhost'".
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
for (const p of [
  path.join(BACKEND, ".env"),
  path.join(BACKEND, "..", ".env"),
  path.join(BACKEND, "..", "..", ".env"),
]) {
  dotenv.config({ path: p, quiet: true });
}

import * as starlink from "../src/services/starlinkService.js";

const unquote = (v) => (v || "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

/**
 * A plain read-only pool. Deliberately NOT config/db.js's getPool(), which
 * issues CREATE DATABASE IF NOT EXISTS on the way up — a diagnostic has no
 * business needing that privilege, or that side effect.
 */
function openPool() {
  const user = unquote(process.env.DATABASE_USER);
  if (!user) {
    console.error(
      "DATABASE_USER is not set.\n" +
        `Looked for .env in:\n  ${path.join(BACKEND, ".env")}\n` +
        `  ${path.resolve(BACKEND, "../.env")}\n  ${path.resolve(BACKEND, "../../.env")}\n` +
        "Run it from the backend directory, or pass the values inline:\n" +
        "  DATABASE_USER=... DATABASE_PASSWORD=... DATABASE_NAME=... node backend/scripts/starlink-probe.mjs"
    );
    process.exit(1);
  }
  return mysql.createPool({
    host: process.env.DATABASE_HOST || "localhost",
    port: Number(process.env.DATABASE_PORT || 3306),
    user,
    password: unquote(process.env.DATABASE_PASSWORD),
    database: process.env.DATABASE_NAME,
    waitForConnections: true,
    connectionLimit: 2,
  });
}

const CUT = 4000; // keep the console readable

function show(title, value) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  console.log(s.length > CUT ? `${s.slice(0, CUT)}\n… truncated at ${CUT} chars` : s);
}

let pool;

async function main() {
  pool = openPool();
  console.log(
    `DB ${process.env.DATABASE_NAME || "(no DATABASE_NAME)"} on ` +
      `${process.env.DATABASE_HOST || "localhost"} as ${unquote(process.env.DATABASE_USER)}`
  );
  const cfg = await starlink.loadConfig(pool);
  if (!cfg) {
    console.error(
      "Starlink is not configured, or is disabled, in starlink_settings.\n" +
        "Enable it and save the credentials in Settings → Starlink first."
    );
    process.exit(1);
  }
  console.log(
    `Config OK — base ${cfg.api_base_url}, account ${cfg.account_number || "(none set)"}`
  );

  // Which villages even have a service line? This is the number that decides
  // how much of the estate the Starlink signal can actually cover.
  const [rows] = await pool.query(
    `SELECT id, name, starlink_service_line_number AS line, starlink_device_id AS device
       FROM network_projects
      WHERE is_active = 1
      ORDER BY sort_order, name`
  );
  const withLine = rows.filter((r) => r.line);
  const withDevice = rows.filter((r) => r.device);
  show(
    "VILLAGE COVERAGE",
    `${rows.length} active villages\n` +
      `${withLine.length} have a service line number\n` +
      `${withDevice.length} have a device id\n\n` +
      rows
        .map(
          (r) =>
            `  ${String(r.name).padEnd(22)} line=${r.line || "—"}  device=${r.device || "—"}`
        )
        .join("\n")
  );

  const line = process.argv[2] || withLine[0]?.line;
  if (!line) {
    console.error("\nNo village has a service line number set — nothing to probe.");
    await pool.end();
    process.exit(1);
  }
  console.log(`\nProbing service line: ${line}`);

  // 1. The raw service-line record. getServiceLine() keeps five fields; this
  //    shows everything, which is where a terminal/kit identifier would live.
  try {
    const token = await getToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/+$/, "");
    const raw = await getJson(
      `${base}/v2/service-lines/${encodeURIComponent(line)}`,
      token
    );
    show("1. RAW /v2/service-lines/{number} — look for a terminal or kit id", raw);
  } catch (e) {
    show("1. RAW /v2/service-lines/{number} — FAILED", describe(e));
  }

  // 2. The account-wide list. If it carries device ids, the whole mapping
  //    problem is solved here and no per-village entry is needed at all.
  try {
    const token = await getToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/+$/, "");
    const acct = cfg.account_number;
    const url = acct
      ? `${base}/v2/accounts/${encodeURIComponent(acct)}/service-lines?limit=5`
      : `${base}/v2/service-lines?limit=5`;
    console.log(`   (GET ${url})`);
    show("2. SERVICE-LINE LIST — does a row carry a device id?", await getJson(url, token));
  } catch (e) {
    show("2. SERVICE-LINE LIST — FAILED (may simply not exist on this API)", describe(e));
  }

  // 3. One telemetry batch. The column list is the important part: it decides
  //    whether a DeviceId can be tied to a service line automatically.
  try {
    const token = await getToken(cfg);
    const base = String(cfg.api_base_url).replace(/\/+$/, "");
    const data = await postJson(
      `${base}/v2/telemetry/stream`,
      { batchSize: 20, maxLingerMs: 5000 },
      token
    );
    const cols = data?.data?.columnNamesByDeviceType;
    const values = data?.data?.values || [];
    show(
      "3. TELEMETRY STREAM — FULL COLUMN LIST PER DEVICE TYPE",
      cols || "(no columnNamesByDeviceType in response — dumping raw below)"
    );
    if (!cols) show("3b. RAW STREAM RESPONSE", data);
    show(
      "3c. FIRST FEW ROWS (so a DeviceId can be eyeballed against the columns)",
      values.slice(0, 3)
    );
    const uCols = cols?.u || [];
    const idIdx = uCols.indexOf("DeviceId");
    const seen = new Set();
    for (const r of values) if (r[0] === "u" && r[idIdx]) seen.add(r[idIdx]);
    show(
      "3d. DISTINCT UserTerminal DeviceIds IN THIS BATCH",
      seen.size
        ? [...seen].join("\n")
        : "none — the stream may need a longer linger, or the account has no active terminals"
    );
  } catch (e) {
    show("3. TELEMETRY STREAM — FAILED", describe(e));
  }

  await pool.end();
}

/* The service module keeps its token private, so the probe does its own OAuth.
   Same grant, same credentials, nothing cached — this runs once. */
async function getToken(cfg) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
  });
  const r = await fetch(cfg.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw Object.assign(new Error("token exchange failed"), { status: r.status, body: await r.text() });
  const j = await r.json();
  if (!j.access_token) throw new Error("no access_token in token response");
  return j.access_token;
}

async function getJson(url, token) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error("request failed"), { status: r.status, body: text });
  try { return JSON.parse(text); } catch { return text; }
}

async function postJson(url, payload, token) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error("request failed"), { status: r.status, body: text });
  try { return JSON.parse(text); } catch { return text; }
}

function describe(e) {
  return [e.status ? `HTTP ${e.status}` : null, e.message, e.body ? String(e.body).slice(0, 800) : null]
    .filter(Boolean)
    .join("\n");
}

main().catch(async (e) => {
  console.error("\nProbe failed:", e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
