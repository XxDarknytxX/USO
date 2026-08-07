// src/components/UnmappedTransactions.jsx
// Phone numbers seen in transactions that have no M-PAiSA mapping — the people
// we hold money from and cannot email. Exportable as CSV so the list can be
// handed to the team that can supply the missing addresses.
//
// One row per NUMBER, not per transaction: the list exists to be actioned per
// customer, so how many times they bought is a column, not extra rows.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Search, Download, RefreshCw, UserX } from "lucide-react";
import { format } from "date-fns";
import { mpaisaApi } from "../services/api";
import { Panel, Button, EmptyState } from "./ui";
import Pagination from "./shared/Pagination";

const PAGE_SIZE = 25;

const fmtMoney = (n) => "$" + Number(n || 0).toFixed(2);
const fmtDate = (d) => (d ? format(new Date(d), "d MMM yyyy, HH:mm") : "—");

/** RFC-4180 escaping: quote anything containing a comma, quote or newline. */
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows) {
  const header = ["Phone", "Transactions", "Total spent (FJD)", "Last seen"];
  const body = rows.map((r) => [
    r.phone || "",
    r.transactions ?? "",
    Number(r.totalAmount || 0).toFixed(2),
    r.lastAt ? format(new Date(r.lastAt), "yyyy-MM-dd HH:mm:ss") : "",
  ]);
  // Leading BOM so Excel reads it as UTF-8 rather than the local codepage,
  // which otherwise mangles village names. Written as an escape because the
  // literal character is invisible in source and gets stripped by tooling.
  return "\uFEFF" + [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export default function UnmappedTransactions() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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
      const data = await mpaisaApi.unmapped({ page, pageSize: PAGE_SIZE, search: debounced });
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

  // Exports everything matching the current search, not just the page on screen.
  async function exportCsv() {
    setExporting(true);
    const tid = toast.loading("Building the file…");
    try {
      const data = await mpaisaApi.unmapped({ all: 1, search: debounced });
      const all = data.rows || [];
      if (all.length === 0) {
        toast.error("Nothing to export.", { id: tid });
        return;
      }
      const blob = new Blob([buildCsv(all)], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `unmapped-customers-${format(new Date(), "yyyy-MM-dd")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length.toLocaleString()} numbers`, { id: tid });
      // A silent cap would read as "that was all of them".
      if (data.truncated) {
        toast.error(
          `Capped at ${all.length.toLocaleString()} rows — there are ${data.total.toLocaleString()} in total. Narrow the search and export again.`,
          { duration: 9000 }
        );
      }
    } catch (e) {
      toast.error(e.message || "Export failed", { id: tid });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Panel
      padding={false}
      title="Numbers with no mapping"
      subtitle={
        total === 0
          ? "Every number seen in a transaction has an email on file."
          : `${total.toLocaleString()} number${total === 1 ? "" : "s"} seen in transactions with no email mapping`
      }
      icon={<UserX size={15} />}
      actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number…"
              className="h-8 pl-8 pr-3 w-56 text-[12.5px] rounded-md bg-[var(--surface-sunken)] border border-[var(--border-default)] text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:border-[var(--brand)]"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={exportCsv}
            loading={exporting}
            disabled={total === 0 || exporting}
            iconLeft={!exporting && <Download size={14} />}
          >
            Export CSV
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-[var(--border-default)]">
              <Th>Phone</Th>
              <Th>Transactions</Th>
              <Th>Total spent</Th>
              <Th>Last seen</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-default)]">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-[var(--fg-muted)]">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8">
                  <EmptyState
                    icon={UserX}
                    title={debounced ? "No matches" : "Every number is mapped"}
                    description={
                      debounced
                        ? "No unmapped number matches that search."
                        : "Every number seen in a transaction has an email address on file."
                    }
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.phone} className="hover:bg-[var(--bg-surface)] transition-colors">
                  <td className="px-5 py-3 font-mono font-semibold text-[var(--fg-primary)]">{r.phone}</td>
                  <td className="px-5 py-3 tabular-nums text-[var(--fg-secondary)]">{r.transactions.toLocaleString()}</td>
                  <td className="px-5 py-3 tabular-nums text-[var(--fg-primary)]">{fmtMoney(r.totalAmount)}</td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap text-[12.5px]">{fmtDate(r.lastAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </Panel>
  );
}

function Th({ children }) {
  return <th className="px-5 py-2.5 text-label">{children}</th>;
}
