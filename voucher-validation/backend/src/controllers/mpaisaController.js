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

/**
 * Normalise a typed phone number to the form the M-PAiSA report uses, so a
 * hand-added row is matchable by the same lookup as an imported one.
 *
 * Every record in the real reports is a bare 7-digit Fiji number, never country
 * coded. The receipt lookup (portalApiController.sendPurchaseReceipt) strips a
 * 679 prefix off the INCOMING callback phone but does not add one, so a mapping
 * stored as "6797771234" would never be found for a callback of "7771234".
 * Dropping the country code here keeps manual and imported rows in one format.
 */
export function normalizeNumber(input) {
  let n = String(input ?? "").replace(/\D/g, "");
  if (n.length === 10 && n.startsWith("679")) n = n.slice(3); // +679 7771234
  return n;
}

/**
 * Validate an add/edit payload. Returns { ok:true, value } or { ok:false, error }.
 * `number` is the primary key, so it is required and normalised to digits only
 * (the report stores bare digits, and the receipt lookup matches on digits).
 */
function validateMapping(body) {
  const number = normalizeNumber(body?.number);
  if (!number) return { ok: false, error: "A phone number is required." };
  if (number.length > 32) return { ok: false, error: "Phone number is too long (max 32 digits)." };

  const email = String(body?.email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (email.length > 255) return { ok: false, error: "Email is too long (max 255 characters)." };

  const trunc = (v, n) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, n) : null;
  };

  return {
    ok: true,
    value: {
      number,
      email: email || null,
      emailStatus: trunc(body?.emailStatus, 32),
      accountStatus: trunc(body?.accountStatus, 32),
    },
  };
}

export function makeMpaisaController(pool) {
  // POST /api/mpaisa — add a single mapping by hand.
  async function create(req, res) {
    try {
      const v = validateMapping(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { number, email, emailStatus, accountStatus } = v.value;

      try {
        await pool.query(
          `INSERT INTO mpaisa_mappings (number, email, email_status, account_status, source)
           VALUES (?, ?, ?, ?, 'manual')`,
          [number, email, emailStatus, accountStatus]
        );
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ error: `${number} is already mapped. Edit that row instead.` });
        }
        throw e;
      }

      const [rows] = await pool.query("SELECT * FROM mpaisa_mappings WHERE number = ?", [number]);
      res.status(201).json({ ok: true, row: rows[0] || null });
    } catch (e) {
      console.error("[mpaisa] create failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  }

  // PUT /api/mpaisa/:number — edit a mapping. The number itself is editable
  // (it is the primary key), so a changed number is a keyed move: it must not
  // collide with an existing row, and the original must still exist.
  async function update(req, res) {
    try {
      const original = String(req.params.number ?? "").trim();
      if (!original) return res.status(400).json({ error: "Missing number." });

      const v = validateMapping(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { number, email, emailStatus, accountStatus } = v.value;

      const [existing] = await pool.query("SELECT number FROM mpaisa_mappings WHERE number = ?", [original]);
      if (!existing.length) return res.status(404).json({ error: `${original} is no longer mapped.` });

      if (number !== original) {
        const [clash] = await pool.query("SELECT number FROM mpaisa_mappings WHERE number = ?", [number]);
        if (clash.length) {
          return res.status(409).json({ error: `${number} is already mapped to another record.` });
        }
      }

      // An edited row is admin-authored from here on, even if it arrived by
      // import: the next report upload will flip it back to 'import'.
      try {
        await pool.query(
          `UPDATE mpaisa_mappings
              SET number = ?, email = ?, email_status = ?, account_status = ?, source = 'manual'
            WHERE number = ?`,
          [number, email, emailStatus, accountStatus, original]
        );
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ error: `${number} is already mapped to another record.` });
        }
        throw e;
      }

      const [rows] = await pool.query("SELECT * FROM mpaisa_mappings WHERE number = ?", [number]);
      res.json({ ok: true, row: rows[0] || null });
    } catch (e) {
      console.error("[mpaisa] update failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  }

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
      const values = rows.map((r) => [r.number, r.email, r.emailStatus, r.accountStatus, r.logtime, "import"]);
      // The report is the system of record: a number present in it reverts to
      // 'import', overwriting any hand-edit for that same number.
      await pool.query(
        `INSERT INTO mpaisa_mappings (number, email, email_status, account_status, source_logtime, source)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           email = VALUES(email),
           email_status = VALUES(email_status),
           account_status = VALUES(account_status),
           source_logtime = VALUES(source_logtime),
           source = 'import',
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
        `SELECT number, email, email_status, account_status, source_logtime, source, updated_at
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

  return { upload, list, create, update };
}
