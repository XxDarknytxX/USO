// src/components/UnmappedTransactions.jsx
// Phone numbers seen in transactions that have no M-PAiSA mapping — the people
// we hold money from and cannot email. Exportable as CSV so the list can be
// handed to the team that can supply the missing addresses.
//
// One row per NUMBER, not per transaction: the list exists to be actioned per
// customer, so how many times they bought is a column, not extra rows.
//
// It renders as a single Panel rather than a page: the M-PAiSA page already
// owns the header and the Mappings/Unmapped switch, so this component's own
// controls sit in the card header where they belong to this list alone.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Download, RefreshCw, UserX, Phone } from "lucide-react";
import { format } from "date-fns";
import { mpaisaApi } from "../services/api";
import {
  Panel, Button, EmptyState, SearchInput, DataTable, Th, Td, TableMessage,
} from "./ui";
import Pagination from "./shared/Pagination";
import { PHONE_CARD, PhoneMore, phoneRowClass } from "./ui/phone";

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
  return "﻿" + [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
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
  const [showAll, setShowAll] = useState(false); // phone: the page of 25 is capped until asked

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
      tone="orange"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number…"
            width="w-full sm:w-56"
          />
          <Button variant="secondary" size="sm" className="max-sm:flex-1" onClick={load} disabled={loading} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="max-sm:flex-1"
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
      <DataTable>
        <thead>
          <tr>
            <Th>Phone</Th>
            <Th align="right">Transactions</Th>
            <Th align="right">Total spent</Th>
            <Th>Last seen</Th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <TableMessage colSpan={4}>Loading…</TableMessage>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4}>
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
            rows.map((r, i) => (
              // A phone card of two lines: the number with what it has spent
              // beside it — the figure that decides whether this one is worth
              // chasing — then how often and how recently, as small tiles.
              <tr key={r.phone} className={phoneRowClass(i, showAll)}>
                <Td nowrap className={PHONE_CARD.title}>
                  <span className="font-mono text-[13px] font-semibold text-[var(--fg-primary)]">
                    {r.phone}
                  </span>
                </Td>
                <Td align="right" className={`tabular-nums ${PHONE_CARD.stat}`}>{r.transactions.toLocaleString()}</Td>
                <Td align="right" strong className={`tabular-nums ${PHONE_CARD.aside}`}>{fmtMoney(r.totalAmount)}</Td>
                <Td nowrap className={`max-sm:col-span-4 ${PHONE_CARD.cell}`}>{fmtDate(r.lastAt)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
      <PhoneMore
        total={rows.length}
        expanded={showAll}
        onToggle={() => setShowAll((v) => !v)}
        noun="numbers"
      />
      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </Panel>
  );
}
