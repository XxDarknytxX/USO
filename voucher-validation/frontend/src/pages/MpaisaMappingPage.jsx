// src/pages/MpaisaMappingPage.jsx
// M-PAiSA number → email mapping. Admins upload the periodic customer report
// (a UTF-16 tab-separated SQL export); it upserts by number (updates existing,
// adds new) and lists the current mapping. Rows can also be added and edited by
// hand — those are tagged 'manual' until a report re-imports the same number.
//
// The page is two views of one subject: the numbers we can email, and the
// paying customers we cannot. They share a Toolbar switch rather than living on
// separate routes, because the whole point of the unmapped list is that it is
// the backlog for this one.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet, RefreshCw, Upload, Mail, Hash, Plus, Pencil, UserPlus,
} from "lucide-react";
import toast from "react-hot-toast";

import { mpaisaApi } from "../services/api";
import UnmappedTransactions from "../components/UnmappedTransactions";
import {
  PageShell, PageHeader, Panel, Toolbar, SearchInput, Segmented,
  DataTable, Th, Td, TableMessage, StatusPill,
  Button, IconButton, Modal, Field, Input, Select, Badge,
} from "../components/ui";
import Pagination from "../components/shared/Pagination";
import { PHONE_CARD, PhoneMore, phoneRowClass } from "../components/ui/phone";
// The header's phone button row is the campaign screens' one (M-PAiSA Mapping is
// where their audience comes from), so it is borrowed rather than copied.
import { PHONE_HEADER_BARE } from "../components/campaigns/campaignUi";

const PAGE_SIZE = 25;

/**
 * A full-width, label-less line inside a phone card — for a value that says what
 * it is on its own (an email address beside an envelope). The stacked-table
 * rules in main.css are unlayered, so each property they set has to be taken
 * back with the important form.
 */
const PHONE_WIDE =
  "max-sm:col-span-6 max-sm:text-left! max-sm:before:hidden! max-sm:[&>*]:ml-0!";

/**
 * Read an uploaded report file → decoded UTF-8 text. The report is a UTF-16
 * (usually little-endian, BOM'd) tab-separated SQL export; sniff the encoding
 * from the BOM / NUL pattern and fall back to UTF-8.
 */
async function readReportText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let enc = "utf-8";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) enc = "utf-16le";
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) enc = "utf-16be";
  else {
    // No BOM: ASCII text stored as UTF-16LE has a 0x00 as every high byte.
    let zeros = 0;
    const n = Math.min(buf.length, 400);
    for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++;
    if (zeros > n / 8) enc = "utf-16le";
  }
  return new TextDecoder(enc).decode(buf);
}

function relTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  if (!Number.isFinite(d)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_TONES = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  PENDING: "warning",
  SUSPENDED: "danger",
};

/**
 * The status columns are free-form text copied verbatim from the report, so the
 * label is whatever the file said (real exports have contained "ACTIVE," with a
 * trailing comma). Only the tone is derived, from the letters alone.
 */
function ReportStatus({ value }) {
  if (!value) return <span className="text-[var(--fg-muted)]">—</span>;
  const key = String(value).toUpperCase().replace(/[^A-Z]/g, "");
  return <StatusPill tone={STATUS_TONES[key] || "neutral"}>{value}</StatusPill>;
}

const STATUS_OPTIONS = ["", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"];

/**
 * A row can hold a status outside the canonical list. A native <select> given an
 * unlisted value falls back to its first option, which would show "Not set" next
 * to a table cell showing the real value, and a save would then silently
 * overwrite it. Keeping the current value as an option makes the dropdown
 * truthful.
 */
function statusOptions(current) {
  const c = String(current ?? "").trim();
  return c && !STATUS_OPTIONS.includes(c) ? [...STATUS_OPTIONS, c] : STATUS_OPTIONS;
}

/**
 * Mirror of the server's normalizeNumber (mpaisaController.js). Used only to
 * preview the stored value, so the admin can see the country code being dropped
 * instead of it happening silently. The server normalises again regardless.
 */
function normalizeNumber(input) {
  let n = String(input ?? "").replace(/\D/g, "");
  if (n.length === 10 && n.startsWith("679")) n = n.slice(3);
  return n;
}

/**
 * Add / edit one mapping. `row` null = add. The number is the primary key and is
 * editable, so the original is kept separately to address the row server-side.
 */
function MappingModal({ row, onClose, onSaved }) {
  const isEdit = !!row;
  const [form, setForm] = useState({
    number: row?.number || "",
    email: row?.email || "",
    emailStatus: row?.email_status || "",
    accountStatus: row?.account_status || "",
  });
  const [saving, setSaving] = useState(false);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const normalized = normalizeNumber(form.number);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await mpaisaApi.update(row.number, form);
      else await mpaisaApi.create(form);
      toast.success(isEdit ? "Mapping updated" : "Mapping added");
      onSaved();
      onClose();
    } catch (err) {
      // Surfaces the server's own message (duplicate number, invalid email, …).
      toast.error(err?.message || "Could not save the mapping", { duration: 6000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} width="md">
      <Modal.Header
        eyebrow={isEdit ? "Edit mapping" : "New mapping"}
        title={isEdit ? "Edit this mapping" : "Add a mapping by hand"}
        subtitle={
          isEdit
            ? "Re-uploading a report that contains this number will overwrite these values."
            : "Use this for a customer who is not in the latest M-PAiSA report yet."
        }
        icon={isEdit ? Pencil : UserPlus}
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <Modal.Body>
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Phone number"
                required
                htmlFor="m-number"
                hint="Digits only. A 679 country code is dropped so it matches the report format."
              >
                <Input
                  id="m-number"
                  value={form.number}
                  onChange={(e) => setField("number", e.target.value)}
                  placeholder="7654321"
                  required
                  mono
                  autoFocus
                />
                {normalized && normalized !== form.number.trim() && (
                  <p className="mt-1.5 text-[11.5px] text-[var(--fg-muted)]">
                    Saved as <span className="font-mono text-[var(--fg-secondary)]">{normalized}</span>
                  </p>
                )}
              </Field>

              <Field label="Email" htmlFor="m-email" hint="Where the receipt is sent.">
                <Input
                  id="m-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="customer@example.com"
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Email status" htmlFor="m-estatus">
                <Select
                  id="m-estatus"
                  value={form.emailStatus}
                  onChange={(e) => setField("emailStatus", e.target.value)}
                >
                  {statusOptions(form.emailStatus).map((s) => (
                    <option key={s || "none"} value={s}>{s || "Not set"}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Account status" htmlFor="m-astatus">
                <Select
                  id="m-astatus"
                  value={form.accountStatus}
                  onChange={(e) => setField("accountStatus", e.target.value)}
                >
                  {statusOptions(form.accountStatus).map((s) => (
                    <option key={s || "none"} value={s}>{s || "Not set"}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!form.number.trim()}>
            {isEdit ? "Save changes" : "Add mapping"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

export default function MpaisaMappingPage() {
  // "mapped" = the mapping table; "unmapped" = paying customers we cannot email.
  const [tab, setTab] = useState("mapped");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAll, setShowAll] = useState(false); // phone: the page of 25 is capped until asked
  // null = closed; { row: null } = add; { row } = edit that row.
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);

  // Debounce the search box, resetting to page 1 when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mpaisaApi.list({ page, pageSize: PAGE_SIZE, search: debounced });
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    const tid = toast.loading("Ingesting report…");
    try {
      const text = await readReportText(file);
      const res = await mpaisaApi.upload(text);
      const summary = `Ingested ${res.uniqueNumbers} numbers — ${res.inserted} new, ${res.updated} updated · ${res.total} total`;
      // A skipped row is a customer the file carried and we could not use. It
      // is the only warning that someone is missing from the mapping, so it
      // gets its own toast rather than being buried in the success line.
      if (res.skippedRows > 0) {
        toast.success(summary, { id: tid, duration: 5000 });
        toast.error(
          `${res.skippedRows} row${res.skippedRows === 1 ? "" : "s"} skipped — the number could not be read, so those customers are not mapped.`,
          { duration: 9000 }
        );
      } else {
        toast.success(summary, { id: tid, duration: 5000 });
      }
      if (page === 1) load();
      else setPage(1); // jump to first page → triggers reload
    } catch (err) {
      toast.error(err.message || "Upload failed", { id: tid });
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Customers"
        title="M-PAiSA Mapping"
        // The app bar names the screen on a phone; the sentence is desktop
        // context, and the panel below repeats the count anyway.
        subtitle={<span className="max-sm:hidden">Phone number → customer email, ingested from the M-PAiSA customer report.</span>}
        icon={<Wallet size={22} />}
        tone="teal"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={onFile}
            />
            <IconButton
              variant="secondary"
              size="md"
              className="sm:hidden"
              onClick={load}
              disabled={loading || uploading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </IconButton>
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              iconLeft={<RefreshCw size={14} />}
              disabled={loading || uploading}
              className="max-sm:hidden"
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              iconLeft={<Upload size={14} />}
              loading={uploading}
              className="max-sm:flex-1"
            >
              {/* Three buttons only fit on one phone row if this one is short. */}
              <span className="max-sm:hidden">Upload report</span>
              <span className="sm:hidden">Upload</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing({ row: null })}
              iconLeft={<Plus size={14} />}
              className="max-sm:flex-1"
            >
              Add mapping
            </Button>
          </>
        }
        className={PHONE_HEADER_BARE}
      />

      {/* One strip for both views: the switch, and the filter that belongs to
          whichever view is showing. The unmapped list carries its own controls
          because its search, refresh and export are the component's own state. */}
      <Toolbar>
        <Segmented
          options={[
            { value: "mapped", label: "Mappings", count: total },
            { value: "unmapped", label: "Unmapped customers" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "mapped" && (
          <>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number or email…"
              width="w-full sm:w-72"
            />
            <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums max-sm:hidden">
              {debounced ? `${total.toLocaleString()} matching` : `${total.toLocaleString()} mapped`}
            </span>
          </>
        )}
      </Toolbar>

      {tab === "unmapped" ? (
        <UnmappedTransactions />
      ) : (
        <Panel
          padding={false}
          title="Number → email"
          subtitle={`${total.toLocaleString()} mapped number${total === 1 ? "" : "s"}`}
          icon={<Hash size={15} />}
          tone="teal"
        >
          <DataTable>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Email</Th>
                <Th>Email status</Th>
                <Th>Account status</Th>
                <Th>Source</Th>
                <Th>Updated</Th>
                <Th align="right">Edit</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableMessage colSpan={7}>Loading…</TableMessage>
              ) : rows.length === 0 ? (
                <TableMessage colSpan={7}>
                  {debounced
                    ? "No matches."
                    : "No mappings yet — upload the M-PAiSA report, or add one by hand."}
                </TableMessage>
              ) : (
                rows.map((r, i) => (
                  // A phone card of three lines rather than six labelled ones:
                  // the number and its Edit button, the address, then where the
                  // row came from and when it last moved. The two report status
                  // columns are usually empty and drop out of the card on their
                  // own (DataTable marks a "—" cell blank).
                  <tr key={r.number} className={phoneRowClass(i, showAll)}>
                    <Td nowrap className={PHONE_CARD.title}>
                      <span className="font-mono text-[13px] font-semibold text-[var(--fg-primary)]">
                        {r.number}
                      </span>
                    </Td>
                    <Td className={`max-sm:row-start-2 ${PHONE_WIDE}`}>
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <Mail size={12} className="text-[var(--fg-muted)] shrink-0" />
                        {/* A phone card has no "EMAIL" label beside it to explain
                            a bare dash, so there it says what is missing.
                            Desktop keeps the dash the column has always had. */}
                        <span className="truncate max-sm:hidden">{r.email || "—"}</span>
                        <span className={`truncate sm:hidden ${r.email?.trim() ? "" : "text-[var(--fg-subtle)]"}`}>
                          {r.email?.trim() ? r.email : "No email"}
                        </span>
                      </span>
                    </Td>
                    <Td className={PHONE_CARD.stat}><ReportStatus value={r.email_status} /></Td>
                    <Td className={PHONE_CARD.stat}><ReportStatus value={r.account_status} /></Td>
                    <Td className="max-sm:col-span-3 max-sm:before:hidden! max-sm:justify-start! max-sm:[&>*]:ml-0!">
                      <Badge tone={r.source === "manual" ? "warning" : "neutral"}>
                        {r.source === "manual" ? "Manual" : "Import"}
                      </Badge>
                    </Td>
                    <Td muted nowrap className="max-sm:col-span-3 max-sm:before:hidden!">{relTime(r.updated_at)}</Td>
                    <Td align="right" className={PHONE_CARD.aside}>
                      <IconButton
                        size="sm"
                        onClick={() => setEditing({ row: r })}
                        title={`Edit ${r.number}`}
                        aria-label={`Edit ${r.number}`}
                      >
                        <Pencil size={14} />
                      </IconButton>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
          <PhoneMore
            total={rows.length}
            expanded={showAll}
            onToggle={() => setShowAll((v) => !v)}
            noun="mappings"
          />
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </Panel>
      )}

      {editing && (
        <MappingModal
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </PageShell>
  );
}
