// src/components/campaigns/SuppressionsPanel.jsx
//
// Excluded addresses: inboxes no campaign will ever send to, whatever its
// audience says. Campaigns carry no unsubscribe link, so this list is how the
// team stops emailing someone — the customer who rang to say "stop emailing
// me", a staff inbox that sits in the M-PAiSA mapping, an address that keeps
// bouncing. Kept apart from the mapping so a report re-import cannot undo it.
// Removing one is confirmed, because it quietly puts that inbox back into every
// future "everyone" campaign.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MailX, Plus, Trash2, RefreshCw } from "lucide-react";
import { campaignApi } from "../../services/api";
import {
  Panel, SearchInput, DataTable, Th, Td, TableMessage, Button, IconButton, Input, ConfirmDialog,
} from "../ui";
import Pagination from "../shared/Pagination";
import { relTime, fmtDateTime, plural } from "./campaignUi";

const PAGE_SIZE = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SuppressionsPanel({ onChanged }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ suppressions: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null); // the row being confirmed
  const [removeBusy, setRemoveBusy] = useState(false);

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
      const res = await campaignApi.suppressions({ search: debounced, page, pageSize: PAGE_SIZE });
      setData({ suppressions: res.suppressions || [], total: res.total || 0, totalPages: res.totalPages || 1 });
      if (page > (res.totalPages || 1)) setPage(res.totalPages || 1);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    const email = address.trim();
    if (!EMAIL_RE.test(email)) {
      toast.error("That doesn't look like an email address");
      return;
    }
    setAdding(true);
    try {
      await campaignApi.addSuppression(email, note.trim());
      toast.success(`${email} won't receive campaigns`);
      setAddress("");
      setNote("");
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await campaignApi.removeSuppression(removing.email);
      toast.success(`${removing.email} can receive campaigns again`);
      setRemoving(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <>
      <Panel
        padding={false}
        title="Excluded addresses"
        subtitle="Never emailed by a campaign, whatever its audience"
        icon={<MailX size={15} />}
        tone="orange"
      >
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address…"
            width="w-full lg:w-72"
          />
          {/* On a phone the add form stacks under the search, set apart by a rule
              so the two boxes do not read as one search. */}
          <form
            onSubmit={add}
            className="flex w-full min-w-0 items-center gap-2 lg:ml-auto lg:w-auto max-sm:flex-col max-sm:items-stretch max-sm:border-t max-sm:border-[var(--border-subtle)] max-sm:pt-3"
          >
            <label htmlFor="exclude-email" className="sr-only">Address to exclude</label>
            <Input
              id="exclude-email"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Exclude an address…"
              autoComplete="off"
              className="h-9! min-w-0 lg:w-60 max-sm:h-10!"
            />
            <label htmlFor="exclude-note" className="sr-only">Why (optional)</label>
            <Input
              id="exclude-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why (optional)"
              maxLength={255}
              autoComplete="off"
              className="h-9! min-w-0 lg:w-48 max-sm:h-10!"
            />
            <Button
              type="submit"
              size="md"
              variant="secondary"
              loading={adding}
              disabled={!address.trim()}
              iconLeft={<Plus size={14} />}
              className="max-sm:w-full"
            >
              Add
            </Button>
          </form>
        </div>

        <DataTable>
          <thead>
            <tr>
              <Th>Address</Th>
              <Th>Why</Th>
              <Th>Added</Th>
              {/* Named by aria-label: DataTable copies header TEXT onto each cell as
                  its phone label. On a phone the button moves beside the address. */}
              <th className="text-right" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableMessage colSpan={4}>
                <span className="inline-flex flex-col items-center gap-2">
                  Could not load the list: {error}
                  <Button size="xs" variant="secondary" onClick={load} iconLeft={<RefreshCw size={12} />}>Retry</Button>
                </span>
              </TableMessage>
            ) : loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={4}><div className="h-8 skeleton" /></td></tr>
              ))
            ) : data.suppressions.length === 0 ? (
              <TableMessage colSpan={4}>
                {debounced
                  ? "No excluded address matches that search."
                  : "No addresses are excluded. Add one above to leave it out of every campaign."}
              </TableMessage>
            ) : (
              data.suppressions.map((s) => (
                <tr key={s.email}>
                  <Td>
                    <div className="flex items-center gap-2 max-sm:w-full">
                      <span className="block min-w-0 max-w-[320px] truncate font-semibold text-[var(--fg-primary)] max-sm:max-w-none max-sm:flex-1">
                        {s.email}
                      </span>
                      <IconButton
                        size="sm"
                        onClick={() => setRemoving(s)}
                        title={`Allow campaigns to ${s.email} again`}
                        aria-label={`Remove ${s.email} from the list`}
                        className="-my-1 shrink-0 sm:hidden"
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </Td>
                  <Td>
                    <span className="block max-w-[280px] truncate text-[var(--fg-secondary)]" title={s.note || undefined}>
                      {s.note || <span className="text-[var(--fg-subtle)]">—</span>}
                    </span>
                  </Td>
                  <Td muted nowrap>
                    {/* One element, so a phone card keeps "when · who" together. */}
                    <span>
                      <span title={fmtDateTime(s.createdAt)}>{relTime(s.createdAt)}</span>
                      {s.createdByEmail && <span className="text-[var(--fg-subtle)]"> · {s.createdByEmail}</span>}
                    </span>
                  </Td>
                  <Td align="right" className="max-sm:hidden!">
                    <IconButton
                      size="sm"
                      onClick={() => setRemoving(s)}
                      title={`Allow campaigns to ${s.email} again`}
                      aria-label={`Remove ${s.email} from the list`}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        <Pagination page={page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />
        {!loading && !error && data.totalPages <= 1 && data.total > 0 && (
          <p className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-2.5 text-[12px] text-[var(--fg-muted)]">
            {plural(data.total, "address", "addresses")}
          </p>
        )}
      </Panel>

      <ConfirmDialog
        open={!!removing}
        title="Email this address again?"
        message={`${removing?.email} will be back in every future campaign it matches.${removing?.note ? ` It was excluded because: ${removing.note}` : ""}`}
        confirmLabel="Remove from list"
        loading={removeBusy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
