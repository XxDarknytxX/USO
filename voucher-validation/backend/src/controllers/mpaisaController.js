// src/controllers/mpaisaController.js
// M-PAiSA number → email mapping. Ingests the periodic customer report (a
// tab-separated SQL export, decoded to UTF-8 by the client) and upserts it by
// `number` — re-uploading updates existing rows and inserts new ones, never
// duplicating. Also lists the current mapping for the admin table.

/** "2026-06-11 16:43:59.857" → "2026-06-11 16:43:59" (MySQL DATETIME), or null. */
function parseLogtime(s) {
  const m = String(s || "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * Parse the report text. Columns are tab-separated:
 *   Logtime \t Number \t Email \t Email_Status \t Account_Status
 * The export also carries a header row, a "-----" underline row, blank lines,
 * and a "(N rows affected)" footer — all skipped. A row only counts if its
 * Number column is all digits, which naturally drops the header and dashes.
 */
export function parseReport(text) {
  const rows = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    // Strip a BOM + any stray NULs (robust to imperfect UTF-16 decoding). KEEP
    // spaces — the Logtime cell contains one ("2026-06-11 16:43:59").
    const line = raw.replace(/[\uFEFF\u0000]/g, "").trim();
    if (!line) continue;
    if (/^\(\d+\s+rows?\s+affected\)/i.test(line)) continue; // footer
    const cols = line.split("\t").map((c) => c.trim());
    const [logtime, number, email, emailStatus, accountStatus] = cols;
    if (!number || !/^\d+$/.test(number)) continue; // skips header + dashes rows
    rows.push({
      number,
      email: email || null,
      emailStatus: emailStatus || null,
      accountStatus: accountStatus || null,
      logtime: parseLogtime(logtime),
    });
  }
  return rows;
}

export function makeMpaisaController(pool) {
  async function upload(req, res) {
    try {
      const content = req.body?.content;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Missing report content" });
      }

      const parsed = parseReport(content);
      if (!parsed.length) {
        return res.status(400).json({ error: "No valid rows found — expected a tab-separated Number/Email report." });
      }

      // De-dupe within the file (a number can repeat; keep the last occurrence).
      const byNumber = new Map();
      for (const r of parsed) byNumber.set(r.number, r);
      const rows = [...byNumber.values()];
      const numbers = rows.map((r) => r.number);

      // Which numbers already exist, so we can report inserted vs updated.
      const [existing] = await pool.query(
        `SELECT number FROM mpaisa_mappings WHERE number IN (${numbers.map(() => "?").join(",")})`,
        numbers
      );
      const existingSet = new Set(existing.map((e) => String(e.number)));

      // Bulk upsert keyed on the primary key `number`.
      const values = rows.map((r) => [r.number, r.email, r.emailStatus, r.accountStatus, r.logtime]);
      await pool.query(
        `INSERT INTO mpaisa_mappings (number, email, email_status, account_status, source_logtime)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           email = VALUES(email),
           email_status = VALUES(email_status),
           account_status = VALUES(account_status),
           source_logtime = VALUES(source_logtime),
           updated_at = CURRENT_TIMESTAMP`,
        [values]
      );

      const inserted = rows.filter((r) => !existingSet.has(r.number)).length;
      const updated = rows.length - inserted;
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM mpaisa_mappings`);

      res.json({ ok: true, parsedRows: parsed.length, uniqueNumbers: rows.length, inserted, updated, total });
    } catch (e) {
      console.error("[mpaisa] upload failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  }

  async function list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
      const offset = (page - 1) * pageSize;
      const search = String(req.query.search || "").trim();

      let where = "";
      const params = [];
      if (search) {
        where = "WHERE number LIKE ? OR email LIKE ?";
        params.push(`%${search}%`, `%${search}%`);
      }

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM mpaisa_mappings ${where}`,
        params
      );
      const [rows] = await pool.query(
        `SELECT number, email, email_status, account_status, source_logtime, updated_at
           FROM mpaisa_mappings ${where}
          ORDER BY updated_at DESC, number ASC
          LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({ rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
    } catch (e) {
      console.error("[mpaisa] list failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  }

  return { upload, list };
}
