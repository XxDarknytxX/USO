// src/components/campaigns/SendConfirmModal.jsx
//
// The last look before an email goes to a few hundred people, and the one
// screen in the feature that cannot be undone from.
//
// It states an EXACT number, and that number travels with the request: the
// server re-resolves the audience and refuses (409) if it no longer comes to
// what was confirmed — an address was excluded, a report upload added inboxes. The
// dialog then shows the new figure and asks again, rather than sending to a
// count nobody agreed to.
//
// A test send is recommended here, not required. Requiring it would teach
// people to fire a throwaway test at themselves to unlock the button, which is
// worse than an honest nudge.

import { useState } from "react";
import { Send, AlertTriangle, FlaskConical, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { campaignApi } from "../../services/api";
import { Modal, Button } from "../ui";
import { Callout, plural, durationWords, relTime } from "./campaignUi";

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-label pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-[var(--fg-primary)]">{children}</dd>
    </div>
  );
}

export default function SendConfirmModal({
  campaign, subject, audienceText, count, sendPerMinute, onClose, onSent, onStale, onCountChanged,
}) {
  const [confirmCount, setConfirmCount] = useState(count);
  const [changedFrom, setChangedFrom] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const perMinute = Number(sendPerMinute) > 0 ? Number(sendPerMinute) : null;
  const minutes = perMinute ? confirmCount / perMinute : null;

  async function send() {
    setSending(true);
    setError("");
    try {
      const { campaign: next } = await campaignApi.send(campaign.id, confirmCount);
      toast.success(`Sending to ${plural(confirmCount, "customer")}`);
      onSent(next);
    } catch (e) {
      const fresh = Number(e.data?.count);
      if (e.status === 409 && e.data && e.data.count != null && Number.isFinite(fresh)) {
        setChangedFrom(confirmCount);
        setConfirmCount(fresh);
        // The page behind the dialog still shows the old figure; refresh it too.
        onCountChanged?.();
      } else if (e.status === 409) {
        // Not a count change: the campaign itself moved on (sent from another
        // tab, say). Nothing to confirm any more — go and look at it.
        toast.error(e.message || "This campaign is no longer a draft.");
        onStale();
      } else if (e.status === 503) {
        setError(`${e.message || "Email sending is not available."} Check Settings → Email.`);
      } else {
        setError(e.message || "The campaign could not be started.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={sending ? undefined : onClose} width="md" closeOnBackdrop={!sending}>
      <Modal.Header
        eyebrow="Ready to send"
        title={changedFrom != null ? "The audience changed — confirm again" : "Send this campaign?"}
        subtitle="It starts straight away and runs in the background."
        icon={Send}
        onClose={sending ? undefined : onClose}
      />
      <Modal.Body>
        <div className="flex flex-col gap-4">
          {changedFrom != null && (
            <Callout tone="warning" title={`It now comes to ${plural(confirmCount, "customer")}, not ${changedFrom.toLocaleString()}`}>
              Contacts were added, removed or excluded since the count was taken. Check the number below
              before confirming.
            </Callout>
          )}

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-4">
            <p className="text-label">Recipients</p>
            <p className="mt-1.5 text-[34px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg-primary)] max-sm:text-[30px]">
              {confirmCount.toLocaleString()}
              <span className="ml-2 text-[14px] font-medium tracking-normal text-[var(--fg-muted)]">
                {confirmCount === 1 ? "customer gets this email" : "customers get this email"}
              </span>
            </p>
            <dl className="mt-3 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              <Row label="Subject">{subject || "—"}</Row>
              <Row label="Audience">{audienceText}</Row>
              <Row label="Pace">
                {perMinute ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={13} className="shrink-0 text-[var(--fg-muted)]" />
                    {durationWords(minutes)} at {perMinute.toLocaleString()} per minute
                  </span>
                ) : (
                  "Paced by the sender"
                )}
              </Row>
            </dl>
          </div>

          {campaign.lastTestAt ? (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--fg-muted)]">
              <FlaskConical size={14} className="shrink-0" />
              Last test sent {relTime(campaign.lastTestAt)}
              {campaign.lastTestTo ? ` to ${campaign.lastTestTo}` : ""}.
            </p>
          ) : (
            <Callout tone="info" title="You haven't sent yourself a test" icon={<FlaskConical size={16} />}>
              It is optional, but a test is the only way to see how this lands in a real inbox before{" "}
              {confirmCount === 1 ? "your customer does" : `${confirmCount.toLocaleString()} customers do`}.
            </Callout>
          )}

          <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
            You can pause or cancel while it runs. Emails already delivered cannot be recalled.
          </p>

          {error && (
            <Callout tone="danger" title="Not sent" icon={<AlertTriangle size={16} />}>
              {error}
            </Callout>
          )}
        </div>
      </Modal.Body>
      {/* On a phone the send button takes the rest of the row, so a long
          "Send to 1,234 customers" is never cut short. */}
      <Modal.Footer className="max-sm:flex-nowrap">
        <Button variant="ghost" onClick={onClose} disabled={sending} className="shrink-0">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={send}
          loading={sending}
          disabled={confirmCount <= 0}
          iconLeft={!sending && <Send size={14} />}
          className="max-sm:min-w-0 max-sm:flex-1"
        >
          {confirmCount <= 0
            ? "Nobody to send to"
            : changedFrom != null
              ? `Confirm ${plural(confirmCount, "customer")}`
              : `Send to ${plural(confirmCount, "customer")}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
