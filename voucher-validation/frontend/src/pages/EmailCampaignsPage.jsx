// src/pages/EmailCampaignsPage.jsx
//
// Email campaigns: one message, written once, sent to the customers in the
// M-PAiSA mapping — everyone with an email, a narrowed slice of them, or a few
// people picked by hand. Admin only.
//
// This page is the list. It opens on the three numbers that bound what any
// campaign can do — how many inboxes we have, how many of them have bought, how
// many have asked us to stop — and on whether mail can go out at all. That last
// card is not decoration: a campaign written while SMTP is switched off is a
// campaign whose Send button will not work, and the time to find that out is
// before writing it.
//
// Drafts, running and finished campaigns share one table, because they are the
// same object at different stages and people look for them by name, not by
// state. The excluded addresses live beside it as a second tab: they are the
// other half of "who will this reach".
//
// Sends are paced in the background, so while anything is sending the list
// refreshes itself every five seconds and the progress bars move on their own.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Megaphone, Plus, RefreshCw, Users, ShoppingBag, MailX, Mail, Copy, Trash2, ArrowRight,
  ServerCog, PenLine, BarChart3, Settings as SettingsIcon,
} from "lucide-react";

import { campaignApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import { useAuth } from "../hooks/useAuth";
import {
  PageShell, PageHeader, KpiGrid, StatCard, GlassCard, ObjectTile, Tabs, Toolbar, Segmented,
  SearchInput, Panel, DataTable, Th, Td, TableMessage, Button, IconButton, EmptyState,
  ConfirmDialog, StatusPill, SkeletonKpis,
} from "../components/ui";
import SuppressionsPanel from "../components/campaigns/SuppressionsPanel";
import {
  CampaignStatusPill, DeliveryBar, Callout, audienceSummary, relTime, fmtDateTime, plural, smtpProblem,
} from "../components/campaigns/campaignUi";

const POLL_MS = 5000;

// The server's buckets. "Sending" covers paused campaigns too and "Sent" covers
// cancelled ones — both are the same stage of life, and the status pill in the
// row says which.
const STATUS_FILTERS = [
  { value: "all", label: "All", title: "All campaigns" },
  { value: "draft", label: "Drafts", title: "Drafts" },
  { value: "active", label: "Sending", title: "Sending or paused" },
  { value: "done", label: "Sent", title: "Sent or cancelled" },
];

/**
 * Where mail goes out from, or why it cannot. Built on GlassCard rather than
 * StatCard because its "value" is a state and an address, not a number.
 */
function SmtpCard({ stats, onOpenSettings }) {
  const smtp = stats?.smtp;
  const problem = smtpProblem(smtp);
  return (
    <GlassCard
      size="md"
      className={problem ? "border-[var(--warning-border)]" : undefined}
      onClick={problem && onOpenSettings ? onOpenSettings : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label truncate">Email sending</p>
          <div className="mt-2">
            {!smtp ? (
              <StatusPill tone="neutral">Unknown</StatusPill>
            ) : problem ? (
              <StatusPill tone="warning">{smtp.configured ? "Turned off" : "Not set up"}</StatusPill>
            ) : (
              <StatusPill tone="success">Ready</StatusPill>
            )}
          </div>
        </div>
        {/* Hidden on a phone, as StatCard's tile is: two cards share the width. */}
        <ObjectTile tone={problem ? "orange" : "green"} className="max-sm:hidden"><ServerCog size={18} /></ObjectTile>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        {problem ? (
          onOpenSettings ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--warning-fg)]">
              Fix in Settings → Email <ArrowRight size={12} />
            </span>
          ) : (
            <span className="text-[12px] font-semibold text-[var(--warning-fg)]">Ask the superadmin to fix this</span>
          )
        ) : smtp ? (
          <span
            className="text-[12px] text-[var(--fg-muted)] max-sm:line-clamp-3 max-sm:[overflow-wrap:anywhere] sm:truncate"
            title={smtp.from || undefined}
          >
            From <span className="font-medium text-[var(--fg-secondary)]">{smtp.from || "the default sender"}</span>
            {stats?.sendPerMinute ? ` · ${stats.sendPerMinute}/min` : ""}
          </span>
        ) : (
          <span className="text-[12px] text-[var(--fg-muted)]">Could not read the mail settings</span>
        )}
      </div>
    </GlassCard>
  );
}

function ProgressCell({ c }) {
  if (c.status === "draft") return <span className="text-[12.5px] text-[var(--fg-muted)]">Not sent yet</span>;
  const t = c.totals || {};
  return (
    <div className="flex w-[170px] flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px] tabular-nums">
        <span className="font-semibold text-[var(--fg-primary)]">
          {Number(t.sent || 0).toLocaleString()}
          <span className="font-normal text-[var(--fg-muted)]"> / {Number(t.recipients || 0).toLocaleString()}</span>
        </span>
        {t.failed > 0 && (
          <span className="text-[11.5px] font-semibold text-[var(--danger-fg)]">{Number(t.failed).toLocaleString()} failed</span>
        )}
      </div>
      <DeliveryBar totals={t} />
    </div>
  );
}

/** The moment that best describes where a campaign is in its life. */
function whenCell(c) {
  if (c.status === "draft") return { label: "Edited", at: c.updatedAt };
  if (c.status === "sending" || c.status === "paused") return { label: "Started", at: c.startedAt || c.updatedAt };
  if (c.status === "cancelled") return { label: "Cancelled", at: c.completedAt || c.updatedAt };
  return { label: "Finished", at: c.completedAt || c.updatedAt };
}

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const { sites } = useSite();

  const [tab, setTab] = useState("campaigns"); // campaigns | excluded
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [counts, setCounts] = useState({ all: 0, draft: 0, active: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await campaignApi.stats());
    } catch (e) {
      toast.error(`Could not load campaign stats: ${e.message}`);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadCampaigns = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const res = await campaignApi.list({ status: filter, search: debounced });
        setCampaigns(res.campaigns || []);
        setCounts(res.counts || { all: 0, draft: 0, active: 0, done: 0 });
        setLoadError("");
      } catch (e) {
        // A failed background refresh leaves the table as it was.
        if (!silent) setLoadError(e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter, debounced]
  );

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  // Poll only while something is actually moving. `counts.active` includes
  // paused campaigns, which do not move, so the rows are checked instead.
  const anySending = campaigns.some((c) => c.status === "sending");
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(() => loadCampaigns({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [anySending, loadCampaigns]);

  const refresh = () => {
    loadStats();
    loadCampaigns();
  };

  async function createCampaign() {
    setCreating(true);
    try {
      const { campaign } = await campaignApi.create({});
      navigate(`/email-campaigns/${campaign.id}`);
    } catch (e) {
      toast.error(`Could not start a campaign: ${e.message}`);
      setCreating(false);
    }
  }

  async function duplicate(c) {
    setBusyId(c.id);
    try {
      const { campaign } = await campaignApi.duplicate(c.id);
      toast.success("Copied as a new draft");
      navigate(`/email-campaigns/${campaign.id}`);
    } catch (e) {
      toast.error(e.message);
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await campaignApi.remove(deleting.id);
      toast.success("Draft deleted");
      setDeleting(null);
      loadCampaigns({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const problem = smtpProblem(stats?.smtp);
  // The mail server belongs to the superadmin; an admin is told who to ask
  // rather than sent to a tab they cannot open.
  const { isSuperadmin } = useAuth();
  const openSettings = isSuperadmin ? () => navigate("/settings?tab=email") : undefined;
  const nothingYet = !loading && !loadError && counts.all === 0 && !debounced;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Email Campaigns"
        subtitle="Write an email once and send it to the customers in the M-PAiSA mapping — everyone, a village, or a chosen few."
        icon={<Megaphone size={22} />}
        tone="pink"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={refresh} iconLeft={<RefreshCw size={14} />} disabled={loading}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={createCampaign} loading={creating} iconLeft={<Plus size={14} />}>
              New campaign
            </Button>
          </>
        }
      />

      {statsLoading ? (
        <SkeletonKpis count={4} />
      ) : (
        <KpiGrid cols={4}>
          <StatCard
            label={
              <>
                <span className="sm:hidden">Contacts</span>
                <span className="max-sm:hidden">Contacts with an email</span>
              </>
            }
            value={stats ? Number(stats.contacts || 0).toLocaleString() : "—"}
            sub={
              <>
                <span className="sm:hidden">With an email, one per inbox</span>
                <span className="max-sm:hidden">One per inbox, from M-PAiSA Mapping</span>
              </>
            }
            icon={<Users size={18} />}
            color="pink"
          />
          <StatCard
            label="Purchasers"
            value={stats ? Number(stats.purchasers || 0).toLocaleString() : "—"}
            sub="Have bought at least once"
            icon={<ShoppingBag size={18} />}
            color="green"
          />
          <StatCard
            label="Excluded"
            value={stats ? Number(stats.suppressed || 0).toLocaleString() : "—"}
            sub="Never emailed — view the list"
            icon={<MailX size={18} />}
            color="orange"
            onClick={() => setTab("excluded")}
          />
          <SmtpCard stats={stats} onOpenSettings={openSettings} />
        </KpiGrid>
      )}

      {problem && (
        <Callout
          tone="warning"
          title={problem.title}
          action={
            openSettings ? (
              <Button size="sm" variant="secondary" onClick={openSettings} iconLeft={<SettingsIcon size={14} />}>
                Open Settings → Email
              </Button>
            ) : null
          }
        >
          {problem.detail} {openSettings ? "" : "Email settings are managed by the superadmin. "}You can still write and save drafts.
        </Callout>
      )}

      <Tabs
        tabs={[
          { value: "campaigns", label: "Campaigns", icon: <Mail size={14} />, count: counts.all },
          { value: "excluded", label: "Excluded", icon: <MailX size={14} />, count: stats?.suppressed ?? undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "excluded" ? (
        <SuppressionsPanel onChanged={loadStats} />
      ) : (
        <>
          <Toolbar>
            <div className="max-w-full overflow-x-auto scrollbar-none">
              <Segmented
                options={STATUS_FILTERS.map(({ value, label }) => ({ value, label, count: counts[value] ?? 0 }))}
                value={filter}
                onChange={setFilter}
                size="sm"
                className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
              />
            </div>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or subject…"
              width="w-full sm:w-72"
            />
            <span className="ml-auto hidden text-[12px] tabular-nums text-[var(--fg-muted)] sm:inline">
              {loading ? "Loading…" : plural(campaigns.length, "campaign")}
            </span>
          </Toolbar>

          <Panel
            padding={false}
            title={STATUS_FILTERS.find((f) => f.value === filter)?.title || "Campaigns"}
            subtitle="Newest activity first"
            icon={<Megaphone size={15} />}
            tone="pink"
          >
            {nothingYet ? (
              <EmptyState
                icon={Megaphone}
                title="No campaigns yet"
                description="Draft an email — branded or your own HTML — pick who gets it, send yourself a test, then send. Sends are paced and tracked per customer."
                action={
                  <Button variant="primary" size="sm" onClick={createCampaign} loading={creating} iconLeft={<PenLine size={14} />}>
                    Write the first one
                  </Button>
                }
              />
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th>Status</Th>
                    <Th>Audience</Th>
                    <Th>Progress</Th>
                    <Th>When</Th>
                    {/* Named by aria-label, not text: DataTable copies header TEXT onto
                        each cell as its phone label, and a row of buttons needs none. */}
                    <th className="text-right" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {loadError ? (
                    <TableMessage colSpan={6}>
                      <span className="inline-flex flex-col items-center gap-2">
                        Could not load campaigns: {loadError}
                        <Button size="xs" variant="secondary" onClick={() => loadCampaigns()} iconLeft={<RefreshCw size={12} />}>
                          Retry
                        </Button>
                      </span>
                    </TableMessage>
                  ) : loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td colSpan={6}><div className="h-10 skeleton" /></td></tr>
                    ))
                  ) : campaigns.length === 0 ? (
                    <TableMessage colSpan={6}>
                      {debounced ? "No campaign matches that search." : "No campaigns in this view."}
                    </TableMessage>
                  ) : (
                    campaigns.map((c) => {
                      const when = whenCell(c);
                      const open = () => navigate(`/email-campaigns/${c.id}`);
                      return (
                        <tr key={c.id} onClick={open} className="cursor-pointer">
                          <Td>
                            <div className="flex items-start gap-3 max-sm:w-full">
                              <div className="flex min-w-[200px] max-w-[340px] flex-col max-sm:min-w-0 max-sm:max-w-none max-sm:flex-1">
                                <span className="truncate font-semibold text-[var(--fg-primary)]">{c.name || "Untitled campaign"}</span>
                                <span className="truncate text-[12px] text-[var(--fg-muted)]">
                                  {c.subject || <span className="italic">No subject yet</span>}
                                </span>
                              </div>
                              <CampaignStatusPill status={c.status} className="shrink-0 sm:hidden" />
                            </div>
                          </Td>
                          <Td nowrap className="max-sm:hidden!"><CampaignStatusPill status={c.status} /></Td>
                          <Td>
                            <span className="block max-w-[220px] truncate text-[12.5px]" title={audienceSummary(c.audience, sites)}>
                              {audienceSummary(c.audience, sites)}
                            </span>
                          </Td>
                          <Td><ProgressCell c={c} /></Td>
                          <Td nowrap muted>
                            <span className="text-[12.5px]" title={fmtDateTime(when.at)}>
                              {when.label} {relTime(when.at)}
                            </span>
                          </Td>
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center justify-end gap-1 max-sm:mt-1 max-sm:flex max-sm:w-full max-sm:gap-2">
                              <Button
                                size="xs"
                                variant="secondary"
                                className="max-sm:flex-1"
                                onClick={open}
                                iconLeft={c.status === "draft" ? <PenLine size={12} /> : <BarChart3 size={12} />}
                              >
                                {c.status === "draft" ? "Edit" : "Report"}
                              </Button>
                              <IconButton
                                size="sm"
                                onClick={() => duplicate(c)}
                                disabled={busyId === c.id}
                                title="Duplicate as a new draft"
                                aria-label={`Duplicate ${c.name || "campaign"}`}
                              >
                                <Copy size={14} />
                              </IconButton>
                              {c.status === "draft" && (
                                <IconButton
                                  size="sm"
                                  onClick={() => setDeleting(c)}
                                  title="Delete draft"
                                  aria-label={`Delete draft ${c.name || ""}`.trim()}
                                  className="hover:text-[var(--danger-fg)]"
                                >
                                  <Trash2 size={14} />
                                </IconButton>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </DataTable>
            )}
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this draft?"
        message={`“${deleting?.name || "Untitled campaign"}” and its content will be removed. This can't be undone.`}
        confirmLabel="Delete draft"
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </PageShell>
  );
}
