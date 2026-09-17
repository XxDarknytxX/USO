// src/components/campaigns/AudienceEditor.jsx
//
// Who a campaign goes to. Two honest modes, because they are two different
// intentions: "everyone we can email, perhaps narrowed" is a broadcast, and
// "these particular people" is a message. Mixing them — a broadcast with a few
// hand-ticked extras — is where people get emailed who nobody meant to email.
//
// The number that matters is asked of the SERVER, not counted here: it knows
// who has been excluded since the page was opened, and it is the same query the
// sender will run. The count shown is the count the Send button promises.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Check, X, MailX, Loader2, RefreshCw, MapPin, ShoppingBag } from "lucide-react";
import { campaignApi } from "../../services/api";
import {
  Segmented, Toggle, SearchInput, DataTable, Th, Td, TableMessage, Badge, Button, ObjectTile,
} from "../ui";
import Pagination from "../shared/Pagination";
import { plural } from "./campaignUi";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

const PICKER_PAGE_SIZE = 20;

/**
 * Debounced POST /audience-count. Returns the last good answer while a new one
 * is on its way, so the number does not blink to nothing on every tick of a
 * checkbox.
 */
export function useAudienceCount(audience, { delay = 500 } = {}) {
  const key = JSON.stringify({
    mode: audience.mode,
    purchasersOnly: !!audience.purchasersOnly,
    groupIds: [...(audience.groupIds || [])].sort(),
    selected: [...(audience.selected || [])].sort(),
  });
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const data = await campaignApi.audienceCount(JSON.parse(key));
        if (mine === seq.current) setState({ data, loading: false, error: null });
      } catch (e) {
        if (mine === seq.current) setState({ data: null, loading: false, error: e.message });
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [key, delay, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/* ───────────────────────── Everyone ───────────────────────── */

function VillageChips({ sites, groupIds, onChange }) {
  const withGroup = sites.filter((s) => s.ruijieGroupId);
  const known = new Set(withGroup.map((s) => String(s.ruijieGroupId)));
  // A saved group id whose village has since been deleted still narrows the
  // audience on the server. It is shown so it can be taken off, not hidden.
  const orphans = groupIds.filter((g) => !known.has(String(g)));
  const chosen = new Set(groupIds.map(String));

  const toggle = (gid) => {
    const g = String(gid);
    onChange(chosen.has(g) ? groupIds.filter((x) => String(x) !== g) : [...groupIds, g]);
  };

  const chip = (active) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors focus-ring font-display",
      active
        ? "border-[var(--brand-soft-hover)] bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
        : "border-[var(--border-default)] bg-[var(--surface)] text-[var(--fg-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--fg-primary)]"
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium tracking-tight text-[var(--text-secondary)]">Villages they bought in</span>
        {groupIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11.5px] font-semibold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)] font-display"
          >
            Any village
          </button>
        )}
      </div>
      {withGroup.length === 0 && orphans.length === 0 ? (
        <p className="text-[12px] text-[var(--fg-muted)]">No villages with a Ruijie group yet — add them under Network.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Villages">
          {withGroup.map((s) => {
            const active = chosen.has(String(s.ruijieGroupId));
            return (
              <button key={s.id} type="button" aria-pressed={active} onClick={() => toggle(s.ruijieGroupId)} className={chip(active)}>
                {active ? <Check size={12} strokeWidth={3} /> : <MapPin size={12} className="text-[var(--fg-muted)]" />}
                {s.name}
              </button>
            );
          })}
          {orphans.map((g) => (
            <button key={`orphan-${g}`} type="button" aria-pressed onClick={() => toggle(g)} className={chip(true)} title="This village no longer exists under Network">
              <X size={12} strokeWidth={3} />
              Group {g} (removed)
            </button>
          ))}
        </div>
      )}
      <p className="text-[11.5px] leading-snug text-[var(--text-tertiary)]">
        {groupIds.length === 0
          ? "None picked means any village — including customers who have never bought."
          : "Only customers who bought in one of these villages. Customers who never bought are left out."}
      </p>
    </div>
  );
}

/* ───────────────────────── Chosen ───────────────────────── */

function ContactPicker({ selected, onChange, contactsByEmail, onRemember }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ contacts: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const data = await campaignApi.contacts({ search: debounced, page, pageSize: PICKER_PAGE_SIZE });
      if (mine !== seq.current) return;
      setResult({ contacts: data.contacts || [], total: data.total || 0, totalPages: data.totalPages || 1 });
      onRemember(data.contacts || []);
    } catch (e) {
      if (mine === seq.current) setError(e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [debounced, page, onRemember]);

  useEffect(() => { load(); }, [load]);

  const chosen = useMemo(() => new Set(selected), [selected]);
  const eligible = result.contacts.filter((c) => !c.suppressed);
  const allOnPage = eligible.length > 0 && eligible.every((c) => chosen.has(c.emailNorm));

  const toggle = (c) => {
    if (c.suppressed) return;
    onChange(chosen.has(c.emailNorm) ? selected.filter((e) => e !== c.emailNorm) : [...selected, c.emailNorm]);
  };
  const togglePage = () => {
    const ids = eligible.map((c) => c.emailNorm);
    if (allOnPage) onChange(selected.filter((e) => !ids.includes(e)));
    else onChange([...selected, ...ids.filter((e) => !chosen.has(e))]);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The choice so far, above the list it was picked from — so removing
          someone never means paging back to find them. */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label">{selected.length ? plural(selected.length, "customer") + " chosen" : "Nobody chosen yet"}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11.5px] font-semibold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)] font-display"
            >
              Clear all
            </button>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="mt-1 text-[12px] text-[var(--fg-muted)]">Search below and tick the customers this email is for.</p>
        ) : (
          <div className="mt-2 flex max-h-[148px] flex-wrap gap-1.5 overflow-y-auto">
            {selected.map((e) => {
              const c = contactsByEmail[e];
              return (
                <span
                  key={e}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[12px] font-medium",
                    c?.missing
                      ? "bg-[var(--danger-soft)] text-[var(--danger-fg)] line-through decoration-1"
                      : c?.suppressed
                        ? "bg-[var(--warning-soft)] text-[var(--warning-fg)]"
                        : "bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)]"
                  )}
                  title={
                    c?.missing
                      ? "No longer in the M-PAiSA mapping — will not receive this"
                      : c?.suppressed
                        ? "Excluded — will be left out"
                        : c?.phone ? `${c.email} · ${c.phone}` : e
                  }
                >
                  <span className="truncate">{c?.email || e}</span>
                  <button
                    type="button"
                    onClick={() => onChange(selected.filter((x) => x !== e))}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full opacity-70 transition hover:bg-[var(--surface)] hover:opacity-100"
                    aria-label={`Remove ${c?.email || e}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {selected.some((e) => contactsByEmail[e]?.missing) && (
          <p className="mt-2 text-[12px] text-[var(--danger-fg)]">
            {plural(selected.filter((e) => contactsByEmail[e]?.missing).length, "chosen address is", "chosen addresses are")} no longer
            in the M-PAiSA mapping and will not receive this — remove {selected.filter((e) => contactsByEmail[e]?.missing).length === 1 ? "it" : "them"} or pick again.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or number…"
            width="w-full sm:w-72"
          />
          <span className="ml-auto text-[12px] tabular-nums text-[var(--fg-muted)]">
            {loading ? "Searching…" : debounced ? `${result.total.toLocaleString()} matching` : `${result.total.toLocaleString()} contacts`}
          </span>
        </div>
        <DataTable maxHeight={360}>
          <thead>
            <tr>
              <Th className="w-10">
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={togglePage}
                  disabled={eligible.length === 0}
                  aria-label="Choose everyone on this page"
                  className="cursor-pointer align-middle accent-[var(--brand)]"
                />
              </Th>
              <Th>Customer</Th>
              <Th align="right">Bought</Th>
              <Th>Villages</Th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableMessage colSpan={4}>
                <span className="inline-flex flex-col items-center gap-2">
                  Could not load contacts: {error}
                  <Button size="xs" variant="secondary" onClick={load} iconLeft={<RefreshCw size={12} />}>Retry</Button>
                </span>
              </TableMessage>
            ) : loading && result.contacts.length === 0 ? (
              <TableMessage colSpan={4}>Loading contacts…</TableMessage>
            ) : result.contacts.length === 0 ? (
              <TableMessage colSpan={4}>
                {debounced ? "Nobody matches that search." : "No contacts with an email yet — they come from M-PAiSA Mapping."}
              </TableMessage>
            ) : (
              result.contacts.map((c) => {
                const on = chosen.has(c.emailNorm);
                const extra = (c.phones?.length || 0) - 1;
                return (
                  <tr
                    key={c.emailNorm}
                    onClick={() => toggle(c)}
                    className={cn(
                      c.suppressed ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      on && "[&>td]:bg-[var(--brand-soft)]",
                      loading && "opacity-70"
                    )}
                  >
                    <td className="w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={c.suppressed}
                        onChange={() => toggle(c)}
                        aria-label={`Choose ${c.email}`}
                        className="cursor-pointer align-middle accent-[var(--brand)] disabled:cursor-not-allowed"
                      />
                    </td>
                    <Td>
                      <div className="flex min-w-0 max-w-[230px] flex-col">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-semibold text-[var(--fg-primary)]">{c.email}</span>
                          {c.suppressed && <Badge tone="warning">Excluded</Badge>}
                        </span>
                        <span
                          className="truncate font-mono text-[11.5px] text-[var(--fg-muted)]"
                          title={c.phones?.length > 1 ? c.phones.join(", ") : undefined}
                        >
                          {c.phone || "—"}
                          {extra > 0 && <span className="font-sans"> +{extra} more</span>}
                        </span>
                      </div>
                    </Td>
                    <Td align="right" nowrap>
                      <span className="tabular-nums">{c.purchases || 0}</span>
                    </Td>
                    <Td muted>
                      <span className="block max-w-[160px] truncate" title={(c.villages || []).join(", ")}>
                        {c.villages?.length ? c.villages.join(", ") : "—"}
                      </span>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
        <Pagination page={page} totalPages={result.totalPages} total={result.total} onPageChange={setPage} />
      </div>
    </div>
  );
}

/* ───────────────────────── Count ───────────────────────── */

function AudienceCount({ countState, mode }) {
  const { data, loading, error, retry } = countState;
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <ObjectTile tone="pink" size="md"><Users size={18} /></ObjectTile>
        <div className="min-w-0 flex-1">
          <p className="text-label">Will receive this now</p>
          {error ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger-fg)]">
              Could not count: {error}
              <Button size="xs" variant="secondary" onClick={retry} iconLeft={<RefreshCw size={12} />}>Retry</Button>
            </div>
          ) : data ? (
            <p className="mt-1 text-[24px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg-primary)]">
              {Number(data.count || 0).toLocaleString()}
              <span className="ml-1.5 text-[13px] font-medium tracking-normal text-[var(--fg-muted)]">
                {Number(data.count) === 1 ? "customer" : "customers"}
              </span>
            </p>
          ) : (
            <div className="mt-1.5 h-6 w-28 skeleton" />
          )}
        </div>
        {loading && <Loader2 size={15} className="shrink-0 animate-spin text-[var(--fg-muted)]" aria-label="Counting" />}
      </div>

      {data?.suppressedExcluded > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)]">
          <MailX size={13} className="shrink-0" />
          {plural(data.suppressedExcluded, "excluded address", "excluded addresses")}{" "}
          {Number(data.suppressedExcluded) === 1 ? "is" : "are"} left out
        </p>
      )}

      {mode === "all" && data?.sample?.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <p className="text-label mb-1.5">For example</p>
          <ul className="flex flex-col gap-1">
            {data.sample.map((c) => (
              <li key={c.emailNorm} className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <span className="truncate text-[var(--fg-secondary)]">{c.email}</span>
                {c.villages?.length > 0 && (
                  <span className="shrink-0 truncate text-[11.5px] text-[var(--fg-muted)]">· {c.villages[0]}</span>
                )}
                {c.purchases > 0 && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-[var(--fg-muted)]">
                    <ShoppingBag size={11} /> {c.purchases}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Editor ───────────────────────── */

export default function AudienceEditor({ audience, onChange, sites, countState, contactsByEmail, onRememberContacts }) {
  const set = (patch) => onChange({ ...audience, ...patch });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="max-w-full overflow-x-auto scrollbar-none">
          <Segmented
            options={[
              { value: "all", label: "Everyone with an email" },
              { value: "selected", label: "Chosen customers" },
            ]}
            value={audience.mode}
            onChange={(mode) => set({ mode })}
            size="sm"
          />
        </div>
        <p className="text-[12px] text-[var(--fg-muted)]">
          {audience.mode === "all"
            ? "Every inbox in the M-PAiSA mapping, once each, minus excluded addresses. Narrow it below if you need to."
            : "Only the people you tick. Good for a follow-up to a handful of customers."}
        </p>
      </div>

      {audience.mode === "all" ? (
        <div className="flex flex-col gap-5">
          <Toggle
            checked={!!audience.purchasersOnly}
            onChange={(v) => set({ purchasersOnly: v })}
            label="Only customers who have bought"
            hint="At least one paid purchase through the portal."
          />
          <VillageChips sites={sites} groupIds={audience.groupIds || []} onChange={(groupIds) => set({ groupIds })} />
        </div>
      ) : (
        <ContactPicker
          selected={audience.selected || []}
          onChange={(selected) => set({ selected })}
          contactsByEmail={contactsByEmail}
          onRemember={onRememberContacts}
        />
      )}

      <AudienceCount countState={countState} mode={audience.mode} />
    </div>
  );
}
