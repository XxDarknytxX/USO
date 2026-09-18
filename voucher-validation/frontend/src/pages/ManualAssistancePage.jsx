// src/pages/ManualAssistancePage.jsx
//
// Paid-but-auth-failed cases. Each one is a customer who has been charged and
// has no internet: the voucher is already RESERVED for them, and the job here
// is to get that code into their hands — read it out, email it — and then mark
// the case sorted.
//
// Laid out as a queue rather than a report. The counts at the top are the ones
// that decide whether to act now (how many are open, how much money is sitting
// unfulfilled, how many cannot be emailed because we have no address), and the
// list below is the work itself.

import { useEffect, useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  LifeBuoy,
  RefreshCw,
  CheckCircle2,
  Phone,
  Ticket,
  Copy,
  Mail,
  Send,
  CreditCard,
} from "lucide-react";
import { portalConfigApi } from "../services/api";
import { usePhone } from "../components/ui/phone";
import {
  PageHeader,
  Panel,
  Button,
  EmptyState,
  Modal,
  Field,
  Input,
  PageShell,
  KpiGrid,
  StatCard,
  Toolbar,
  SearchInput,
  Segmented,
  StatusPill,
  DataTable,
  Th,
  Td,
  TableMessage,
  RecordCell,
  ObjectTile,
} from "../components/ui";

const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
/**
 * Phone card: the year and the seconds are noise on a queue worked the same day.
 *
 * Deliberately date-fns rather than toLocaleString: the Txn Flows card beside
 * this one prints the same shape, and a locale-formatted time gave 09:02 AM
 * next to its 15:16 — two clocks on two cards of the same queue. `format` also
 * fixes the field order, which the locale would otherwise flip (18 Sep / Sep 18).
 */
const fmtWhen = (d) => {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, HH:mm");
  } catch {
    return "—";
  }
};

const COLUMNS = 6;

export default function ManualAssistancePage() {
  // Below 640px a case is a card with its two actions along the foot, and the
  // KPI rail is one four-figure grid — different components, not smaller ones.
  const phone = usePhone();
  const [cases, setCases] = useState([]);
  const [unresolved, setUnresolved] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open"); // open | resolved | all
  const [query, setQuery] = useState("");
  const [resolving, setResolving] = useState(null);
  // Email-the-code dialog: the case being sent, plus the editable recipient
  // (prefilled from the M-PAiSA mapping when there is one).
  const [emailCase, setEmailCase] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await portalConfigApi.manualAssistance({ status: statusFilter });
      setCases(res.cases || []);
      setUnresolved(res.unresolvedCount || 0);
    } catch (e) {
      toast.error("Failed to load cases: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (txn) => {
    setResolving(txn);
    try {
      await portalConfigApi.resolveManualAssistance(txn);
      toast.success("Case marked as sorted");
      load();
    } catch (e) {
      toast.error("Failed: " + e.message);
    } finally {
      setResolving(null);
    }
  };

  const copy = (code) => {
    navigator.clipboard?.writeText(code);
    toast.success("Voucher code copied");
  };

  const openEmail = (c) => {
    setEmailCase(c);
    setEmailTo(c.customerEmail || "");
  };

  const sendEmail = async () => {
    if (!emailCase) return;
    setSending(true);
    try {
      // Send the address only when it differs from the mapped one, so the
      // backend resolves the mapping itself in the common case.
      const body = emailTo && emailTo !== emailCase.customerEmail ? { email: emailTo.trim() } : {};
      const res = await portalConfigApi.emailManualAssistance(emailCase.transactionId, body);
      toast.success(`Voucher code emailed to ${res.to}`);
      setEmailCase(null);
      load();
    } catch (e) {
      toast.error("Failed to send: " + e.message);
    } finally {
      setSending(false);
    }
  };

  // The status segment refetches; the search box only narrows what came back,
  // because a support agent is usually looking for one phone number in a list
  // they can already see.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cases;
    return cases.filter((c) =>
      [c.customerPhone, c.transactionId, c.voucherCode, c.planName, c.customerEmail]
        .some((v) => String(v || "").toLowerCase().includes(needle))
    );
  }, [cases, query]);

  const stats = useMemo(() => {
    const value = cases.reduce((n, c) => n + Number(c.amount || 0), 0);
    return {
      value,
      reserved: cases.filter((c) => c.voucherCode).length,
      noEmail: cases.filter((c) => !c.customerEmail).length,
    };
  }, [cases]);

  const viewLabel =
    statusFilter === "open" ? "open cases" : statusFilter === "resolved" ? "resolved cases" : "all cases";

  return (
    <PageShell>
      {/* On a phone the app bar names the screen and Refresh sits on the queue
          it reloads, so the hero would be a card of prose between the bar and
          the work. It stands down entirely. */}
      <PageHeader
        eyebrow="Support"
        title="Manual Assistance"
        subtitle={
          phone
            ? null
            : "Customers who paid but auth failed — hand them their reserved voucher, then mark sorted."
        }
        icon={<LifeBuoy size={22} />}
        tone="orange"
        actions={
          phone ? null : (
            <Button variant="secondary" size="sm" onClick={load} iconLeft={<RefreshCw size={14} />}>
              Refresh
            </Button>
          )
        }
      />

      {/* Four tiles two-up, each with a caption, filled most of a phone screen
          before the queue itself. The same four figures, no captions, in a
          quarter of the height — the captions were explaining labels that say
          it already. */}
      {phone ? (
        <PhoneSummary
          items={[
            { label: "Open cases", value: unresolved },
            { label: "Value in view", value: fmtMoney(stats.value) },
            { label: "Vouchers reserved", value: stats.reserved },
            { label: "No email on file", value: stats.noEmail },
          ]}
        />
      ) : (
      <KpiGrid>
        <StatCard
          label="Open cases"
          value={unresolved}
          sub={unresolved ? "waiting on someone" : "nothing outstanding"}
          icon={<LifeBuoy size={18} />}
          color="orange"
        />
        <StatCard
          label="Value in this view"
          value={fmtMoney(stats.value)}
          sub={`${cases.length} ${viewLabel}`}
          icon={<CreditCard size={18} />}
          color="accent"
        />
        <StatCard
          label="Vouchers reserved"
          value={stats.reserved}
          sub="ready to hand over"
          icon={<Ticket size={18} />}
          color="indigo"
        />
        <StatCard
          label="No email on file"
          value={stats.noEmail}
          sub="need an M-PAiSA mapping"
          icon={<Mail size={18} />}
          color="slate"
        />
      </KpiGrid>
      )}

      <Toolbar>
        <Segmented
          value={statusFilter}
          onChange={setStatusFilter}
          // A phone gives the segment a full row; share it out evenly rather
          // than leaving three pills huddled at the left.
          className="max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
          options={[
            { value: "open", label: "Open", count: unresolved || undefined },
            { value: "resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ]}
        />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phone, transaction, voucher…"
          width="w-72"
        />
        {/* The count moves into the queue's own subtitle on a phone, where a
            line of its own in the filter card is a row wasted. */}
        <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums max-sm:hidden!">
          {shown.length} of {cases.length} {viewLabel}
        </span>
      </Toolbar>

      <Panel
        title="Case queue"
        subtitle={
          // The phone line states the order the API actually returns —
          // unresolved first, newest first within each (portalConfigController,
          // ORDER BY resolved, created_at DESC) — and drops "all" from "5 of
          // 5 all cases".
          phone
            ? `${shown.length} of ${cases.length} ${statusFilter === "all" ? "cases" : viewLabel}, ${
                statusFilter === "all" ? "open first, then newest" : "newest first"
              }`
            : "Oldest first from the portal. Copy or email the reserved code, then mark sorted."
        }
        icon={<LifeBuoy size={15} />}
        tone="orange"
        padding={false}
        actions={
          phone ? (
            <Button variant="secondary" size="sm" onClick={load} iconLeft={<RefreshCw size={13} />}>
              Refresh
            </Button>
          ) : null
        }
      >
        {loading ? (
          <div className="p-5 space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg skeleton" style={{ opacity: 1 - i * 0.14 }} />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={statusFilter === "open" ? "No open cases" : "No cases"}
            description={statusFilter === "open" ? "Every paid customer got connected." : ""}
          />
        ) : phone ? (
          shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--fg-muted)]">
              No case matches “{query.trim()}”.
            </p>
          ) : (
            <ul>
              {shown.map((c) => (
                <PhoneCaseRow
                  key={c.transactionId}
                  c={c}
                  resolving={resolving === c.transactionId}
                  onCopy={() => copy(c.voucherCode)}
                  onEmail={() => openEmail(c)}
                  onResolve={() => resolve(c.transactionId)}
                />
              ))}
            </ul>
          )
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Customer</Th>
                {/* What they bought and what they paid is one thought, and
                    pairing them keeps both actions on screen without the row
                    scrolling sideways. */}
                <Th align="right">Plan &amp; amount</Th>
                <Th>Voucher to assign</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <TableMessage colSpan={COLUMNS}>No case matches “{query.trim()}”.</TableMessage>
              ) : (
                shown.map((c) => (
                  <tr key={c.transactionId}>
                    <Td>
                      <RecordCell
                        tone="orange"
                        icon={<Phone size={14} />}
                        title={c.customerPhone || "Unknown number"}
                        subtitle={c.transactionId}
                        mono
                      />
                    </Td>
                    <Td align="right" nowrap>
                      <span className="font-semibold text-[var(--fg-primary)] tabular-nums">
                        {fmtMoney(c.amount)}
                      </span>
                      <span className="block text-[11.5px] text-[var(--fg-muted)]">
                        {c.planName || "—"}
                      </span>
                    </Td>
                    <Td>
                      {c.voucherCode ? (
                        <button
                          onClick={() => copy(c.voucherCode)}
                          title="Copy code"
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[12.5px] font-semibold bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] hover:opacity-80 transition-opacity pointer-coarse:min-h-9 pointer-coarse:px-3"
                        >
                          <Ticket size={12} />
                          {c.voucherCode}
                          <Copy size={11} className="opacity-60" />
                        </button>
                      ) : (
                        <span className="text-[var(--fg-muted)]">—</span>
                      )}
                    </Td>
                    <Td muted nowrap>
                      {fmtDate(c.createdAt)}
                    </Td>
                    <Td>
                      {c.resolved ? (
                        <StatusPill tone="success">Sorted</StatusPill>
                      ) : (
                        <StatusPill tone="warning">Open</StatusPill>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Only offered when we actually have an address for
                            this number — there is nothing to email otherwise.
                            The reason is shown rather than the button simply
                            vanishing, so it is clear a mapping would fix it. */}
                        {c.voucherCode &&
                          (c.customerEmail ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              iconLeft={<Mail size={13} />}
                              onClick={() => openEmail(c)}
                              title={`Email the code to ${c.customerEmail}`}
                            >
                              Email code
                            </Button>
                          ) : (
                            <span
                              className="text-[11.5px] text-[var(--fg-muted)] whitespace-nowrap"
                              title="Add this number under M-PAiSA Mapping to email their code"
                            >
                              No email on file
                            </span>
                          ))}
                        {!c.resolved && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={resolving === c.transactionId}
                            iconLeft={resolving !== c.transactionId && <CheckCircle2 size={13} />}
                            onClick={() => resolve(c.transactionId)}
                          >
                            Mark sorted
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {emailCase && (
        <Modal open onClose={() => !sending && setEmailCase(null)} width="lg">
          <Modal.Header
            eyebrow="Manual assistance"
            title="Email the voucher code"
            subtitle="Sends the customer their reserved code and how to redeem it."
            icon={Mail}
            onClose={() => !sending && setEmailCase(null)}
          />
          <Modal.Body>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5 mb-6">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-[13px] [overflow-wrap:anywhere]">
                <dt className="text-[var(--fg-muted)]">Phone</dt>
                <dd className="font-mono text-[var(--fg-primary)]">{emailCase.customerPhone || "—"}</dd>
                <dt className="text-[var(--fg-muted)]">Plan</dt>
                <dd className="text-[var(--fg-secondary)]">
                  {emailCase.planName || "—"}
                  <span className="text-[var(--fg-muted)]"> · {fmtMoney(emailCase.amount)}</span>
                </dd>
                <dt className="text-[var(--fg-muted)]">Voucher</dt>
                <dd className="font-mono font-semibold text-[var(--fg-primary)]">{emailCase.voucherCode}</dd>
              </dl>
            </div>

            <Field
              label="Send to"
              htmlFor="ma-email"
              hint="From the M-PAiSA mapping for this number. Change it to send somewhere else."
            >
              <Input
                id="ma-email"
                type="email"
                value={emailTo}
                autoFocus
                placeholder="customer@example.com"
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </Field>

            <p className="mt-4 flex items-start gap-2 text-[12px] text-[var(--fg-muted)]">
              <Send size={13} className="mt-0.5 shrink-0" />
              A blind copy goes to the team inbox so the send can be checked afterwards.
            </p>
          </Modal.Body>
          <Modal.Footer>
            {/* A phone splits the footer between the two, so Send is a full
                thumb's width. */}
            <Button variant="secondary" onClick={() => setEmailCase(null)} disabled={sending} className="max-sm:flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={sendEmail}
              loading={sending}
              disabled={!emailTo.trim()}
              iconLeft={!sending && <Mail size={14} />}
              className="max-sm:flex-1"
            >
              Send code
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </PageShell>
  );
}

/* ───────────────────────── Phone ───────────────────────── */

/**
 * The page's four figures as one hairline grid. A phone gets the numbers
 * without the captions, above the queue rather than instead of it.
 */
function PhoneSummary({ items }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--border-subtle)] shadow-[var(--shadow-card)]">
      {items.map((it) => (
        <div key={it.label} className="bg-[var(--bg-elevated)] px-3.5 py-3">
          <p className="text-label truncate">{it.label}</p>
          <p className="mt-1.5 text-[20px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg-primary)]">
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * One case on a phone. Who to call and what they paid, the code to read out,
 * then the two things to do about it as a full-width pair at the foot — the
 * part of the card a thumb is nearest.
 */
function PhoneCaseRow({ c, resolving, onCopy, onEmail, onResolve }) {
  // Built before the row is, because the row is drawn only when it holds a
  // button. A sorted case with nothing left to email has none, and a row with
  // nothing in it — or with only the "No email on file" note, which explains a
  // missing button to nobody — left a band of card under "Created …" that read
  // as something failing to load. Email is only offered when we actually have
  // an address for this number; the reason is shown rather than the button
  // simply vanishing, so it is clear a mapping would fix it.
  const canEmail = Boolean(c.voucherCode && c.customerEmail);
  const noEmail = Boolean(c.voucherCode && !c.customerEmail);
  const emailAction = canEmail ? (
    <Button variant="secondary" size="sm" iconLeft={<Mail size={13} />} onClick={onEmail}>
      Email code
    </Button>
  ) : null;
  const resolveAction = !c.resolved ? (
    <Button
      variant="secondary"
      size="sm"
      loading={resolving}
      iconLeft={!resolving && <CheckCircle2 size={13} />}
      onClick={onResolve}
    >
      Mark sorted
    </Button>
  ) : null;

  return (
    <li className="border-b border-[var(--border-subtle)] last:border-b-0 px-4 py-3.5">
      <div className="flex items-start gap-2.5 min-w-0">
        <ObjectTile tone="orange" size="sm" className="mt-0.5">
          <Phone size={14} />
        </ObjectTile>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[14px] font-semibold text-[var(--fg-primary)] [overflow-wrap:anywhere]">
            {c.customerPhone || "Unknown number"}
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)] [overflow-wrap:anywhere]">
            <span className="font-mono">{c.transactionId}</span>
            {c.planName && <span> · {c.planName}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[15px] font-semibold tabular-nums text-[var(--fg-primary)]">{fmtMoney(c.amount)}</p>
          <p className="mt-1">
            {c.resolved ? (
              <StatusPill tone="success">Sorted</StatusPill>
            ) : (
              <StatusPill tone="warning">Open</StatusPill>
            )}
          </p>
        </div>
      </div>

      {/* The code is the point of the case: full width, and the whole pill
          copies it. */}
      {c.voucherCode && (
        <button
          onClick={onCopy}
          title="Copy code"
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-soft)] px-3 py-2 font-mono text-[14px] font-semibold text-[var(--brand-fg-on-soft)] active:opacity-80 transition-opacity"
        >
          <Ticket size={13} />
          {c.voucherCode}
          <Copy size={12} className="opacity-60" />
        </button>
      )}

      {/* With no button to stand beside, the note rides on the date line. */}
      <p className="mt-2 text-[11.5px] text-[var(--fg-muted)]">
        Created {fmtWhen(c.createdAt)}
        {noEmail && !resolveAction && (
          <span title="Add this number under M-PAiSA Mapping to email their code"> · No email on file</span>
        )}
      </p>

      {(emailAction || resolveAction) && (
        <div className="mt-2.5 flex items-center gap-2 [&>*]:flex-1 [&>*]:basis-0">
          {emailAction ||
            (noEmail && (
              <span
                className="text-[11.5px] text-[var(--fg-muted)]"
                title="Add this number under M-PAiSA Mapping to email their code"
              >
                No email on file
              </span>
            ))}
          {resolveAction}
        </div>
      )}
    </li>
  );
}
