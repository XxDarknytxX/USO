// src/services/excelVoucherParser.js
//
// Parses a Ruijie "Voucher export" .xlsx (the intlSamVoucher/export → /report
// flow) into objects shaped like the old `voucher/getList` API list items, so
// the rest of the sync pipeline (transformVoucherData → upsertVoucher) is reused
// unchanged. This is a buffer-based ESM port of the vendor delivery scripts
// (parse_excel_to_voucher_list.js / process_excel_in_batches.js).
//
// Unit contract (matches the old API, which is what transformVoucherData expects):
//   • timePeriod            → minutes  (0 = unlimited)
//   • quota / usedQuota     → MB       (0 = unlimited)
//   • up/downloadRateLimit  → Kbps     (0 = unlimited)
//   • createTime/loginTime/expiryTime → epoch milliseconds (0 when "-")
//   • status "1"/"2"/"3", bindMac/disableStatus 0|1
//
// The parser is header-agnostic: columns are matched by normalized alias lists
// (with truncated-header fallbacks like "Voucher co", "MAC Bindi") so a slightly
// different export locale/column-width can't silently break the mapping.
//
// IMPORTANT: the Excel export contains NO `uuid`. Callers must resolve a stable
// uuid (reuse the existing DB row's uuid by voucher_code, else synthesize one).

import ExcelJS from "exceljs";

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w一-龥]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();

  if (typeof value === "object") {
    // Formula cell → use its computed result.
    if (Object.prototype.hasOwnProperty.call(value, "result")) {
      return normalizeCellValue(value.result);
    }
    // Rich text runs → concatenate.
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("");
    }
    if (value.text) return value.text;
    if (value.hyperlink) return value.hyperlink;
    return JSON.stringify(value);
  }

  return value;
}

function getFirstValue(raw, aliases, defaultValue = null) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = raw[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return defaultValue;
}

function toNumberOrDefault(value, defaultValue = 0) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return defaultValue;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function toStringOrDefault(value, defaultValue = "") {
  if (value === null || value === undefined) return defaultValue;
  return String(value);
}

// Parse an export datetime cell to absolute epoch ms.
//
// The export renders times as display strings ("2026/05/31 10:17:34") with NO
// timezone. Date.parse() would interpret those in the SERVER's local zone, so
// the stored epoch would shift whenever the server TZ differs from the Ruijie
// account's display TZ (and the old getList API returned an absolute epoch, so
// that would be a fidelity regression that can flip a voucher's expired state).
// We therefore parse the components explicitly and apply a fixed offset
// (tzOffsetMinutes, default Fiji UTC+12) so the result is deterministic
// regardless of where the process runs. exceljs Date cells (already absolute)
// bypass this and are used as-is.
function parseDateTimeToMillis(value, tzOffsetMinutes = 720, defaultValue = 0) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === "" ||
    String(value).trim() === "-"
  ) {
    return defaultValue;
  }
  if (typeof value === "number") return value; // exceljs Date cell → already epoch ms

  const s = String(value).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, Y, Mo, D, H, Mi, S] = m;
    return Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +(S || 0)) - tzOffsetMinutes * 60000;
  }
  // Fallback for an unexpected format — better than dropping the value.
  const ts = Date.parse(s.replace(/\//g, "-"));
  return Number.isFinite(ts) ? ts : defaultValue;
}

// Server: NOT_USED("1") -> "Not used", IN_USED("2") -> "In use", EXPIRED("3") -> "Expired"
function mapStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "1" || normalized === "unused" || normalized === "not used") return "1";
  if (
    normalized === "2" ||
    normalized === "in use" ||
    normalized === "in-use" ||
    normalized === "used" ||
    normalized === "active"
  ) {
    return "2";
  }
  if (normalized === "3" || normalized === "expired") return "3";
  return toStringOrDefault(value);
}

// Server: DISABLE(1) -> "Yes", ENABLE(0) -> "No"
function mapYesNoToInt(value, defaultValue = 0) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["yes", "y", "true", "1", "enabled"].includes(normalized)) return 1;
  if (["no", "n", "false", "0", "disabled", ""].includes(normalized)) return 0;
  return defaultValue;
}

// "currentClients/maxClients" or "currentClients/Unlimited". maxClients=0 = unlimited.
function parseDevices(value) {
  const text = String(value || "").trim();
  if (!text || text === "-") return { currentClients: 0, maxClients: 0 };

  const match = text.match(/(\d+)\s*\/\s*(.+)/);
  if (!match) return { currentClients: 0, maxClients: toNumberOrDefault(value, 0) };

  const currentClients = Number(match[1]);
  const rightSide = match[2].trim().toLowerCase();
  if (rightSide === "unlimited" || rightSide === "0") {
    return { currentClients, maxClients: 0 };
  }
  return { currentClients, maxClients: toNumberOrDefault(rightSide, 0) };
}

// "9 MB" / "2 GB" / "Unlimited" → MB (0 = unlimited).
function parseDataAmountToMB(value, defaultValue = 0) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "-" || text === "unlimited") return defaultValue;

  const match = text.match(/([\d.]+)\s*(kb|mb|gb|tb)?/i);
  if (!match) return defaultValue;

  const amount = Number(match[1]);
  const unit = (match[2] || "mb").toLowerCase();
  if (!Number.isFinite(amount)) return defaultValue;

  if (unit === "kb") return amount / 1024;
  if (unit === "gb") return amount * 1024;
  if (unit === "tb") return amount * 1024 * 1024;
  return amount; // MB
}

// "9MB/2 GB" or "0MB/Unlimited" → { usedQuota, quota } in MB.
function parseTrafficUsedTotal(value) {
  const text = String(value || "").trim();
  const parts = text.split("/");
  return {
    usedQuota: parseDataAmountToMB(parts[0], 0),
    quota: parts[1] ? parseDataAmountToMB(parts[1], 0) : 0,
  };
}

// "1Hour" / "1Day 2Hours 30Minutes" / "Unlimited" → minutes (0 = unlimited).
function parseDurationToMinutes(value, defaultValue = 0) {
  const text = String(value || "").trim();
  if (!text || text === "-" || text.toLowerCase() === "unlimited") return defaultValue;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;

  const regex = /(\d+)\s*(day|days|hour|hours|hr|hrs|minute|minutes|min|mins|week|weeks)/gi;
  let totalMinutes = 0;
  let matched = false;
  let m;
  while ((m = regex.exec(text)) !== null) {
    matched = true;
    const amount = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (["hour", "hours", "hr", "hrs"].includes(unit)) totalMinutes += amount * 60;
    else if (["day", "days"].includes(unit)) totalMinutes += amount * 24 * 60;
    else if (["week", "weeks"].includes(unit)) totalMinutes += amount * 7 * 24 * 60;
    else totalMinutes += amount; // minutes
  }
  return matched ? totalMinutes : defaultValue;
}

// "10Mbps" / "500Kbps" / "Unlimited" → Kbps (0 = unlimited).
function parseRateLimitToKbps(value, defaultValue = 0) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "-" || text === "unlimited") return defaultValue;

  const match = text.match(/([\d.]+)\s*(mbps|kbps)?/i);
  if (!match) return defaultValue;

  const num = Number(match[1]);
  if (!Number.isFinite(num)) return defaultValue;

  const unit = (match[2] || "kbps").toLowerCase();
  if (unit === "mbps") return num * 1024;
  return num; // Kbps
}

// "10Mbps/10Mbps" or "Unlimited" → { uploadRateLimit, downloadRateLimit } in Kbps.
function parseUploadDownloadLimit(value) {
  const text = String(value || "").trim();
  if (!text || text === "-" || text.toLowerCase() === "unlimited") {
    return { uploadRateLimit: 0, downloadRateLimit: 0 };
  }
  const parts = text.split("/");
  return {
    uploadRateLimit: parseRateLimitToKbps(parts[0], 0),
    downloadRateLimit: parts[1] ? parseRateLimitToKbps(parts[1], 0) : 0,
  };
}

function rowIsEmpty(rowObject) {
  return Object.values(rowObject).every(
    (value) => value === null || value === undefined || String(value).trim() === ""
  );
}

function getWorksheet(workbook, sheetName) {
  if (sheetName) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error(`Worksheet not found: ${sheetName}`);
    return worksheet;
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheet found in Excel file");
  return worksheet;
}

function readRows(worksheet) {
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalizeHeader(normalizeCellValue(cell.value));
    if (header) headers[colNumber] = header;
  });

  if (headers.length === 0) {
    throw new Error("Header row is empty. The first row must contain column names.");
  }

  // Guard: the export MUST expose a voucher-code column. If it doesn't — a header
  // rename ("Voucher code" → "Voucher Code No."), a non-English locale, a
  // title/merged row shifting the real header down, or the wrong sheet — then
  // every row parses with a blank voucherCode. Downstream, the sync would read
  // that as "every voucher dropped out of the export" and archive the ENTIRE
  // site. Failing loudly here turns that catastrophe into a cleanly skipped site.
  const headerKeys = headers.filter(Boolean);
  const CODE_HEADER_KEYS = ["voucher_code", "voucher_co", "vouchercode", "code"];
  if (!headerKeys.some((h) => CODE_HEADER_KEYS.includes(h))) {
    throw new Error(
      `Voucher export is missing a voucher-code column (headers: ${headerKeys.join(", ")}). ` +
        `Refusing to parse — a header/locale change would otherwise wipe the site.`
    );
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    for (let colNumber = 1; colNumber <= headers.length; colNumber++) {
      const header = headers[colNumber];
      if (!header) continue;
      raw[header] = normalizeCellValue(row.getCell(colNumber).value);
    }
    if (!rowIsEmpty(raw)) rows.push({ rowNumber, raw });
  });
  return rows;
}

// Map one Excel row → old-API-compatible voucher object (see column notes in the
// vendor README §4.2). NOTE the two easy-to-miss mappings the server uses:
//   • Excel "Alias"       column → API `comment`
//   • Excel "User group"  column → BOTH userGroupName and packageName
function mapRowToVoucher(row, options = {}) {
  const raw = row.raw;
  const tz = options.tzOffsetMinutes ?? 720; // export display TZ (Fiji UTC+12 default)
  const devices = parseDevices(getFirstValue(raw, ["Devices", "device", "clients"]));
  const traffic = parseTrafficUsedTotal(
    getFirstValue(raw, [
      "Traffic Used/Total", "Traffic Use/Total", "Traffic Use",
      "Traffic Used", "traffic_used_total", "traffic_use", "traffic",
    ])
  );
  const rateLimit = parseUploadDownloadLimit(
    getFirstValue(raw, ["Upload/Download limit", "upload_download_limit", "rate_limit"])
  );
  const userGroup = getFirstValue(raw, [
    "User group", "User group name", "user_group", "user_group_name",
  ]);

  return {
    uuid: toStringOrDefault(getFirstValue(raw, ["uuid", "id"])),
    tenantId: toStringOrDefault(getFirstValue(raw, ["tenantId", "tenant_id"], options.tenantId || "")),
    voucherCode: toStringOrDefault(getFirstValue(raw, ["Voucher code", "Voucher co", "voucherCode", "voucher_code", "code"])),
    nameRef: toStringOrDefault(getFirstValue(raw, ["nameRef", "name_ref"])),
    packagePrice: toNumberOrDefault(getFirstValue(raw, ["Price", "packagePrice", "package_price"])),
    timePeriod: parseDurationToMinutes(getFirstValue(raw, ["Period", "timePeriod", "time_period"])),
    usedTime: toNumberOrDefault(getFirstValue(raw, ["usedTime", "used_time"])),
    createTime: parseDateTimeToMillis(getFirstValue(raw, ["Created at", "Created a", "createTime", "create_time"]), tz),
    maxClients: devices.maxClients,
    currentClients: devices.currentClients,
    quota: traffic.quota,
    usedQuota: traffic.usedQuota,
    status: mapStatus(getFirstValue(raw, ["Status", "status"])),
    loginTime: parseDateTimeToMillis(getFirstValue(raw, ["Activated at", "Activated a", "loginTime", "login_time"]), tz),
    expiryTime: parseDateTimeToMillis(getFirstValue(raw, ["Expired at", "expiryTime", "expiry_time"]), tz),
    qrcodeUrl: toStringOrDefault(getFirstValue(raw, ["qrcodeUrl", "qrcode_url", "qr_code_url"])),
    downloadRateLimit: rateLimit.downloadRateLimit,
    uploadRateLimit: rateLimit.uploadRateLimit,
    bindMac: mapYesNoToInt(getFirstValue(raw, ["MAC Binding", "MAC Bindi", "MAC Bind", "mac_binding", "bindMac", "bind_mac"])),
    packageName: toStringOrDefault(userGroup),
    userGroupId: toStringOrDefault(getFirstValue(raw, ["userGroupId", "user_group_id"])),
    userGroupName: toStringOrDefault(userGroup),
    firstName: toStringOrDefault(getFirstValue(raw, ["First name", "firstName", "first_name"])),
    lastName: toStringOrDefault(getFirstValue(raw, ["Last name", "lastName", "last_name"])),
    email: toStringOrDefault(getFirstValue(raw, ["Email", "email"])),
    phone: toStringOrDefault(getFirstValue(raw, ["Phone number", "Phone num", "Phone nur", "phone", "phone_number"])),
    comment: toStringOrDefault(getFirstValue(raw, ["Alias", "Comment", "comment"])),
    disableStatus: mapYesNoToInt(getFirstValue(raw, ["Disabled", "disabled"])),
  };
}

/**
 * Parse a voucher-export .xlsx (as a Buffer/ArrayBuffer) into an array of
 * old-API-compatible voucher objects.
 *
 * @param {Buffer|ArrayBuffer} buffer  raw .xlsx bytes
 * @param {object} [options]
 * @param {string} [options.tenantId]  fallback tenantId (Excel doesn't include it)
 * @param {string} [options.sheetName] worksheet name (defaults to the first sheet)
 * @param {number} [options.tzOffsetMinutes] TZ of the export's display times
 *   (default 720 = Fiji UTC+12); date cells are converted to absolute epoch ms
 *   using this so the result doesn't depend on the server's timezone.
 * @returns {Promise<Array<object>>}
 * @throws if the sheet has no voucher-code column (see readRows guard).
 */
export async function parseVoucherExcelBuffer(buffer, options = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty Excel buffer");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = getWorksheet(workbook, options.sheetName || "");
  const rows = readRows(worksheet);
  const tzOffsetMinutes = options.tzOffsetMinutes ?? 720;
  return rows.map((row) =>
    mapRowToVoucher(row, { tenantId: options.tenantId || "", tzOffsetMinutes })
  );
}

export default { parseVoucherExcelBuffer };
