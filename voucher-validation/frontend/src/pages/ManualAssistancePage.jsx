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
} from "../components/ui";

const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

const COLUMNS = 6;

export default function ManualAssistancePage() {
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
      <PageHeader
        eyebrow="Support"
        title="Manual Assistance"
        subtitle="Customers who paid but auth failed — hand them their reserved voucher, then mark sorted."
        icon={<LifeBuoy size={22} />}
        tone="orange"
        actions={
          <Button variant="secondary" size="sm" onClick={load} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

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
        <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums">
          {shown.length} of {cases.length} {viewLabel}
        </span>
      </Toolbar>

      <Panel
        title="Case queue"
        subtitle="Oldest first from the portal. Copy or email the reserved code, then mark sorted."
        icon={<LifeBuoy size={15} />}
        tone="orange"
        padding={false}
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
                  // On a phone each case is a card: the customer with what
                  // they paid opposite on the title line, then the code to
                  // hand over, and the two actions as a full-width pair at the
                  // foot — the part of the card a thumb is nearest.
                  <tr key={c.transactionId}>
                    <Td>
                      <span className="flex items-start gap-3 min-w-0 max-sm:w-full">
                        <span className="min-w-0 flex-1">
                          <RecordCell
                            tone="orange"
                            icon={<Phone size={14} />}
                            title={c.customerPhone || "Unknown number"}
                            subtitle={c.transactionId}
                            mono
                          />
                        </span>
                        {/* Capped, so a long plan name wraps under the amount
                            rather than squeezing the transaction id into a
                            column of fragments. */}
                        <span className="sm:hidden shrink-0 max-w-[42%] text-right">
                          <span className="block font-semibold text-[var(--fg-primary)] tabular-nums">
                            {fmtMoney(c.amount)}
                          </span>
                          <span className="block text-[11.5px] text-[var(--fg-muted)]">{c.planName || "—"}</span>
                        </span>
                      </span>
                    </Td>
                    <Td align="right" nowrap className="max-sm:hidden!">
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
                    <Td align="right" className="max-sm:before:hidden! max-sm:pt-1.5!">
                      <div className="flex items-center justify-end gap-2 max-sm:w-full! max-sm:[&>*]:flex-1 max-sm:[&>*]:basis-0">
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
                              className="text-[11.5px] text-[var(--fg-muted)] whitespace-nowrap max-sm:whitespace-normal max-sm:text-left"
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
