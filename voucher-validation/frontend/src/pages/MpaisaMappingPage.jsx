// src/pages/MpaisaMappingPage.jsx
// M-PAiSA number → email mapping. Admins upload the periodic customer report
// (a UTF-16 tab-separated SQL export); it upserts by number (updates existing,
// adds new) and lists the current mapping. First cut: ingest + view.

import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet, Upload, Search, RefreshCw, Mail, Hash } from "lucide-react";
import toast from "react-hot-toast";

import { mpaisaApi } from "../services/api";
import { PageHeader, Panel, Button } from "../components/ui";
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

export default function MpaisaMappingPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
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
              variant="primary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              iconLeft={<Upload size={14} />}
              loading={uploading}
            >
              Upload report
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
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Updated</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-[var(--fg-muted)]">
                      {debounced ? "No matches." : "No mappings yet — upload the M-PAiSA report to get started."}
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
                      <td className="px-5 py-3 text-[var(--fg-muted)] whitespace-nowrap">{relTime(r.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </Panel>
      </div>
    </div>
  );
}
