// src/services/mediaThumbs.js
//
// Gallery tiles, made on the server.
//
// A village gallery is twenty phone photos and the odd walk-round video: a few
// hundred megabytes of originals standing in for twenty 180-pixel squares. The
// console used to fall back to the original when a file had no tile, and then
// shrink it in a canvas to make one — which downloaded the lot and blocked the
// browser's main thread decoding it, so the whole console went unresponsive
// while a gallery opened. Tiles are made here instead: once, on the box that
// already has the file, and then cached by the browser for a week.
//
// Two makers, both optional, because neither is guaranteed to be installed:
//   • sharp  — photos. A 12 MP JPEG comes down to 480px in about a tenth of a
//              second. Declared an OPTIONAL dependency so a box that cannot
//              build it still deploys.
//   • ffmpeg — one frame out of a video, if the binary is on the box.
// With neither, there is no tile and the gallery draws a placeholder; the
// browser that uploads a file still offers its own tile (addMediaThumb), which
// is what covers that case going forward.
//
// Work is queued two at a time. A gallery asking for twenty tiles at once must
// not become twenty resizes at once on a box that is also serving vouchers.

import { execFile } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { newThumbPath, resolveMedia } from "./maintenanceStore.js";

const run = promisify(execFile);

/** Long edge of a tile. Twice the biggest square the grid draws, for retina. */
export const THUMB_EDGE = 480;
const MAX_PARALLEL = 2;
const FFMPEG_TIMEOUT_MS = 25_000;

// ── the two makers, looked for once ──────────────────────────────────────────

let sharpPromise = null;
function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => m.default)
      .catch((e) => {
        console.warn("[media] sharp is not installed; photo tiles fall back to ffmpeg:", e.message);
        return null;
      });
  }
  return sharpPromise;
}

let ffmpegPromise = null;
function hasFfmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = run("ffmpeg", ["-version"], { timeout: 5000 })
      .then(() => true)
      .catch(() => {
        console.warn("[media] ffmpeg is not installed; video tiles rely on the uploader's browser");
        return false;
      });
  }
  return ffmpegPromise;
}

// ── two at a time, and only once per file ────────────────────────────────────

let active = 0;
const waiting = [];

function pump() {
  while (active < MAX_PARALLEL && waiting.length) {
    const next = waiting.shift();
    active += 1;
    next().finally(() => {
      active -= 1;
      pump();
    });
  }
}

/** Runs `job` when a slot frees up. */
function queued(job) {
  return new Promise((resolve, reject) => {
    waiting.push(() => job().then(resolve, reject));
    pump();
  });
}

const inFlight = new Map(); // media id -> Promise<rel path | null>
const beyondUs = new Set(); // ids this process has already failed on

// ── the makers ───────────────────────────────────────────────────────────────

async function wrote(abs) {
  try {
    return (await stat(abs)).size > 0;
  } catch {
    return false;
  }
}

async function ffmpegFrame(src, out, seconds) {
  if (!(await hasFfmpeg())) return false;
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    // Seeking BEFORE -i is the cheap seek: ffmpeg jumps to the keyframe rather
    // than decoding the file up to that point.
    ...(seconds ? ["-ss", String(seconds)] : []),
    "-i", src,
    "-frames:v", "1",
    "-vf", `scale=w=${THUMB_EDGE}:h=${THUMB_EDGE}:force_original_aspect_ratio=decrease`,
    "-q:v", "4",
    out,
  ];
  try {
    await run("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1 << 20 });
    return await wrote(out);
  } catch {
    return false;
  }
}

/** A frame a second in, falling back to the very first frame for short clips. */
async function videoTile(src, out) {
  return (await ffmpegFrame(src, out, 1)) || (await ffmpegFrame(src, out, null));
}

async function imageTile(src, out) {
  const sharp = await loadSharp();
  if (sharp) {
    try {
      await sharp(src, { failOn: "none" })
        .rotate() // honour the phone's orientation tag, or every tile is sideways
        .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72, progressive: true })
        .toFile(out);
      if (await wrote(out)) return true;
    } catch (e) {
      console.warn("[media] sharp could not read a file:", e.message);
    }
  }
  // ffmpeg reads JPEG, PNG and WebP perfectly well, and is the whole story on a
  // box where sharp would not build.
  return ffmpegFrame(src, out, null);
}

async function makeTile(pool, media) {
  const src = resolveMedia(media.file_path);
  if (!src) return null;
  const { rel, abs } = await newThumbPath(media.project_id);
  const made = media.kind === "video" ? await videoTile(src, abs) : await imageTile(src, abs);
  if (!made) {
    try { await unlink(abs); } catch { /* nothing was written */ }
    return null;
  }
  // Never over a tile that arrived while this one was being made (the uploading
  // browser sends its own); that one is already in URLs the console is using.
  await pool.query(
    "UPDATE maintenance_media SET thumb_path = ? WHERE id = ? AND thumb_path IS NULL",
    [rel, media.id]
  );
  const [[row]] = await pool.query("SELECT thumb_path FROM maintenance_media WHERE id = ? LIMIT 1", [media.id]);
  if (row?.thumb_path !== rel) {
    try { await unlink(abs); } catch { /* ignore */ }
    return row?.thumb_path || null;
  }
  return rel;
}

/**
 * The tile for one media row, making it if it has none.
 *
 * @param pool          the database
 * @param media         a row with { id, project_id, kind, file_path, thumb_path }
 * @param opts.waitMs   how long to wait for a tile that is being made. null
 *                      waits for as long as it takes (the backfill script);
 *                      a number gives up and returns null while the job carries
 *                      on in the background, so a request never holds a
 *                      connection open behind a queue of other people's work.
 * @returns the relative path of the tile, or null when there is not one yet.
 */
export async function ensureThumb(pool, media, { waitMs = null } = {}) {
  if (!media) return null;
  if (media.thumb_path) return media.thumb_path;
  const id = Number(media.id);
  if (!Number.isFinite(id) || beyondUs.has(id)) return null;

  let job = inFlight.get(id);
  if (!job) {
    job = queued(() => makeTile(pool, media))
      .catch((e) => {
        console.error(`[media] could not make a tile for media ${id}:`, e.message);
        return null;
      })
      .then((rel) => {
        if (!rel) beyondUs.add(id);
        inFlight.delete(id);
        return rel;
      });
    inFlight.set(id, job);
  }
  if (waitMs == null) return job;
  return Promise.race([
    job,
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), waitMs);
      t.unref?.();
    }),
  ]);
}

/** Whether anything on this box can make a tile at all. For the backfill script. */
export async function tileMakers() {
  const [sharp, ffmpeg] = await Promise.all([loadSharp(), hasFfmpeg()]);
  return { sharp: !!sharp, ffmpeg };
}
