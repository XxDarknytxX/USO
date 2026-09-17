// src/pages/EmailCampaignEditor.jsx
//
// One campaign, at /email-campaigns/:id. What the page IS depends on where the
// campaign is in its life: a draft opens in the editor; anything that has been
// sent (or is sending, paused, cancelled) opens as its report. There is no way
// to edit a campaign that has started — the server refuses it, and a report
// that could change under the people who already received it would be lying.
//
// THE EDITOR is a form on the left and the email on the right. The preview is
// rendered by the server from what is on screen, not from what was last saved,
// so the picture always matches the words being typed; saving is a separate,
// explicit act (button or ⌘S), and the page says plainly whether there is
// anything unsaved. Leaving with unsaved changes asks first — both for the
// browser (reload, close) and for links inside the console.
//
// The HTML body is a plain monospace textarea rather than a code editor: no new
// dependency, native undo, and the admins writing these are pasting or lightly
// editing email markup, not authoring it from nothing. The snippets insert
// table-and-inline-style markup because that is what survives Outlook and
// Gmail; a <div> with a stylesheet does not.
//
// Sending is the one irreversible step, so the page works toward it in order —
// details, content, audience, a test, then Send — and the Send button refuses,
// with its reason, while anything required is missing. The exact recipient count
// is taken from the server and sent back with the request; if the audience has
// moved in the meantime the confirmation shows the new number and asks again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft, Megaphone, Save, Send, Check, Loader2, Type, Code2, Users, FlaskConical, Pilcrow,
  MousePointerClick, Image as ImageIcon, Minus, FileCode2, Braces, CircleCheck, CircleDashed,
  CircleX, RefreshCw, Settings as SettingsIcon,
} from "lucide-react";

import { campaignApi } from "../services/api";
import { useSite } from "../hooks/useSite";
import {
  PageShell, PageHeader, Panel, Field, Input, Textarea, Segmented, TagInput, Button, Disclosure,
  Modal, EmptyState, Skeleton, SkeletonCard, Kbd,
} from "../components/ui";
import EmailPreview, { useEmailPreview } from "../components/campaigns/EmailPreview";
import AudienceEditor, { useAudienceCount } from "../components/campaigns/AudienceEditor";
import SendConfirmModal from "../components/campaigns/SendConfirmModal";
import CampaignReport from "../components/campaigns/CampaignReport";
import {
  Callout, MERGE_TAGS, audienceSummary, relTime, plural, smtpProblem,
} from "../components/campaigns/campaignUi";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEST_ADDRESSES = 5;

/* ───────────────────────── Starter markup ─────────────────────────
   Email-safe on purpose: tables for layout, every style inline, Arial, and the
   button's colour on the <td> (bgcolor) so Outlook — which ignores padding and
   background on links — still draws a red button. */

const FONT = "font-family:Arial,Helvetica,sans-serif;";

const SNIPPETS = [
  {
    key: "paragraph",
    label: "Paragraph",
    Icon: Pilcrow,
    html: `<p style="margin:0 0 16px;${FONT}font-size:15px;line-height:24px;color:#333333;">Write your message here.</p>`,
  },
  {
    key: "button",
    label: "Button",
    Icon: MousePointerClick,
    html: [
      `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;">`,
      `  <tr>`,
      `    <td align="center" bgcolor="#e60000" style="border-radius:6px;padding:12px 28px;">`,
      `      <a href="https://" target="_blank" style="${FONT}font-size:15px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;display:inline-block;">Buy a Wi-Fi plan</a>`,
      `    </td>`,
      `  </tr>`,
      `</table>`,
    ].join("\n"),
  },
  {
    key: "image",
    label: "Image",
    Icon: ImageIcon,
    html: `<img src="https://" alt="Describe the image" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;margin:0 0 16px;border-radius:8px;">`,
  },
  {
    key: "divider",
    label: "Divider",
    Icon: Minus,
    html: [
      `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;">`,
      `  <tr><td style="border-top:1px solid #e5e5e5;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>`,
      `</table>`,
    ].join("\n"),
  },
];

const RAW_STARTER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vodafone Fiji</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#f4f4f4;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:32px;${FONT}font-size:15px;line-height:24px;color:#333333;">
              <h1 style="margin:0 0 16px;font-size:24px;line-height:30px;color:#e60000;">Your headline</h1>
              <p style="margin:0 0 16px;">Write your message here.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;${FONT}font-size:12px;line-height:18px;color:#888888;">
              Vodafone Fiji &middot; USO Wi-Fi
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const FIELD_LABELS = {
  subject: "Subject",
  preheader: "Preheader",
  heading: "Heading",
  subheading: "Subheading",
  bodyHtml: "HTML body",
  bodyText: "Plain-text version",
};

/* ───────────────────────── Form state ───────────────────────── */

function formFrom(c) {
  const a = c?.audience || {};
  return {
    name: c?.name || "",
    subject: c?.subject || "",
    preheader: c?.preheader || "",
    heading: c?.heading || "",
    subheading: c?.subheading || "",
    layout: c?.layout === "raw" ? "raw" : "branded",
    bodyHtml: c?.bodyHtml || "",
    bodyText: c?.bodyText || "",
    audience: {
      mode: a.mode === "selected" ? "selected" : "all",
      purchasersOnly: !!a.purchasersOnly,
      groupIds: (a.groupIds || []).map(String),
      selected: a.selected || [],
    },
  };
}

// Order-insensitive where order carries no meaning, so ticking a village off
// and on again does not count as a change. One-line fields compare as the
// server stores them (trimmed, no line breaks), so a trailing space still being
// typed is not "unsaved" — and saving never has to rewrite what is in the box.
const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
function fingerprint(f) {
  return JSON.stringify({
    ...f,
    name: oneLine(f.name),
    subject: oneLine(f.subject),
    preheader: oneLine(f.preheader),
    heading: oneLine(f.heading),
    subheading: oneLine(f.subheading),
    audience: {
      ...f.audience,
      groupIds: [...f.audience.groupIds].sort(),
      selected: [...f.audience.selected].sort(),
    },
  });
}

/** Re-render every `ms` so relative times ("2 min ago") stay true. */
function useTick(ms) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/* ───────────────────────── Small parts ───────────────────────── */

function SaveState({ dirty, saving, savedAt }) {
  useTick(30000);
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--fg-muted)]" aria-live="polite">
        <Loader2 size={13} className="animate-spin" /> Saving…
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--warning-fg)]" aria-live="polite">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning-fg)]" /> Unsaved changes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--fg-muted)]" aria-live="polite">
      <Check size={13} className="text-[var(--success-fg)]" /> Saved · {relTime(savedAt)}
    </span>
  );
}

/**
 * Merge-tag chips. They insert into whichever text field was focused last, and
 * say which one, so nobody has to guess where {{village}} is about to land.
 * mousedown is cancelled so clicking a chip does not steal the caret first.
 */
function MergeTagBar({ target, onInsert, className }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--fg-muted)]">
        <Braces size={12} /> Personalise
      </span>
      {MERGE_TAGS.map((m) => (
        <button
          key={m.tag}
          type="button"
          title={`${m.hint} — inserts into ${FIELD_LABELS[target] || "the body"}`}
          aria-label={`Insert ${m.tag} into ${FIELD_LABELS[target] || "the body"}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(m.tag)}
          className="inline-flex h-6 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 font-mono text-[11px] text-[var(--fg-secondary)] transition-colors hover:border-[var(--brand-soft-hover)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg-on-soft)] focus-ring pointer-coarse:h-9 pointer-coarse:px-2.5 pointer-coarse:text-[12px]"
        >
          {m.tag}
        </button>
      ))}
      <span className="text-[11px] text-[var(--fg-subtle)]">→ {FIELD_LABELS[target] || "HTML body"}</span>
    </div>
  );
}

function CheckItem({ state, label, detail }) {
  const icon =
    state === "ok" ? <CircleCheck size={16} className="text-[var(--success-fg)]" />
    : state === "bad" ? <CircleX size={16} className="text-[var(--danger-fg)]" />
    : state === "wait" ? <Loader2 size={16} className="animate-spin text-[var(--fg-muted)]" />
    : <CircleDashed size={16} className="text-[var(--fg-subtle)]" />;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0 text-[12.5px] leading-snug">
        <span className="font-semibold text-[var(--fg-primary)]">{label}</span>
        {detail && <span className="block text-[var(--fg-muted)] break-words">{detail}</span>}
      </span>
    </li>
  );
}

/* ───────────────────────── Draft editor ───────────────────────── */

function DraftEditor({ campaign, stats, sites, onCampaign, onRefresh, onReload }) {
  const navigate = useNavigate();

  const [form, setForm] = useState(() => formFrom(campaign));
  const [savedPrint, setSavedPrint] = useState(() => fingerprint(formFrom(campaign)));
  const [savedAt, setSavedAt] = useState(campaign.updatedAt);
  const [saving, setSaving] = useState(false);
  const dirty = fingerprint(form) !== savedPrint;

  // Contacts seen so far, by emailNorm, so a chosen customer's chip can show
  // their real address after the picker has paged past them.
  const [contactsByEmail, setContactsByEmail] = useState(() =>
    Object.fromEntries((campaign.audience?.selectedContacts || []).map((c) => [c.emailNorm, c]))
  );
  const rememberContacts = useCallback((list) => {
    if (!list?.length) return;
    setContactsByEmail((prev) => {
      const next = { ...prev };
      for (const c of list) next[c.emailNorm] = c;
      return next;
    });
  }, []);

  const setField = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);

  /* ── save ── */
  const formRef = useRef(form);
  formRef.current = form;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const inflight = useRef(null);

  const save = useCallback(
    ({ quiet = false } = {}) => {
      if (inflight.current) return inflight.current;
      const snapshot = formRef.current;
      const run = (async () => {
        setSaving(true);
        try {
          const { campaign: next } = await campaignApi.update(campaign.id, snapshot);
          // What was sent is what is saved. The form is NOT replaced with the
          // server's copy: that would rewrite a field mid-edit (the server trims,
          // so "Double data in |" would lose the space being typed).
          setSavedPrint(fingerprint(snapshot));
          setSavedAt(next.updatedAt || new Date().toISOString());
          onCampaign(next);
          if (!quiet) toast.success("Draft saved", { id: "campaign-save" });
          return next;
        } catch (e) {
          if (e.status === 409) {
            toast.error("This campaign is no longer a draft, so it can't be edited. Showing its report.", { duration: 7000 });
            onReload();
          } else {
            toast.error(`Could not save: ${e.message}`, { id: "campaign-save", duration: 7000 });
          }
          throw e;
        } finally {
          setSaving(false);
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    [campaign.id, onCampaign, onReload]
  );

  // ⌘S / Ctrl+S saves instead of offering to download the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyRef.current) save().catch(() => {});
        else toast("Everything is already saved", { id: "campaign-save", icon: "✓" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Reload / close tab.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Links inside the console (the sidebar, a breadcrumb). The app uses
  // <BrowserRouter>, which has no navigation blocker, so same-origin link
  // clicks are caught in the capture phase — before React Router's own handler
  // — and held until the admin decides.
  const [leaveTo, setLeaveTo] = useState(null);
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const requestLeave = (to) => (dirty ? setLeaveTo(to) : navigate(to));

  // Every other way out — browser Back/Forward, the profile and sign-out
  // buttons, the village switcher — cannot be intercepted without a data
  // router. So instead of losing the edits, leaving with unsaved changes saves
  // them to the draft on the way out. "Discard changes" in the dialog above is
  // the one deliberate exception.
  const discardRef = useRef(false);
  useEffect(
    () => () => {
      if (!dirtyRef.current || discardRef.current) return;
      const latest = formRef.current;
      Promise.resolve(inflight.current)
        .catch(() => {})
        .then(() => campaignApi.update(campaign.id, latest))
        .then(() => toast.success("Your unsaved changes were saved to the draft", { id: "campaign-save" }))
        .catch((e) => toast.error(`Unsaved changes could not be saved: ${e.message}`, { id: "campaign-save", duration: 8000 }));
    },
    [campaign.id]
  );

  /* ── inserting at the caret ── */
  const fieldEls = useRef({});
  const [lastField, setLastField] = useState("bodyHtml");
  const bind = (key) => ({
    ref: (el) => { fieldEls.current[key] = el; },
    onFocus: () => setLastField(key),
  });

  const insertInto = useCallback(
    (key, text) => {
      const el = fieldEls.current[key];
      if (!el || !el.isConnected) {
        setForm((f) => ({ ...f, [key]: (f[key] || "") + text }));
        return;
      }
      el.focus();
      // execCommand keeps the insertion on the browser's own undo stack, so ⌘Z
      // takes a snippet back out. It fires a real input event, which is what
      // updates the form. Where it is not supported, splice by hand.
      let done = false;
      try {
        done = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
      } catch {
        done = false;
      }
      if (!done) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = el.value.slice(0, start) + text + el.value.slice(end);
        setForm((f) => ({ ...f, [key]: next }));
        requestAnimationFrame(() => {
          try { el.setSelectionRange(start + text.length, start + text.length); } catch { /* detached */ }
        });
      }
    },
    []
  );

  const insertTag = (tag) => {
    // The body lives in a textarea that may be showing; the plain-text field
    // may be folded away. Fall back to the body when the target is gone.
    const target = fieldEls.current[lastField]?.isConnected ? lastField : "bodyHtml";
    insertInto(target, tag);
  };

  const insertSnippet = (html) => {
    const el = fieldEls.current.bodyHtml;
    const pos = el ? (el.selectionStart ?? el.value.length) : form.bodyHtml.length;
    const before = el ? el.value.slice(0, pos) : form.bodyHtml;
    const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    insertInto("bodyHtml", `${lead}${html}\n`);
    setLastField("bodyHtml");
  };

  // Tab indents inside the HTML body. Escape then Tab leaves the field, so the
  // textarea is never a keyboard trap.
  const escArmed = useRef(false);
  const onCodeKeyDown = (e) => {
    if (e.key === "Escape") {
      escArmed.current = true;
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (escArmed.current) {
        escArmed.current = false;
        return;
      }
      e.preventDefault();
      insertInto("bodyHtml", "  ");
      return;
    }
    escArmed.current = false;
  };

  /* ── preview, audience ── */
  const preview = useEmailPreview(form);
  const countState = useAudienceCount(form.audience);
  const count = countState.data?.count;

  /* ── test send ── */
  const [testTo, setTestTo] = useState([]);
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    const to = testTo.map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) {
      toast.error("Add at least one address to send the test to.");
      return;
    }
    const bad = to.filter((a) => !EMAIL_RE.test(a));
    if (bad.length) {
      toast.error(`Not an email address: ${bad.join(", ")}`);
      return;
    }
    if (!form.bodyHtml.trim()) {
      toast.error("Write the email body before sending a test.");
      return;
    }
    setTesting(true);
    try {
      if (dirtyRef.current) {
        try {
          await save({ quiet: true });
        } catch {
          return; // save() already said why
        }
      }
      const tid = toast.loading(`Sending a test to ${plural(to.length, "address", "addresses")}…`);
      try {
        const res = await campaignApi.testSend(campaign.id, to);
        const sent = res.sent || [];
        const failed = res.failed || [];
        if (failed.length === 0) {
          toast.success(`Test sent to ${sent.join(", ")}`, { id: tid, duration: 5000 });
        } else {
          toast.error(
            <div className="text-[12.5px] leading-snug">
              <p className="font-semibold">
                {sent.length ? `Sent to ${sent.join(", ")}, but not to:` : "The test was not delivered to:"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {failed.map((f) => (
                  <li key={f.to}>
                    <span className="font-medium">{f.to}</span> — {f.error}
                  </li>
                ))}
              </ul>
            </div>,
            { id: tid, duration: 10000 }
          );
        }
        onRefresh();
      } catch (e) {
        if (e.status === 503) {
          toast.error(`${e.message || "Email sending is not available."} Check Settings → Email.`, { id: tid, duration: 8000 });
        } else if (e.status === 502) {
          toast.error(`The test could not be delivered: ${e.message}`, { id: tid, duration: 9000 });
        } else {
          toast.error(`Test not sent: ${e.message}`, { id: tid, duration: 7000 });
        }
      }
    } finally {
      setTesting(false);
    }
  }

  /* ── send ── */
  const smtpIssue = smtpProblem(stats?.smtp);
  let blocker = null;
  if (smtpIssue) blocker = smtpIssue.short;
  else if (!form.subject.trim()) blocker = "Add a subject first";
  else if (!form.bodyHtml.trim()) blocker = "Write the email body first";
  else if (countState.error) blocker = "Could not count the recipients";
  else if (count == null) blocker = "Counting recipients…";
  else if (countState.loading) blocker = "Updating the recipient count…";
  else if (count === 0) blocker = form.audience.mode === "selected" ? "Choose at least one customer" : "Nobody matches this audience";

  const sendLabel = count != null && count > 0 ? `Send to ${plural(count, "customer")}` : "Send";
  const [confirming, setConfirming] = useState(false);

  async function openSend() {
    if (blocker) return;
    if (dirtyRef.current) {
      try {
        await save({ quiet: true });
      } catch {
        return;
      }
    }
    setConfirming(true);
  }

  const audienceText = useMemo(() => audienceSummary(form.audience, sites), [form.audience, sites]);

  const layoutHint =
    form.layout === "branded"
      ? "Your content sits inside the Vodafone email: logo, red title band and footer."
      : "You write the whole HTML document, sent exactly as written (merge tags filled in).";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Email campaign · Draft"
        title={form.name.trim() || "Untitled campaign"}
        subtitle="Write it, choose who gets it, send yourself a test, then send."
        icon={<Megaphone size={22} />}
        tone="pink"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => requestLeave("/email-campaigns")} iconLeft={<ArrowLeft size={14} />}>
              All campaigns
            </Button>
            {/* On a phone these three live in the sticky bar at the bottom instead,
                in reach wherever the long form has been scrolled to. */}
            <span className="px-1 max-sm:hidden"><SaveState dirty={dirty} saving={saving} savedAt={savedAt} /></span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => save().catch(() => {})}
              loading={saving}
              disabled={!dirty}
              iconLeft={<Save size={14} />}
              title="Save draft (⌘S / Ctrl+S)"
              className="max-sm:hidden"
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={openSend}
              disabled={!!blocker || saving}
              iconLeft={<Send size={14} />}
              title={blocker || undefined}
              className="max-sm:hidden"
            >
              {sendLabel}
            </Button>
          </>
        }
      />

      {smtpIssue && (
        <Callout
          tone="warning"
          title={smtpIssue.title}
          action={
            <Button size="sm" variant="secondary" onClick={() => requestLeave("/settings?tab=email")} iconLeft={<SettingsIcon size={14} />}>
              Open Settings → Email
            </Button>
          }
        >
          {smtpIssue.detail} Keep writing — the draft saves as normal.
        </Callout>
      )}

      {/* Three grid children rather than two columns, so that on a phone the
          preview lands right after the content it previews instead of below
          the audience picker. On wide screens the preview takes the right
          column across both rows and stays in view while the form scrolls. */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        {/* ── 1 · Details + content ── */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-1">
          <Panel title="Details" subtitle="What the inbox shows before anyone opens it" icon={<Type size={15} />} tone="pink">
            <div className="flex flex-col gap-4">
              <Field label="Campaign name" htmlFor="c-name" hint="Internal — only admins see this.">
                <Input
                  id="c-name"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="e.g. September data bonus"
                  maxLength={200}
                />
              </Field>
              <Field
                label="Subject"
                required
                htmlFor="c-subject"
                hint={
                  <>
                    <span className={cn("tabular-nums", form.subject.length > 78 && "font-semibold text-[var(--warning-fg)]")}>
                      {plural(form.subject.length, "character")}
                    </span>
                    {" — around 60 or fewer keeps phones from cutting it off."}
                  </>
                }
              >
                <Input
                  id="c-subject"
                  value={form.subject}
                  onChange={(e) => setField("subject", e.target.value)}
                  placeholder="e.g. Double data in {{village}} this weekend"
                  maxLength={250}
                  {...bind("subject")}
                />
              </Field>
              <Field
                label="Preheader"
                htmlFor="c-preheader"
                hint="The grey line most inbox apps show after the subject. Leave empty and they show the first words of the email."
              >
                <Input
                  id="c-preheader"
                  value={form.preheader}
                  onChange={(e) => setField("preheader", e.target.value)}
                  placeholder="e.g. Buy any plan before Sunday and get twice the data"
                  maxLength={250}
                  {...bind("preheader")}
                />
              </Field>
              <MergeTagBar target={lastField} onInsert={insertTag} className="border-t border-[var(--border-subtle)] pt-3" />
            </div>
          </Panel>

          <Panel title="Content" subtitle="The email itself" icon={<Code2 size={15} />} tone="pink">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Segmented
                  size="sm"
                  options={[
                    { value: "branded", label: "Branded" },
                    { value: "raw", label: "Raw HTML" },
                  ]}
                  value={form.layout}
                  onChange={(v) => setField("layout", v)}
                  className="self-start max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
                />
                <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">{layoutHint}</p>
              </div>

              {form.layout === "branded" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Heading" htmlFor="c-heading" hint="Big title in the red band. Empty uses the subject.">
                    <Input
                      id="c-heading"
                      value={form.heading}
                      onChange={(e) => setField("heading", e.target.value)}
                      placeholder={form.subject || "Same as the subject"}
                      {...bind("heading")}
                    />
                  </Field>
                  <Field label="Subheading" htmlFor="c-subheading" hint="Optional line under the title.">
                    <Input
                      id="c-subheading"
                      value={form.subheading}
                      onChange={(e) => setField("subheading", e.target.value)}
                      placeholder="Optional"
                      {...bind("subheading")}
                    />
                  </Field>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <label htmlFor="c-body" className="flex items-center gap-1 text-[12px] font-medium tracking-tight text-[var(--text-secondary)]">
                    {form.layout === "branded" ? "Body HTML" : "HTML document"}
                    <span aria-hidden="true" className="leading-none text-[var(--brand)]">*</span>
                  </label>
                  {form.layout === "branded" ? (
                    <div
                      className="flex flex-wrap items-center gap-1 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:gap-2"
                      role="group"
                      aria-label="Insert a block"
                    >
                      <span className="mr-0.5 text-[11.5px] font-medium text-[var(--fg-muted)] max-sm:col-span-2">Insert</span>
                      {SNIPPETS.map(({ key, label, Icon, html }) => (
                        <Button
                          key={key}
                          size="xs"
                          variant="secondary"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertSnippet(html)}
                          iconLeft={<Icon size={12} />}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    !form.bodyHtml.trim() && (
                      <Button size="xs" variant="secondary" onClick={() => insertSnippet(RAW_STARTER)} iconLeft={<FileCode2 size={12} />}>
                        Start from a blank template
                      </Button>
                    )
                  )}
                </div>
                <Textarea
                  id="c-body"
                  value={form.bodyHtml}
                  onChange={(e) => setField("bodyHtml", e.target.value)}
                  onKeyDown={onCodeKeyDown}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  rows={18}
                  aria-describedby="c-body-hint"
                  placeholder={
                    form.layout === "branded"
                      ? '<p style="margin:0 0 16px;">Bula {{email}}, …</p>\n\nOr use Insert above for a paragraph, button, image or divider.'
                      : "<!DOCTYPE html>\n<html>…</html>"
                  }
                  className="min-h-[420px] resize-y font-mono! text-[12.5px]! leading-5! max-sm:min-h-[300px] max-sm:text-[16px]! max-sm:leading-6!"
                  ref={(el) => { fieldEls.current.bodyHtml = el; }}
                  onFocus={() => setLastField("bodyHtml")}
                />
                {/* Keyboard shortcuts mean nothing on a phone's on-screen keyboard. */}
                <p id="c-body-hint" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-tertiary)] max-sm:hidden">
                  <span><Kbd>Tab</Kbd> indents</span>
                  <span><Kbd>Esc</Kbd> then <Kbd>Tab</Kbd> leaves the editor</span>
                  <span><Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd> + <Kbd>S</Kbd> saves</span>
                </p>
                <MergeTagBar target={lastField} onInsert={insertTag} className="mt-1" />
              </div>

              <Disclosure
                defaultOpen={!!campaign.bodyText}
                summary={
                  <span className="inline-flex items-center gap-2">
                    Plain-text version
                    <span className="hidden text-[11.5px] font-normal text-[var(--fg-muted)] sm:inline">
                      {form.bodyText.trim() ? "written by hand" : "optional — generated from the HTML"}
                    </span>
                  </span>
                }
              >
                <Field
                  label="Plain text"
                  htmlFor="c-text"
                  hint="Leave empty to generate it from the HTML. Shown by mail apps that don't display HTML, and read by some spam filters."
                  className="pt-3"
                >
                  <Textarea
                    id="c-text"
                    value={form.bodyText}
                    onChange={(e) => setField("bodyText", e.target.value)}
                    rows={8}
                    spellCheck
                    className="resize-y font-mono! text-[12.5px]! leading-5! max-sm:text-[16px]! max-sm:leading-6!"
                    {...bind("bodyText")}
                  />
                </Field>
              </Disclosure>
            </div>
          </Panel>
        </div>

        {/* ── Preview ── */}
        <div className="min-w-0 xl:sticky xl:top-5 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <EmailPreview
            preview={preview}
            preheader={form.preheader}
            from={stats?.smtp?.from}
            frameClassName="h-[440px] sm:h-[560px] xl:h-[calc(100vh-300px)] xl:min-h-[440px]"
          />
        </div>

        {/* ── 2 · Audience + test + send ── */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-2">
          <Panel title="Audience" subtitle={audienceText} icon={<Users size={15} />} tone="pink">
            <AudienceEditor
              audience={form.audience}
              onChange={(audience) => setField("audience", audience)}
              sites={sites}
              countState={countState}
              contactsByEmail={contactsByEmail}
              onRememberContacts={rememberContacts}
            />
          </Panel>

          <Panel title="Test and send" subtitle="See it in a real inbox, then send it" icon={<Send size={15} />} tone="pink" padding={false}>
            <div className="flex flex-col gap-3 px-5 py-5">
              <div className="flex items-center gap-2">
                <FlaskConical size={15} className="text-[var(--fg-muted)]" />
                <h4 className="text-[13px] font-semibold text-[var(--fg-primary)]">Send a test</h4>
              </div>
              <p className="-mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                Sends the saved draft with “[TEST]” before the subject and a sample customer's details in the merge
                tags. Unsaved changes are saved first.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <TagInput
                    value={testTo}
                    onChange={(next) => {
                      if (next.length > MAX_TEST_ADDRESSES) {
                        toast.error(`Up to ${MAX_TEST_ADDRESSES} addresses per test — kept the first ${MAX_TEST_ADDRESSES}.`);
                      }
                      setTestTo(next.slice(0, MAX_TEST_ADDRESSES));
                    }}
                    commitOnBlur
                    splitOnComma
                    inputLabel="Test recipients, up to five addresses"
                    className="pointer-coarse:min-h-11 pointer-coarse:[&_button]:-my-1.5 pointer-coarse:[&_button]:-mr-1.5 pointer-coarse:[&_button]:grid pointer-coarse:[&_button]:h-8 pointer-coarse:[&_button]:w-8 pointer-coarse:[&_button]:place-items-center"
                    placeholder="you@vodafone.com.fj, a colleague…"
                  />
                  <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
                    {testTo.length}/{MAX_TEST_ADDRESSES} addresses
                    {campaign.lastTestAt && (
                      <> · last test {relTime(campaign.lastTestAt)}{campaign.lastTestTo ? ` to ${campaign.lastTestTo}` : ""}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={sendTest}
                  loading={testing}
                  disabled={testing || !!smtpIssue?.blocksTest}
                  iconLeft={!testing && <FlaskConical size={14} />}
                  title={smtpIssue?.blocksTest ? smtpIssue.short : undefined}
                >
                  Send test
                </Button>
              </div>
            </div>

            <div className="border-t border-[var(--border-subtle)] px-5 py-5">
              <p className="text-label mb-1">Before it goes</p>
              <ul className="divide-y divide-[var(--border-subtle)]">
                <CheckItem
                  state={form.subject.trim() ? "ok" : "bad"}
                  label="Subject"
                  detail={form.subject.trim() ? form.subject : "Required"}
                />
                <CheckItem
                  state={form.bodyHtml.trim() ? "ok" : "bad"}
                  label="Content"
                  detail={
                    form.bodyHtml.trim()
                      ? `${form.layout === "branded" ? "Branded" : "Raw HTML"}${preview.data?.warnings?.length ? ` · ${plural(preview.data.warnings.length, "warning")} in the preview` : ""}`
                      : "Required"
                  }
                />
                <CheckItem
                  state={countState.error ? "bad" : count == null || countState.loading ? "wait" : count > 0 ? "ok" : "bad"}
                  label="Recipients"
                  detail={
                    countState.error
                      ? "Could not be counted"
                      : count == null
                        ? "Counting…"
                        : `${plural(count, "customer")} · ${audienceText}`
                  }
                />
                <CheckItem
                  state={!stats?.smtp ? "optional" : smtpIssue ? "bad" : "ok"}
                  label="Email sending"
                  detail={!stats?.smtp ? "Could not be checked" : smtpIssue ? smtpIssue.short : `From ${stats.smtp.from || "the default sender"}`}
                />
                <CheckItem
                  state={campaign.lastTestAt ? "ok" : "optional"}
                  label="Test email"
                  detail={campaign.lastTestAt ? `Sent ${relTime(campaign.lastTestAt)}` : "Recommended, not required"}
                />
              </ul>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={openSend}
                  disabled={!!blocker || saving}
                  iconLeft={<Send size={15} />}
                  className="w-full sm:w-auto"
                >
                  {sendLabel}
                </Button>
                <p className="text-[12px] text-[var(--fg-muted)] sm:ml-2">
                  {blocker ? blocker : dirty ? "Your changes are saved before the confirmation." : "You'll confirm the exact number next."}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Phone action bar. Sticky, not fixed: it rides the bottom of the screen
          while the long form scrolls, then settles into its own place at the
          end of the page, so it never permanently covers anything. */}
      <div
        className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5 pl-3.5 shadow-[var(--shadow-elevated)] sm:hidden"
        role="region"
        aria-label="Save and send"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <SaveState dirty={dirty} saving={saving} savedAt={savedAt} />
          {blocker && <span className="truncate text-[11.5px] text-[var(--fg-muted)]">{blocker}</span>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => save().catch(() => {})}
          loading={saving}
          disabled={!dirty}
          iconLeft={<Save size={14} />}
        >
          Save
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={openSend}
          disabled={!!blocker || saving}
          iconLeft={<Send size={14} />}
          aria-label={sendLabel}
        >
          Send
        </Button>
      </div>

      {confirming && count != null && (
        <SendConfirmModal
          campaign={campaign}
          subject={form.subject}
          audienceText={audienceText}
          count={count}
          sendPerMinute={campaign.sendPerMinute || stats?.sendPerMinute}
          onClose={() => setConfirming(false)}
          onSent={(next) => {
            setConfirming(false);
            onCampaign(next);
          }}
          onStale={() => {
            setConfirming(false);
            onReload();
          }}
          onCountChanged={countState.retry}
        />
      )}

      <Modal open={!!leaveTo} onClose={() => setLeaveTo(null)} width="sm">
        <Modal.Header
          eyebrow="Unsaved changes"
          title="Leave this draft?"
          subtitle="Your latest edits haven't been saved."
          icon={Save}
          onClose={() => setLeaveTo(null)}
        />
        <Modal.Footer className="flex-wrap max-sm:flex-col-reverse max-sm:items-stretch">
          <Button variant="ghost" size="sm" onClick={() => setLeaveTo(null)}>
            Stay
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const to = leaveTo;
              setLeaveTo(null);
              // Mark clean first so the guard does not catch its own navigation,
              // and so leaving does not save what was just discarded.
              discardRef.current = true;
              setSavedPrint(fingerprint(formRef.current));
              navigate(to);
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={async () => {
              const to = leaveTo;
              try {
                await save({ quiet: true });
                setLeaveTo(null);
                navigate(to);
              } catch {
                /* save() explained; stay put */
              }
            }}
          >
            Save and leave
          </Button>
        </Modal.Footer>
      </Modal>
    </PageShell>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function EmailCampaignEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { sites } = useSite();

  const [campaign, setCampaign] = useState(null);
  const [stats, setStats] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      // Stats only decide whether Send can be offered; if they fail, the server
      // still refuses a send it cannot make, so the page carries on without.
      const [c, s] = await Promise.all([campaignApi.get(id), campaignApi.stats().catch(() => null)]);
      setCampaign(c.campaign);
      setStats(s);
      setState("ready");
    } catch (e) {
      if (e.status === 404 || e.status === 400) {
        setState("missing");
      } else {
        setError(e.message);
        setState("error");
      }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Quiet refresh of the campaign's own record (lastTestAt and so on) without
  // touching what is being edited.
  const refresh = useCallback(async () => {
    try {
      const { campaign: next } = await campaignApi.get(id);
      setCampaign(next);
    } catch { /* not worth interrupting the editor for */ }
  }, [id]);

  if (state === "loading") {
    return (
      <PageShell>
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-6 py-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12" rounded="rounded-[14px]" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" rounded="rounded-md" />
              <Skeleton className="h-6 w-64" rounded="rounded-md" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
          <SkeletonCard height="h-[520px]" />
          <SkeletonCard height="h-[520px]" />
        </div>
      </PageShell>
    );
  }

  if (state === "missing" || state === "error") {
    return (
      <PageShell>
        <Panel>
          <EmptyState
            icon={Megaphone}
            title={state === "missing" ? "This campaign doesn't exist" : "Could not open this campaign"}
            description={state === "missing" ? "It may have been a draft that someone deleted." : error}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => navigate("/email-campaigns")} iconLeft={<ArrowLeft size={14} />}>
                  All campaigns
                </Button>
                {state === "error" && (
                  <Button variant="primary" size="sm" onClick={load} iconLeft={<RefreshCw size={14} />}>
                    Try again
                  </Button>
                )}
              </div>
            }
          />
        </Panel>
      </PageShell>
    );
  }

  if (campaign.status === "draft") {
    return (
      <DraftEditor
        key={campaign.id}
        campaign={campaign}
        stats={stats}
        sites={sites}
        onCampaign={setCampaign}
        onRefresh={refresh}
        onReload={load}
      />
    );
  }

  return <CampaignReport key={campaign.id} campaign={campaign} stats={stats} sites={sites} onCampaign={setCampaign} />;
}
