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
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
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

// Documents are village-level paperwork — handover packs, as-builts, warranties.
// Wider than photos (a handover pack is a PDF) but still an allow-list: an
// arbitrary upload must not be able to become an arbitrary file on disk.
const DOC_EXT = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
export const ALLOWED_DOC_MIME = Object.keys(DOC_EXT);
export const MAX_DOC_BYTES = 100 * 1024 * 1024; // 100 MB — a scanned handover pack with photos

// NOTE ON THE CEILING. This is only the innermost of three limits; nginx's
// client_max_body_size and the proxy config are the outer ones, and the
// smallest wins. See deploy/nginx.uso-stack.conf — a cap raised here alone
// changes nothing except which error the operator sees.

// Media is the site as it LOOKS: photos of the mast, a walk-round video, a
// clip of a fault. Same allow-list discipline as documents — a stored file can
// only ever be one of these — but it carries video, which paperwork does not.
const MEDIA_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
export const ALLOWED_MEDIA_MIME = Object.keys(MEDIA_EXT);
// The same ceiling as a document, and for the same reason: nginx allows 105 MB
// on this location (deploy/nginx.uso-stack.conf), so a larger limit here would
// only change which error the operator sees.
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const mediaKind = (mimeType) => (String(mimeType || "").startsWith("video/") ? "video" : "image");

export const DOC_CATEGORIES = [
  { key: "handover", label: "Handover pack" },
  { key: "asbuilt", label: "As-built / site drawing" },
  { key: "warranty", label: "Warranty" },
  { key: "permit", label: "Permit / approval" },
  { key: "manual", label: "Manual / datasheet" },
  { key: "other", label: "Other" },
];
export const DOC_CATEGORY_KEYS = new Set(DOC_CATEGORIES.map((c) => c.key));

const DOC_ROOT = resolve(ROOT, "..", "maintenance-docs");
const MEDIA_ROOT = resolve(ROOT, "..", "maintenance-media");

/** Write one village document from a buffer. Returns the relative path. */
export async function saveDocument(projectId, buffer, mimeType) {
  const ext = DOC_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported file type: ${mimeType}`);
  const dir = join(DOC_ROOT, String(Number(projectId)));
  await mkdir(dir, { recursive: true });
  const rel = join(String(Number(projectId)), `${randomUUID()}.${ext}`);
  await writeFile(join(DOC_ROOT, rel), buffer);
  return rel;
}

/**
 * Stream a document straight from the request to disk.
 *
 * Documents are not photos. A 100 MB handover pack sent as base64 inside JSON
 * would be a ~133 MB string held in memory (base64 costs 4/3) and then decoded
 * into another ~100 MB buffer — a quarter of a gigabyte per upload, on a box
 * already running 30-odd node processes. Streaming holds one chunk at a time
 * regardless of file size, and skips the 4/3 inflation entirely.
 *
 * The size limit is enforced MID-STREAM rather than by checking afterwards, so
 * an oversized upload stops early instead of filling the disk first; the
 * partial file is removed on any failure.
 */
export async function saveDocumentStream(projectId, source, mimeType, maxBytes = MAX_DOC_BYTES) {
  const ext = DOC_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported file type: ${mimeType}`);
  return saveStreamTo(DOC_ROOT, projectId, ext, source, maxBytes);
}

/** The same, for a village's media. Videos are why this streams rather than buffers. */
export async function saveMediaStream(projectId, source, mimeType, maxBytes = MAX_MEDIA_BYTES) {
  const ext = MEDIA_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported file type: ${mimeType}`);
  return saveStreamTo(MEDIA_ROOT, projectId, ext, source, maxBytes);
}

/**
 * A gallery tile, stored beside the file it stands for.
 *
 * The console draws these in the browser at upload time — a 480px JPEG for a
 * photo, a frame for a video — so a grid of twenty costs a few hundred
 * kilobytes instead of the several hundred megabytes the originals weigh.
 */
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
export async function saveThumbStream(projectId, source, maxBytes = MAX_THUMB_BYTES) {
  return saveStreamTo(MEDIA_ROOT, projectId, "thumb.jpg", source, maxBytes);
}

async function saveStreamTo(root, projectId, ext, source, maxBytes) {
  const dir = join(root, String(Number(projectId)));
  await mkdir(dir, { recursive: true });
  const rel = join(String(Number(projectId)), `${randomUUID()}.${ext}`);
  const abs = join(root, rel);

  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const err = new Error(`File is too large (max ${Math.round(maxBytes / 1048576)} MB)`);
        err.code = "DOC_TOO_LARGE";
        return cb(err);
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(source, meter, createWriteStream(abs));
  } catch (e) {
    try { await unlink(abs); } catch { /* nothing written */ }
    throw e;
  }
  if (bytes === 0) {
    try { await unlink(abs); } catch { /* ignore */ }
    throw Object.assign(new Error("File is empty"), { code: "DOC_EMPTY" });
  }
  return { rel, bytes };
}

/** Same traversal guard as photos, against the documents root. */
export function resolveDocument(relPath) {
  const abs = resolve(DOC_ROOT, String(relPath || ""));
  if (abs !== DOC_ROOT && !abs.startsWith(DOC_ROOT + sep)) return null;
  return abs;
}

export function streamDocument(relPath) {
  const abs = resolveDocument(relPath);
  if (!abs) return null;
  return createReadStream(abs);
}

export async function deleteDocument(relPath) {
  const abs = resolveDocument(relPath);
  if (!abs) return;
  try { await unlink(abs); } catch { /* already gone */ }
}

export function docRoot() { return DOC_ROOT; }

/** Same traversal guard as documents, against the media root. */
export function resolveMedia(relPath) {
  const abs = resolve(MEDIA_ROOT, String(relPath || ""));
  if (abs !== MEDIA_ROOT && !abs.startsWith(MEDIA_ROOT + sep)) return null;
  return abs;
}

/**
 * A readable stream over part or all of a media file. A video element asks for
 * ranges as the viewer scrubs, so a whole-file stream would make seeking mean
 * downloading everything up to that point.
 */
export function streamMedia(relPath, range) {
  const abs = resolveMedia(relPath);
  if (!abs) return null;
  return range ? createReadStream(abs, { start: range.start, end: range.end }) : createReadStream(abs);
}

/** Byte length on disk, or null when the file has gone missing. */
export async function mediaSize(relPath) {
  const abs = resolveMedia(relPath);
  if (!abs) return null;
  try { return (await stat(abs)).size; } catch { return null; }
}

export async function deleteMedia(relPath) {
  const abs = resolveMedia(relPath);
  if (!abs) return;
  try { await unlink(abs); } catch { /* already gone */ }
}

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
