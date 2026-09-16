// src/services/secretBox.js
//
// Encryption at rest for the TOTP secrets, and the key management that makes
// it safe to operate.
//
// ── Why this file is careful ─────────────────────────────────────────────
//
// The obvious implementation is four lines and it destroys accounts:
//
//     const KEY = process.env.SOME_KEY || crypto.randomBytes(32).toString("hex");
//
// A missing env var then yields a fresh key on every boot, every stored secret
// becomes undecryptable, and nobody finds out until the next sign-in — at
// which point every enrolled account is locked out with no way back except an
// admin reset each. A key that can be silently absent is worse than no
// encryption at all, because no encryption at least fails visibly.
//
// So the rules here are:
//
//   1. NEVER invent a key. No fallback, no default, no generation at boot.
//   2. No key configured => store as before, and SAY SO, loudly, once, at
//      startup. An estate mid-migration keeps working; it does not quietly
//      believe it is encrypted when it is not.
//   3. A key configured but unusable (wrong length, not hex/base64) => refuse
//      to start. That is a typo in a deploy, and the failure mode of guessing
//      is the one in rule 1.
//   4. Ciphertext carries its version and its key id, so keys can be rotated
//      without a flag day: new writes use the current key, reads accept any
//      key still listed.
//   5. Plaintext already in the column keeps working and is recognised by the
//      absence of the envelope prefix, so turning this on is not a migration
//      that has to happen before the next login.
//
// ── Operating it ─────────────────────────────────────────────────────────
//
// Generate a key:
//     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Put it in the backend .env as TOTP_ENCRYPTION_KEY, restart, then run
//     node scripts/encrypt-totp-secrets.mjs
// to seal the rows that are still plaintext.
//
// To ROTATE: move the old value to TOTP_ENCRYPTION_KEY_OLD (comma-separated if
// there is more than one), put the new one in TOTP_ENCRYPTION_KEY, restart,
// re-run the script — it re-seals everything under the new key — then drop the
// old value from the env at your leisure.
//
// If the key is LOST there is no recovery: the secrets are gone and every
// enrolled account needs its two-factor reset from the Users page. That is the
// correct behaviour for a secret store, and it is the reason the key belongs
// in the deployment's secret material and not only in one .env on one box.
//
// AES-256-GCM, not CBC: GCM authenticates. CBC without a MAC lets a database
// writer flip bits in a secret and have it decrypt to something else without
// complaint, which for a credential store is not a theoretical concern.

import crypto from "node:crypto";

const PREFIX = "v1";
const IV_BYTES = 12;   // GCM's standard nonce length
const TAG_BYTES = 16;

/** Accepts 64 hex chars or 44 base64 chars; both are 32 bytes. */
function parseKey(raw, label) {
  const v = String(raw || "").trim();
  if (!v) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) buf = Buffer.from(v, "hex");
  else {
    try {
      const b = Buffer.from(v, "base64");
      if (b.length === 32) buf = b;
    } catch { /* falls through to the throw below */ }
  }
  if (!buf || buf.length !== 32) {
    throw new Error(
      `${label} is not a valid key: expected 32 bytes as 64 hex characters or base64. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return buf;
}

/** Short, stable, non-secret identifier so ciphertext can name its key. */
function keyId(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

function load() {
  const primary = parseKey(process.env.TOTP_ENCRYPTION_KEY, "TOTP_ENCRYPTION_KEY");
  const olds = String(process.env.TOTP_ENCRYPTION_KEY_OLD || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => parseKey(s, `TOTP_ENCRYPTION_KEY_OLD[${i}]`));

  const byId = new Map();
  for (const k of [primary, ...olds]) if (k) byId.set(keyId(k), k);
  return { primary, byId };
}

// Thrown at import time on a malformed key — rule 3. A deploy that cannot read
// its own key should stop at the door, not at the first sign-in.
const { primary, byId } = load();

export const encryptionEnabled = Boolean(primary);
export const activeKeyId = primary ? keyId(primary) : null;

/** One line at startup, so the state of this is never a guess. */
export function reportEncryptionStatus(log = console) {
  if (encryptionEnabled) {
    const extra = byId.size - 1;
    log.log(
      `[2fa] TOTP secrets encrypted at rest (key ${activeKeyId}` +
      `${extra > 0 ? `, ${extra} older key${extra === 1 ? "" : "s"} accepted for reads` : ""})`
    );
    return;
  }
  log.warn(
    "[2fa] TOTP_ENCRYPTION_KEY is not set — two-factor secrets are stored in PLAINTEXT.\n" +
    "      Anyone who can read the users table can generate valid codes for every enrolled account.\n" +
    '      Generate a key:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    "      Put it in the backend .env as TOTP_ENCRYPTION_KEY, restart, then run\n" +
    "      node scripts/encrypt-totp-secrets.mjs to seal the rows already stored."
  );
}

/** True for a value this module wrote, as opposed to a legacy plaintext secret. */
export function isSealed(stored) {
  return typeof stored === "string" && stored.startsWith(`${PREFIX}.`);
}

/**
 * Wraps a secret for storage. With no key configured this returns the input
 * unchanged — deliberately, so an estate that has not set one keeps working
 * rather than writing values it cannot read back.
 */
export function seal(plaintext) {
  if (!primary) return plaintext;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", primary, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, activeKeyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/**
 * Unwraps a stored value. A value with no envelope is a legacy plaintext
 * secret and is returned as-is, which is what lets the key be introduced
 * without a migration having to land first.
 *
 * Throws when the envelope names a key we do not hold, or when the tag does not
 * verify. Both mean "this cannot be trusted" and the caller must not fall back
 * to treating the ciphertext as a secret — which is exactly what returning the
 * raw string would do.
 */
export function open(stored) {
  if (stored == null) return null;
  if (!isSealed(stored)) return stored;

  const [, id, ivB64, tagB64, ctB64] = String(stored).split(".");
  const key = byId.get(id);
  if (!key) {
    throw new Error(
      `This two-factor secret was encrypted with key ${id}, which is not configured. ` +
      `Add it to TOTP_ENCRYPTION_KEY_OLD, or reset two-factor for this account.`
    );
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

/** True when this value should be re-sealed: plaintext, or under an older key. */
export function needsReseal(stored) {
  if (!primary || stored == null) return false;
  if (!isSealed(stored)) return true;
  return String(stored).split(".")[1] !== activeKeyId;
}
