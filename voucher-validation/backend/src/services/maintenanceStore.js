// src/services/maintenanceStore.js
// Where maintenance photos live on disk, and the checklist every visit walks.
//
// Photos are files, not BLOBs: they are a few hundred KB each, there are ~7 per
// visit per village twice a year, and putting them in MySQL would bloat every
// backup and dump of the operational database for no gain. The DB holds the
// index; this module owns the bytes.
//
// The directory sits OUTSIDE the git checkout's tracked tree but inside the
// deploy root, so `git pull` + `npm ci` + `pm2 reload` never touches it.

import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// <repo>/data/maintenance — override with MAINTENANCE_DATA_DIR to put it on a
// different volume (photos grow without bound; the DB does not).
// fileURLToPath, not URL.pathname: the latter percent-encodes, so any deploy
// path containing a space would resolve to a literal "%20" directory.
const _here = dirname(fileURLToPath(import.meta.url)); // <repo>/voucher-validation/backend/src/services
const ROOT = resolve(
  process.env.MAINTENANCE_DATA_DIR || resolve(_here, "../../../..", "data/maintenance")
);

/** The fixed inspection checklist. Order is the order the engineer walks it. */
export const COMPONENTS = [
  { key: "gateway",   label: "Gateway / router",            hint: "Power, LEDs, WAN link, mounting, ventilation" },
  { key: "aps",       label: "Access points",               hint: "Each AP: powered, associated, physically secure, clean" },
  { key: "switch",    label: "Switch",                      hint: "Ports, PoE, link lights, heat, dust" },
  { key: "starlink",  label: "Starlink dish & mount",       hint: "Obstruction, alignment, mount integrity, cable strain" },
  { key: "power",     label: "Power (solar / battery / PSU)", hint: "Battery health, charge controller, solar panel condition" },
  { key: "enclosure", label: "Enclosure & cabling",         hint: "Weather seal, locks, cable dressing, labelling, rodent damage" },
  { key: "site",      label: "Site & safety",               hint: "Mast/pole, earthing, signage, access, hazards" },
];

export const COMPONENT_KEYS = new Set(COMPONENTS.map((c) => c.key));
export const CONDITIONS = new Set(["ok", "attention", "faulty", "na"]);

// Only formats a phone camera actually produces, and that a browser will render
// back. An allow-list, so an arbitrary upload cannot become an arbitrary file.
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ALLOWED_MIME = Object.keys(MIME_EXT);
export const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per photo after client downscale

/**
 * Write one photo for a visit. Returns the DB-storable relative path.
 * The filename is a random UUID: a caller-supplied name could contain path
 * separators, and nothing downstream needs the original name.
 */
export async function savePhoto(visitId, buffer, mimeType) {
  const ext = MIME_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);
  const dir = join(ROOT, String(Number(visitId)));
  await mkdir(dir, { recursive: true });
  const rel = join(String(Number(visitId)), `${randomUUID()}.${ext}`);
  await writeFile(join(ROOT, rel), buffer);
  return rel;
}

/**
 * Absolute path for a stored relative path, or null if it escapes the root.
 * Defence in depth: file_path comes from our own insert, but a traversal here
 * would hand out arbitrary server files, so it is re-checked on every read.
 */
export function resolvePhoto(relPath) {
  const abs = resolve(ROOT, String(relPath || ""));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

export function streamPhoto(relPath) {
  const abs = resolvePhoto(relPath);
  if (!abs) return null;
  return createReadStream(abs);
}

export async function photoExists(relPath) {
  const abs = resolvePhoto(relPath);
  if (!abs) return false;
  try { await stat(abs); return true; } catch { return false; }
}

export async function deletePhoto(relPath) {
  const abs = resolvePhoto(relPath);
  if (!abs) return;
  try { await unlink(abs); } catch { /* already gone */ }
}

export function dataRoot() { return ROOT; }
