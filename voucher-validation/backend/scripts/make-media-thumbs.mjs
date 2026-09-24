#!/usr/bin/env node
// scripts/make-media-thumbs.mjs
//
// Makes the gallery tile for every village media file that has none.
//
//     node scripts/make-media-thumbs.mjs            # what is missing
//     node scripts/make-media-thumbs.mjs --apply    # actually make them
//
// The server makes a tile on demand the first time a gallery asks for one, so
// this is not required — it just means the first person to open a gallery after
// an upgrade sees it complete rather than filling in. Safe to run repeatedly:
// a file that already has a tile is skipped, and a file nothing on this box can
// read is reported and left alone.

import { openPool } from "./_db.mjs";
import { ensureThumb, tileMakers } from "../src/services/mediaThumbs.js";

const apply = process.argv.includes("--apply");
const pool = openPool();

const makers = await tileMakers();
console.log(`makers: sharp ${makers.sharp ? "yes" : "NO"}, ffmpeg ${makers.ffmpeg ? "yes" : "NO"}`);
if (!makers.sharp && !makers.ffmpeg) {
  console.log("\nNeither is installed, so no tile can be made here.");
  console.log("  photos: npm install --omit=dev   (sharp is an optional dependency)");
  console.log("  video:  sudo apt-get install -y ffmpeg");
  await pool.end();
  process.exit(1);
}

const [rows] = await pool.query(
  `SELECT m.id, m.project_id, m.kind, m.title, m.bytes, m.file_path, m.thumb_path, p.name AS village
     FROM maintenance_media m
     LEFT JOIN network_projects p ON p.id = m.project_id
    WHERE m.thumb_path IS NULL
    ORDER BY m.id`
);

if (!rows.length) {
  console.log("\nEvery media file already has a tile.");
  await pool.end();
  process.exit(0);
}

const MB = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;
console.log(`\n${rows.length} file${rows.length === 1 ? "" : "s"} without a tile:`);
for (const r of rows) console.log(`  #${r.id}  ${r.kind.padEnd(5)}  ${MB(r.bytes).padStart(8)}  ${r.village || "?"} · ${r.title}`);

if (!apply) {
  console.log("\nRun again with --apply to make them.");
  await pool.end();
  process.exit(0);
}

let made = 0;
let failed = 0;
console.log("");
for (const r of rows) {
  const started = Date.now();
  // Waits for each one: this is a maintenance script, not a request, and two
  // run at a time inside ensureThumb regardless.
  const rel = await ensureThumb(pool, r, { waitMs: null });
  if (rel) {
    made += 1;
    console.log(`  made  #${r.id}  ${r.title}  (${Date.now() - started} ms)`);
  } else {
    failed += 1;
    console.log(`  ----  #${r.id}  ${r.title}  — nothing here could read it`);
  }
}

console.log(`\n${made} tile${made === 1 ? "" : "s"} made${failed ? `, ${failed} could not be` : ""}.`);
await pool.end();
process.exit(failed && !made ? 1 : 0);
