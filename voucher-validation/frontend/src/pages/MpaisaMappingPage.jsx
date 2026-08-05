// src/pages/MpaisaMappingPage.jsx
// M-PAiSA number → email mapping. Admins upload the periodic customer report
// (a UTF-16 tab-separated SQL export); it upserts by number (updates existing,
// adds new) and lists the current mapping. Rows can also be added and edited by
// hand — those are tagged 'manual' until a report re-imports the same number.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet, Upload, Search, RefreshCw, Mail, Hash, Plus, Pencil, UserPlus,
} from "lucide-react";
import toast from "react-hot-toast";

import { mpaisaApi } from "../services/api";
import {
  PageHeader, Panel, Button, IconButton, Modal, Field, Input, Select, Badge,
} from "../components/ui";
import Pagination from "../components/shared/Pagination";

const PAGE_SIZE = 25;

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

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

function StatusPill({ value }) {
  if (!value) return <span className="text-[var(--fg-muted)]">—</span>;
  const active = String(value).toUpperCase() === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium",
        active ? "bg-emerald-500/10 text-emerald-500" : "bg-[var(--bg-surface)] text-[var(--fg-muted)]"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-emerald-500" : "bg-[var(--fg-muted)]")} />
      {value}
    </span>
  );
}

const STATUS_OPTIONS = ["", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"];

/**
 * The status columns are free-form text copied verbatim from the report, so a
 * row can hold a value outside the canonical list (real exports have contained
 * "ACTIVE," with a trailing comma). A native <select> given an unlisted value
 * falls back to its first option, which would show "Not set" next to a table
 * cell showing the real value, and a save would then silently overwrite it.
 * Keeping the current value as an option makes the dropdown truthful.
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

      <form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="flex flex-col gap-5">
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
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
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
      toast.success(
        `Ingested ${res.uniqueNumbers} numbers — ${res.inserted} new, ${res.updated} updated · ${res.total} total`,
        { id: tid, duration: 5000 }
      );
      if (page === 1) load();
      else setPage(1); // jump to first page → triggers reload
    } catch (err) {
      toast.error(err.message || "Upload failed", { id: tid });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Customers"
        title="M-PAiSA Mapping"
        subtitle="Phone number → customer email, ingested from the M-PAiSA customer report."
        icon={<Wallet size={20} />}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={onFile}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              iconLeft={<RefreshCw size={14} />}
              disabled={loading || uploading}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              iconLeft={<Upload size={14} />}
              loading={uploading}
            >
              Upload report
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing({ row: null })}
              iconLeft={<Plus size={14} />}
            >
              Add mapping
            </Button>
          </>
        }
      />

      <div className="mt-6">
        <Panel
          padding={false}
          title="Number → email"
          subtitle={`${total} mapped number${total === 1 ? "" : "s"}`}
          icon={<Hash size={15} />}
          actions={
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number or email…"
                className="w-64 max-w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-base)] border border-[var(--border-default)] rounded-lg text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 transition-all"
              />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--fg-muted)] border-b border-[var(--border-default)]">
                  <th className="px-5 py-3 font-medium">Number</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Email status</th>
                  <th className="px-5 py-3 font-medium">Account status</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Updated</th>
                  <th className="px-5 py-3 font-medium w-px" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-[var(--fg-muted)]">
                      {debounced
                        ? "No matches."
                        : "No mappings yet — upload the M-PAiSA report, or add one by hand."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.number} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-5 py-3 font-mono text-[var(--fg-primary)]">{r.number}</td>
                      <td className="px-5 py-3 text-[var(--fg-secondary)]">
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <Mail size={12} className="text-[var(--fg-muted)] shrink-0" />
                          <span className="truncate">{r.email || "—"}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3"><StatusPill value={r.email_status} /></td>
                      <td className="px-5 py-3"><StatusPill value={r.account_status} /></td>
                      <td className="px-5 py-3">
                        <Badge tone={r.source === "manual" ? "warning" : "neutral"}>
                          {r.source === "manual" ? "Manual" : "Import"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-[var(--fg-muted)] whitespace-nowrap">{relTime(r.updated_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <IconButton
                          size="sm"
                          onClick={() => setEditing({ row: r })}
                          title={`Edit ${r.number}`}
                          aria-label={`Edit ${r.number}`}
                        >
                          <Pencil size={14} />
                        </IconButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </Panel>
      </div>

      {editing && (
        <MappingModal
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
