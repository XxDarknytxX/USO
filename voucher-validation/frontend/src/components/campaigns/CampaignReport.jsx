// src/components/campaigns/CampaignReport.jsx
//
// A campaign after Send: what has gone, what is waiting, what failed and why.
//
// The page is read by two different people. The one who pressed Send wants to
// know it is moving and roughly when it will be done; the one looking a day
// later wants to know whether a particular customer got it. So the top is a
// single progress figure with an estimate, and the bottom is every recipient
// with their outcome, searchable by address.
//
// The sender is paced (the server's sendPerMinute) and runs in the background,
// so while a campaign is sending this polls every five seconds. When the sender
// stops a campaign by itself — the SMTP login failed, say — it records why in
// lastError, and that is put at the very top: a paused campaign with no reason
// shown looks like one somebody paused and forgot.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft, RefreshCw, Pause, Play, XCircle, RotateCcw, Copy, Send, Megaphone, Inbox,
} from "lucide-react";
import { campaignApi } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import {
  PageShell, PageHeader, Panel, Button, IconButton, Segmented, SearchInput, DataTable, Th, Td,
  TableMessage, StatusPill, ConfirmDialog,
} from "../ui";
import Pagination from "../shared/Pagination";
import EmailPreview, { useEmailPreview } from "./EmailPreview";
import {
  CampaignStatusPill, RECIPIENT_STATUS, DeliveryBar, Callout, PHONE_WIDE, PHONE_HEADER_FILL,
  audienceSummary, fmtDateTime, durationWords, plural, useIsPhone,
} from "./campaignUi";
import { PHONE_CARD, PhoneMore, phoneRowClass } from "../ui/phone";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

const PAGE_SIZE = 50;
const POLL_MS = 5000;

const COUNT_TILES = [
  { key: "sent", label: "Sent", dot: "var(--success-fg)" },
  { key: "queued", label: "Queued", dot: "var(--info-fg)" },
  { key: "failed", label: "Failed", dot: "var(--danger-fg)" },
  { key: "skipped", label: "Skipped", dot: "var(--fg-subtle)" },
];

function Meta({ label, children, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-label">{label}</dt>
      <dd className="mt-1 truncate text-[12.5px] text-[var(--fg-secondary)] max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function CampaignReport({ campaign, stats, sites, onCampaign }) {
  const navigate = useNavigate();
  const { isSuperadmin } = useAuth();
  const isPhone = useIsPhone();
  const totals = campaign.totals || { recipients: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
  const perMinute = Number(campaign.sendPerMinute || stats?.sendPerMinute || 0);
  const isSending = campaign.status === "sending";

  /* ── deliveries ── */
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({ recipients: [], total: 0, totalPages: 1, counts: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Phone: a page of fifty addresses is capped until asked for. Desktop keeps
  // the whole page — its table scrolls inside the panel.
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadRecipients = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const data = await campaignApi.recipients(campaign.id, {
          status: filter, search: debounced, page, pageSize: PAGE_SIZE,
        });
        setRows({
          recipients: data.recipients || [],
          total: data.total || 0,
          totalPages: data.totalPages || 1,
          counts: data.counts || null,
        });
        // A live send shrinks the filtered list under the admin's feet: never
        // leave them on a page past the end with no pager to get back.
        if (page > (data.totalPages || 1)) setPage(data.totalPages || 1);
        setLoadError("");
      } catch (e) {
        // A failed background poll keeps the rows already on screen.
        if (!silent) setLoadError(e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [campaign.id, filter, debounced, page]
  );

  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  // A different filter, search or page is a different list, so the phone cap
  // starts again rather than carrying "showing all" over to fifty new rows.
  useEffect(() => { setShowAll(false); }, [filter, debounced, page]);

  /* ── polling while it sends ── */
  const refreshCampaign = useCallback(async () => {
    try {
      const { campaign: next } = await campaignApi.get(campaign.id);
      onCampaign(next);
    } catch { /* transient — the next tick tries again */ }
  }, [campaign.id, onCampaign]);

  useEffect(() => {
    if (!isSending) return;
    const t = setInterval(() => {
      refreshCampaign();
      loadRecipients({ silent: true });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [isSending, refreshCampaign, loadRecipients]);

  // One last refresh of the rows when the status changes (sending → sent, a
  // pause, a retry), so the table does not stop five seconds short of the
  // figures above it. Skips the first render: the load above already ran.
  const lastStatus = useRef(campaign.status);
  useEffect(() => {
    if (lastStatus.current === campaign.status) return;
    lastStatus.current = campaign.status;
    loadRecipients({ silent: true });
  }, [campaign.status, loadRecipients]);

  /* ── controls ── */
  const [busy, setBusy] = useState(null); // "pause" | "resume" | "cancel" | "retry" | "duplicate"
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function act(kind, call, success) {
    setBusy(kind);
    try {
      const res = await call();
      if (res?.campaign) onCampaign(res.campaign);
      toast.success(typeof success === "function" ? success(res) : success);
      loadRecipients({ silent: true });
      return res;
    } catch (e) {
      toast.error(e.message, { duration: 7000 });
      if (e.status === 409) refreshCampaign();
      return null;
    } finally {
      setBusy(null);
    }
  }

  const pause = () => act("pause", () => campaignApi.pause(campaign.id), "Paused — nothing more goes out until you resume");
  const resume = () => act("resume", () => campaignApi.resume(campaign.id), "Resumed");
  const retry = () =>
    act("retry", () => campaignApi.retryFailed(campaign.id), (r) =>
      `${plural(r?.requeued ?? totals.failed, "failed delivery", "failed deliveries")} queued again`
    );
  const cancel = async () => {
    const res = await act("cancel", () => campaignApi.cancel(campaign.id), "Campaign cancelled");
    if (res) setConfirmCancel(false);
  };
  async function duplicate() {
    setBusy("duplicate");
    try {
      const { campaign: copy } = await campaignApi.duplicate(campaign.id);
      toast.success("Copied as a new draft");
      navigate(`/email-campaigns/${copy.id}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  /* ── what was sent ── */
  const preview = useEmailPreview(campaign);

  /* ── words ── */
  const pct = totals.recipients > 0 ? Math.round((totals.sent / totals.recipients) * 100) : 0;
  let progressNote;
  if (isSending) {
    progressNote = perMinute > 0 && totals.queued > 0
      ? `${durationWords(totals.queued / perMinute)} left at ${perMinute} per minute`
      : "Finishing up";
  } else if (campaign.status === "paused") {
    progressNote = `Paused with ${plural(totals.queued, "email")} still queued`;
  } else if (campaign.status === "cancelled") {
    // The cancel itself marks everything unsent as skipped, so "done" would
    // always equal the total. Say what actually went out.
    progressNote = `Cancelled — ${totals.sent.toLocaleString()} sent, ${totals.skipped.toLocaleString()} not sent`;
  } else {
    progressNote = `Finished ${fmtDateTime(campaign.completedAt)}`;
  }

  const counts = rows.counts || { all: totals.recipients, ...totals };
  // On a phone the five filters only fit without their counts; the Sent /
  // Queued / Failed / Skipped tiles just above already show those numbers.
  const filterOptions = [
    { value: "all", label: "All", count: counts.all ?? totals.recipients },
    { value: "sent", label: "Sent", count: counts.sent ?? 0 },
    { value: "queued", label: "Queued", count: counts.queued ?? 0 },
    { value: "failed", label: "Failed", count: counts.failed ?? 0 },
    { value: "skipped", label: "Skipped", count: counts.skipped ?? 0 },
  ].map((o) => (isPhone ? { ...o, count: undefined } : o));

  const canCancel = campaign.status === "sending" || campaign.status === "paused";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Email campaign"
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-words">{campaign.name || "Untitled campaign"}</span>
            <CampaignStatusPill status={campaign.status} />
          </span>
        }
        subtitle={
          <>
            {/* The phone's app bar can only carry a plain string, and this
                page's heading is a name beside a status pill — so on a phone
                both are said here instead, above the subject line. */}
            <span className="sm:hidden mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-[var(--fg-primary)]">
                {campaign.name || "Untitled campaign"}
              </span>
              <CampaignStatusPill status={campaign.status} />
            </span>
            {campaign.subject}
          </>
        }
        icon={<Megaphone size={22} />}
        tone="pink"
        actions={
          <>
            {/* Up to six buttons sit here. On a phone the two that only move
                you around keep their icon and lose their word, so the ones that
                act on the campaign stay readable on one or two rows. */}
            <IconButton
              variant="ghost"
              size="md"
              className="sm:hidden"
              onClick={() => navigate("/email-campaigns")}
              aria-label="All campaigns"
              title="All campaigns"
            >
              <ArrowLeft size={17} />
            </IconButton>
            <Button variant="ghost" size="sm" onClick={() => navigate("/email-campaigns")} iconLeft={<ArrowLeft size={14} />} className="max-sm:hidden">
              All campaigns
            </Button>
            <IconButton
              variant="secondary"
              size="md"
              className="sm:hidden"
              onClick={() => { refreshCampaign(); loadRecipients(); }}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </IconButton>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { refreshCampaign(); loadRecipients(); }}
              iconLeft={<RefreshCw size={14} />}
              aria-label="Refresh"
              className="max-sm:hidden"
            >
              Refresh
            </Button>
            {campaign.status === "sending" && (
              <Button variant="secondary" size="sm" onClick={pause} loading={busy === "pause"} disabled={!!busy} iconLeft={<Pause size={14} />} className="max-sm:flex-auto">
                Pause
              </Button>
            )}
            {campaign.status === "paused" && (
              <Button variant="primary" size="sm" onClick={resume} loading={busy === "resume"} disabled={!!busy} iconLeft={<Play size={14} />} className="max-sm:flex-auto">
                Resume
              </Button>
            )}
            {totals.failed > 0 && ["sending", "paused", "sent"].includes(campaign.status) && (
              <Button variant="secondary" size="sm" onClick={retry} loading={busy === "retry"} disabled={!!busy} iconLeft={<RotateCcw size={14} />} className="max-sm:flex-auto">
                Retry {totals.failed.toLocaleString()} failed
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={duplicate} loading={busy === "duplicate"} disabled={!!busy} iconLeft={<Copy size={14} />} className="max-sm:flex-auto">
              <span className="max-sm:hidden">Duplicate as draft</span>
              <span className="sm:hidden">Duplicate</span>
            </Button>
            {canCancel && (
              <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)} disabled={!!busy} iconLeft={<XCircle size={14} />} className="max-sm:flex-auto">
                Cancel
              </Button>
            )}
          </>
        }
        className={PHONE_HEADER_FILL}
      />

      {campaign.lastError && (
        <Callout
          tone={campaign.status === "paused" ? "warning" : "danger"}
          title={campaign.status === "paused" ? "The sender paused this campaign" : "The sender reported a problem"}
          action={
            campaign.status === "paused" && isSuperadmin ? (
              <Button size="sm" variant="secondary" onClick={() => navigate("/settings?tab=email")}>
                Check Settings → Email
              </Button>
            ) : null
          }
        >
          <span className="font-mono text-[12px] break-words">{campaign.lastError}</span>
        </Callout>
      )}

      {/* Two columns: Delivery over Deliveries on the left, the email on the
          right (below both until xl). On a phone the left column dissolves
          (`contents`) so the email can sit between the figures and the list of
          addresses instead of after all of them: its panels and the preview
          become three grid items, put in order by the max-sm:order-* classes.
          Every class doing that is max-sm, so from 640px up the markup and the
          order are exactly the desktop's. */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <div className="flex min-w-0 flex-col gap-5 max-sm:contents">
          <Panel
            title="Delivery"
            subtitle={audienceSummary(campaign.audience, sites)}
            icon={<Send size={15} />}
            tone="pink"
            className="max-sm:order-1"
          >
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <p className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg-primary)] sm:text-[40px]">
                  {totals.sent.toLocaleString()}
                  <span className="text-[18px] font-medium text-[var(--fg-muted)]"> / {totals.recipients.toLocaleString()}</span>
                </p>
                <p className="mt-2 text-[12.5px] text-[var(--fg-muted)]">sent · {progressNote}</p>
              </div>
              <span className="text-[22px] font-semibold tabular-nums text-[var(--fg-secondary)]">{pct}%</span>
            </div>

            <DeliveryBar totals={totals} size="lg" className="mt-4" />

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {COUNT_TILES.map((t) => {
                const value = Number(totals[t.key] || 0);
                const active = filter === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setFilter(active ? "all" : t.key); setPage(1); }}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xl border px-3.5 py-2.5 text-left transition-colors focus-ring",
                      active
                        ? "border-[var(--brand-soft-hover)] bg-[var(--brand-soft)]"
                        : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-hover)]"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-label">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
                      {t.label}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-[20px] font-semibold leading-none tabular-nums",
                        t.key === "failed" && value > 0 ? "text-[var(--danger-fg)]" : "text-[var(--fg-primary)]"
                      )}
                    >
                      {value.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-3">
              {/* Started carries a timestamp AND who pressed Send, so on a phone
                  it takes the whole row and the other two pair up beneath it. */}
              <Meta label="Started" className="max-sm:col-span-2">
                {campaign.startedAt ? (
                  <span title={fmtDateTime(campaign.startedAt)}>
                    {fmtDateTime(campaign.startedAt)}
                    {campaign.startedByEmail ? ` by ${campaign.startedByEmail}` : ""}
                  </span>
                ) : "—"}
              </Meta>
              <Meta label={campaign.status === "cancelled" ? "Stopped" : "Finished"}>
                {campaign.completedAt ? fmtDateTime(campaign.completedAt) : isSending ? "Still sending" : "—"}
              </Meta>
              <Meta label="Pace">{perMinute > 0 ? `${perMinute} emails per minute` : "—"}</Meta>
            </dl>
          </Panel>

          <Panel
            title="Deliveries"
            subtitle="Every address this campaign was for, and what happened"
            icon={<Inbox size={15} />}
            tone="pink"
            padding={false}
            className="max-sm:order-3"
          >
            <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
              <div className="max-w-full overflow-x-auto scrollbar-none">
                <Segmented size="sm" options={filterOptions} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
              </div>
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email or number…"
                width="w-full sm:w-64"
                className="sm:ml-auto"
              />
            </div>
            <DataTable>
              <thead>
                <tr>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th align="right">Attempts</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {loadError ? (
                  <TableMessage colSpan={4}>
                    <span className="inline-flex flex-col items-center gap-2">
                      Could not load deliveries: {loadError}
                      <Button size="xs" variant="secondary" onClick={() => loadRecipients()} iconLeft={<RefreshCw size={12} />}>
                        Retry
                      </Button>
                    </span>
                  </TableMessage>
                ) : loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4}><div className="h-8 skeleton" /></td>
                    </tr>
                  ))
                ) : rows.recipients.length === 0 ? (
                  <TableMessage colSpan={4}>
                    {debounced ? "No recipient matches that search." : filter === "all" ? "No recipients recorded." : `Nothing ${filter}.`}
                  </TableMessage>
                ) : (
                  rows.recipients.map((r, i) => {
                    const meta = RECIPIENT_STATUS[r.status] || { label: r.status, tone: "neutral" };
                    // A phone card: who it was for and how it went on the first
                    // line, then what happened across the full width. Attempts
                    // is only worth a tile when the sender had to try twice.
                    const retried = Number(r.attempts || 0) > 1;
                    return (
                      <tr key={r.id} className={phoneRowClass(i, showAll)}>
                        <Td className={PHONE_CARD.title}>
                          <div className="flex items-start gap-3 max-sm:w-full">
                            <div className="flex min-w-0 max-w-[320px] flex-col max-sm:max-w-none max-sm:flex-1">
                              <span className="truncate font-semibold text-[var(--fg-primary)]">{r.email}</span>
                              {r.phone && <span className="truncate font-mono text-[11.5px] text-[var(--fg-muted)]">{r.phone}</span>}
                            </div>
                          </div>
                        </Td>
                        <Td nowrap className={PHONE_CARD.aside}><StatusPill tone={meta.tone}>{meta.label}</StatusPill></Td>
                        <Td align="right" nowrap className={retried ? PHONE_CARD.stat : PHONE_CARD.hide}>
                          <span className="tabular-nums">{r.attempts ?? 0}</span>
                        </Td>
                        <Td className={PHONE_WIDE}>
                          {r.error ? (
                            <span className="block min-w-[200px] max-w-[420px] break-words text-[12px] text-[var(--danger-fg)] max-sm:min-w-0">{r.error}</span>
                          ) : r.status === "sent" ? (
                            <span className="whitespace-nowrap text-[12.5px] text-[var(--fg-muted)]">{fmtDateTime(r.sentAt)}</span>
                          ) : r.status === "skipped" ? (
                            <span className="text-[12.5px] text-[var(--fg-muted)]">Not sent</span>
                          ) : (
                            <span className="text-[12.5px] text-[var(--fg-muted)]">Waiting its turn</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
            <PhoneMore
              total={rows.recipients.length}
              expanded={showAll}
              onToggle={() => setShowAll((v) => !v)}
              noun="deliveries"
            />
            <Pagination page={page} totalPages={rows.totalPages} total={rows.total} onPageChange={setPage} />
          </Panel>
        </div>

        <div className="min-w-0 xl:sticky xl:top-5 max-sm:order-2">
          <EmailPreview
            preview={preview}
            preheader={campaign.preheader}
            from={stats?.smtp?.from}
            title="What was sent"
            subtitle="The saved content, rendered for a sample customer"
            frameClassName="h-[440px] sm:h-[560px] xl:h-[calc(100vh-280px)] xl:min-h-[420px]"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this campaign?"
        message={
          totals.queued > 0
            ? `${plural(totals.queued, "email")} that ${totals.queued === 1 ? "hasn't" : "haven't"} gone yet will be skipped, and the campaign can't be resumed. Emails already delivered can't be recalled.`
            : "Nothing more will be sent, and the campaign can't be resumed. Emails already delivered can't be recalled."
        }
        confirmLabel="Cancel campaign"
        cancelLabel="Keep it"
        loading={busy === "cancel"}
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </PageShell>
  );
}
