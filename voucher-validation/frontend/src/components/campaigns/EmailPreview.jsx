// src/components/campaigns/EmailPreview.jsx
//
// What a customer will actually get, rendered by the SERVER for a sample
// contact — the same code path that builds the real email, so the Vodafone
// shell and the merge tags are in the picture rather than approximated here.
//
// The HTML goes into an iframe with an empty `sandbox` and `srcDoc`, the same
// arrangement as the receipt preview in Txn Flows: an opaque origin, so the
// email can run no script, submit no form, open no window and cannot reach the
// admin's session token in localStorage. The frame is white in both themes
// because email HTML is written for a white page.
//
// The inbox row above the frame is the part people forget to check: the subject
// and preheader are what decide whether the email is opened at all.
//
// "Full page" opens the same render over the whole window, the way the email
// fills a mail client, so a long email can be read top to bottom without
// scrolling inside a 600-pixel box. Still the sandboxed iframe — never a new tab
// or a blob URL, which would run the email's HTML with the console's own origin.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Loader2, Monitor, Smartphone, AlignLeft, RefreshCw, AlertTriangle, Maximize2, X } from "lucide-react";
import { campaignApi } from "../../services/api";
import { Panel, Segmented, Button, Skeleton } from "../ui";
import { Callout } from "./campaignUi";

function cn(...p) {
  return p.filter(Boolean).join(" ");
}

export const PREVIEW_FIELDS = ["subject", "preheader", "heading", "subheading", "layout", "bodyHtml", "bodyText"];

/**
 * Debounced server render of `content`. Only the newest request may land: a
 * slow response for what was typed two seconds ago must not replace the
 * preview of what is on screen now.
 */
export function useEmailPreview(content, { delay = 600 } = {}) {
  const key = JSON.stringify(PREVIEW_FIELDS.map((f) => content?.[f] ?? ""));
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    // The first render has nothing to debounce against — show it straight away.
    const wait = first.current ? 0 : delay;
    first.current = false;
    const timer = setTimeout(async () => {
      const values = JSON.parse(key);
      const body = Object.fromEntries(PREVIEW_FIELDS.map((f, i) => [f, values[i]]));
      try {
        const data = await campaignApi.preview(body);
        if (mine === seq.current) setState({ data, loading: false, error: null });
      } catch (e) {
        if (mine === seq.current) setState((s) => ({ data: s.data, loading: false, error: e.message }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [key, delay, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** "Vodafone Fiji <noreply@…>" → "Vodafone Fiji"; a bare address stays as is. */
function senderName(from) {
  if (!from) return "Vodafone Fiji";
  const m = String(from).match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return (m && m[1]) || from;
}

/**
 * The email over the whole window. Esc or the close button returns to the
 * editor; the page underneath does not scroll while it is open.
 */
function FullPagePreview({ data, preheader, from, initialDevice, onClose }) {
  const [device, setDevice] = useState(initialDevice === "text" ? "text" : initialDevice || "desktop");
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const snippet = preheader?.trim() || (data?.text || "").replace(/\s+/g, " ").trim().slice(0, 160);

  // Once per opening. The preview re-renders while it is open (a debounced
  // re-render landing), and re-running this would steal focus each time.
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full page email preview"
      className="fixed inset-0 z-[1000] flex flex-col bg-[var(--surface-sunken)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-default)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <span
          aria-hidden="true"
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[13px] font-bold text-[var(--text-on-brand)] font-display sm:grid"
        >
          {senderName(from).trim().charAt(0).toUpperCase() || "V"}
        </span>
        {/* A floor on its width, so on a phone the subject takes its own row
            instead of being squeezed to a letter beside the controls. */}
        <div className="min-w-[220px] flex-1">
          <p className="truncate text-[11.5px] text-[var(--fg-muted)]">
            <span className="font-semibold text-[var(--fg-secondary)]">{senderName(from)}</span> · full page preview
          </p>
          <p className="truncate text-[14px] font-semibold text-[var(--fg-primary)]">
            {data?.subject || <span className="italic font-normal text-[var(--fg-muted)]">No subject yet</span>}
          </p>
          {snippet && <p className="hidden truncate text-[12px] text-[var(--fg-muted)] md:block">{snippet}</p>}
        </div>
        <Segmented size="sm" options={DEVICES} value={device} onChange={setDevice} />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface)] px-3.5 text-[12.5px] font-semibold text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-ring"
          aria-label="Close full page preview"
        >
          <X size={14} /> Close <kbd className="ml-1 hidden rounded border border-[var(--border-default)] px-1 font-mono text-[10px] text-[var(--fg-muted)] sm:inline">Esc</kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-0 sm:p-4">
        {device === "text" ? (
          <pre className="mx-auto h-full w-full max-w-[760px] overflow-auto whitespace-pre-wrap break-words bg-[var(--surface)] p-6 font-mono text-[13px] leading-6 text-[var(--fg-secondary)] sm:rounded-xl sm:border sm:border-[var(--border-default)]">
            {data?.text || "(empty)"}
          </pre>
        ) : (
          <div
            className={cn(
              "mx-auto h-full overflow-hidden bg-white shadow-[var(--shadow-elevated)] transition-[width] duration-300",
              device === "mobile" ? "sm:rounded-[28px] sm:border-[6px] sm:border-[var(--border-strong)]" : "sm:rounded-xl sm:border sm:border-[var(--border-default)]"
            )}
            style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }}
          >
            <iframe title="Full page email preview" sandbox="" srcDoc={data?.html || ""} className="block h-full w-full bg-white" />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const DEVICES = [
  { value: "desktop", label: <span className="inline-flex items-center gap-1.5"><Monitor size={13} />Desktop</span> },
  { value: "mobile", label: <span className="inline-flex items-center gap-1.5"><Smartphone size={13} />Mobile</span> },
  { value: "text", label: <span className="inline-flex items-center gap-1.5"><AlignLeft size={13} />Text</span> },
];

export default function EmailPreview({
  preview,               // from useEmailPreview
  preheader = "",
  from,
  title = "Preview",
  subtitle = "Rendered for a sample customer. Links do not open from the preview.",
  frameClassName = "h-[600px]",
  className,
}) {
  const [device, setDevice] = useState("desktop");
  const [fullPage, setFullPage] = useState(false);
  const { data, loading, error, retry } = preview;
  const warnings = data?.warnings || [];
  const snippet = preheader?.trim() || (data?.text || "").replace(/\s+/g, " ").trim().slice(0, 140);

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      icon={<Eye size={15} />}
      tone="pink"
      padding={false}
      className={className}
      actions={
        <span className="inline-flex items-center gap-2">
          <span className="hidden sm:inline-flex">
            <Segmented size="sm" options={DEVICES} value={device} onChange={setDevice} />
          </span>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setFullPage(true)}
            disabled={!data}
            iconLeft={<Maximize2 size={12} />}
            title="Open the email over the whole window"
          >
            Full page
          </Button>
        </span>
      }
    >
      {fullPage && data && (
        <FullPagePreview
          data={data}
          preheader={preheader}
          from={from}
          initialDevice={device}
          onClose={() => setFullPage(false)}
        />
      )}
      {/* Narrow screens: the switch moves under the title so the header never
          has to squeeze three pills beside a subtitle. */}
      <div className="flex justify-center border-b border-[var(--border-subtle)] px-4 py-2.5 sm:hidden">
        <Segmented size="sm" options={DEVICES} value={device} onChange={setDevice} />
      </div>

      {/* Inbox row */}
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[13px] font-bold text-[var(--text-on-brand)] font-display"
        >
          {senderName(from).trim().charAt(0).toUpperCase() || "V"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[12.5px] font-semibold text-[var(--fg-primary)]">{senderName(from)}</span>
            <span className="shrink-0 text-[11px] text-[var(--fg-muted)]">now</span>
          </div>
          <p className="truncate text-[13px] font-semibold text-[var(--fg-primary)]">
            {data?.subject || <span className="italic font-normal text-[var(--fg-muted)]">No subject yet</span>}
          </p>
          <p className="truncate text-[12px] text-[var(--fg-muted)]">{snippet || "No preheader — mail apps will show the first line of the email."}</p>
        </div>
      </div>

      {(warnings.length > 0 || error) && (
        <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
          {error && (
            <Callout
              tone="danger"
              title="The preview could not be rendered"
              action={<Button size="xs" variant="secondary" onClick={retry} iconLeft={<RefreshCw size={12} />}>Retry</Button>}
            >
              {error}
            </Callout>
          )}
          {warnings.length > 0 && (
            <Callout tone="warning" title={warnings.length === 1 ? "One thing to check" : `${warnings.length} things to check`}>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Callout>
          )}
        </div>
      )}

      <div className="relative bg-[var(--bg-surface)] p-3 sm:p-5">
        {loading && data && (
          <span className="absolute right-5 top-5 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-muted)] shadow-[var(--shadow-xs)] sm:right-7 sm:top-7">
            <Loader2 size={11} className="animate-spin" /> Updating
          </span>
        )}

        {!data ? (
          loading ? (
            <Skeleton className={cn("mx-auto w-full max-w-[600px]", frameClassName)} rounded="rounded-lg" />
          ) : (
            <div className={cn("mx-auto grid w-full max-w-[600px] place-items-center rounded-lg border border-dashed border-[var(--border-default)] text-center", frameClassName)}>
              <div className="flex flex-col items-center gap-2 px-6 text-[12.5px] text-[var(--fg-muted)]">
                <AlertTriangle size={18} />
                Nothing to show until the preview renders.
              </div>
            </div>
          )
        ) : device === "text" ? (
          <pre
            className={cn(
              "mx-auto w-full max-w-[600px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-default)]",
              "bg-[var(--surface)] p-5 font-mono text-[12px] leading-5 text-[var(--fg-secondary)]",
              frameClassName
            )}
          >
            {data.text || "(empty)"}
          </pre>
        ) : (
          <div
            className={cn(
              "mx-auto overflow-hidden border bg-white shadow-[var(--shadow-sm)] transition-[width] duration-300",
              device === "mobile" ? "rounded-[22px] border-[var(--border-strong)]" : "rounded-lg border-[var(--border-default)]"
            )}
            style={{ width: device === "mobile" ? 375 : 600, maxWidth: "100%" }}
          >
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={data.html}
              className={cn("block w-full bg-white", frameClassName)}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
