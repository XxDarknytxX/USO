// src/pages/ManualAssistancePage.jsx
// Paid-but-auth-failed cases. Each shows the customer's phone, amount, plan and
// the voucher code that's RESERVED for them (they redeem it via the portal's
// manual voucher-login). "Mark sorted" resolves the case.
import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { LifeBuoy, RefreshCw, CheckCircle2, Phone, Ticket, Copy, Mail, Send } from "lucide-react";
import { portalConfigApi } from "../services/api";
import { PageHeader, Panel, Button, Badge, EmptyState, Modal, Field, Input } from "../components/ui";

const fmtMoney = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

export default function ManualAssistancePage() {
  const [cases, setCases] = useState([]);
  const [unresolved, setUnresolved] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open"); // open | resolved | all
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

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Support"
        title="Manual Assistance"
        subtitle="Customers who paid but auth failed — hand them their reserved voucher, then mark sorted."
        icon={<LifeBuoy size={20} />}
        actions={
          <Button variant="secondary" size="sm" onClick={load} iconLeft={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      <div className="mt-6 inline-flex items-center rounded-md p-0.5 bg-[var(--surface-raised)] border border-[var(--border-default)]">
        {[
          { v: "open", l: `Open${unresolved ? ` · ${unresolved}` : ""}` },
          { v: "resolved", l: "Resolved" },
          { v: "all", l: "All" },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setStatusFilter(v)}
            className={
              "h-7 px-3 text-[12px] font-medium rounded transition-colors " +
              (statusFilter === v
                ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")
            }
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <Panel padding={false}>
          {loading ? (
            <div className="p-10 text-center text-[var(--fg-muted)]">Loading…</div>
          ) : cases.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={CheckCircle2}
                title={statusFilter === "open" ? "No open cases" : "No cases"}
                description={statusFilter === "open" ? "Every paid customer got connected." : ""}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[var(--border-default)]">
                    <Th>Phone</Th>
                    <Th>Amount</Th>
                    <Th>Plan</Th>
                    <Th>Voucher to assign</Th>
                    <Th>Created</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {cases.map((c) => (
                    <tr key={c.transactionId} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-mono text-[var(--fg-primary)]">
                          <Phone size={12} className="text-[var(--fg-muted)]" />
                          {c.customerPhone || "—"}
                        </span>
                        <span className="block text-[11px] font-mono text-[var(--fg-muted)] mt-0.5">{c.transactionId}</span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[var(--fg-primary)] tabular-nums">{fmtMoney(c.amount)}</td>
                      <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.planName || "—"}</td>
                      <td className="px-4 py-3">
                        {c.voucherCode ? (
                          <button
                            onClick={() => copy(c.voucherCode)}
                            title="Copy code"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[12.5px] font-semibold bg-[var(--brand-soft)] text-[var(--brand-fg-on-soft)] hover:opacity-80 transition-opacity"
                          >
                            <Ticket size={12} />
                            {c.voucherCode}
                            <Copy size={11} className="opacity-60" />
                          </button>
                        ) : (
                          <span className="text-[var(--fg-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-secondary)] text-[12.5px]">{fmtDate(c.createdAt)}</td>
                      <td className="px-4 py-3">
                        {c.resolved ? <Badge tone="success">Sorted</Badge> : <Badge tone="warning">Open</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {c.voucherCode && (
                            <Button
                              variant="secondary"
                              size="sm"
                              iconLeft={<Mail size={13} />}
                              onClick={() => openEmail(c)}
                              title={
                                c.customerEmail
                                  ? `Email the code to ${c.customerEmail}`
                                  : "No email on file - you can type one"
                              }
                            >
                              Email code
                            </Button>
                          )}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

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
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-4 py-3 mb-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
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
              hint={
                emailCase.customerEmail
                  ? "From the M-PAiSA mapping for this number. Change it to send somewhere else."
                  : "No M-PAiSA mapping for this number, so type where it should go."
              }
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
            <Button variant="secondary" onClick={() => setEmailCase(null)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={sendEmail}
              loading={sending}
              disabled={!emailTo.trim()}
              iconLeft={!sending && <Mail size={14} />}
            >
              Send code
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-4 py-2.5 text-label">{children}</th>;
}
