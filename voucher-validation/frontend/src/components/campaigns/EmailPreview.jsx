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

import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, Monitor, Smartphone, AlignLeft, RefreshCw, AlertTriangle } from "lucide-react";
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
        <span className="hidden sm:inline-flex">
          <Segmented size="sm" options={DEVICES} value={device} onChange={setDevice} />
        </span>
      }
    >
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
