// src/components/ui/CodeInput.jsx
//
// One-time-code entry as separate slots, one digit each.
//
// A single text field works, but it makes someone check their own typing — six
// characters in a row with no landmarks is easy to get wrong and hard to scan.
// Slots give the code a shape: you can see at a glance how many are in, and a
// mistake is one backspace away rather than a re-read.
//
// Behaviours that matter, all of which are absent if you leave it to the
// browser: typing advances, backspace on an empty slot steps back and clears
// the one before it, arrows move without editing, and a pasted code is split
// across the slots instead of landing entirely in the first one. When the last
// slot fills, onComplete fires — nobody should have to reach for a button after
// typing the final digit of a code that is already unambiguous.

import { useEffect, useRef } from "react";

export default function CodeInput({
  value = "",
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  autoFocus = false,
  ariaLabel = "Verification code",
}) {
  const refs = useRef([]);
  // onComplete must not re-fire for a value that has already been submitted,
  // or a rejected code would resubmit itself on every re-render.
  const firedFor = useRef(null);
  // Someone typing quickly — or a phone pushing an autofilled code through
  // one keystroke at a time — lands several keys inside one render. Reading
  // the value from the render closure would then build each digit on top of a
  // value that is already one or two digits stale, and the earlier ones are
  // silently lost. The ref is what the slots actually hold right now.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);

  const chars = value.split("").slice(0, length);
  const slots = () => Array.from({ length }, (_, i) => latest.current[i] ?? "");
  function emit(next) {
    // Trailing blanks are trimmed so `value.length` is a truthful measure of
    // how much has been entered — a hole in the middle would lie about it.
    const joined = next.join("").replace(/\s+$/, "");
    latest.current = joined;
    onChange?.(joined);
  }

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === length && firedFor.current !== value) {
      firedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) firedFor.current = null;
  }, [value, length, onComplete]);

  function setAt(index, char) {
    const next = slots();
    next[index] = char;
    emit(next);
  }

  function focusAt(index) {
    const el = refs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  }

  function handleChange(index, raw) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    if (digits.length > 1) {
      // Some Android keyboards deliver an autofilled code as one burst into
      // whichever slot had focus. Treat that exactly like a paste.
      distribute(digits, index);
      return;
    }
    setAt(index, digits);
    if (index < length - 1) focusAt(index + 1);
  }

  function distribute(digits, from = 0) {
    const next = slots();
    let cursor = from;
    for (const d of digits) {
      if (cursor >= length) break;
      next[cursor++] = d;
    }
    emit(next);
    focusAt(cursor);
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (latest.current[index]) {
        setAt(index, "");
      } else if (index > 0) {
        const next = slots();
        next[index - 1] = "";
        emit(next);
        focusAt(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(index, e) {
    const text = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    // A pasted full-length code starts at the beginning no matter which slot
    // received it — that is almost always what someone means.
    distribute(text, text.length >= length ? 0 : index);
  }

  return (
    <div
      className={`flex items-center gap-2 sm:gap-2.5 ${invalid ? "animate-shake" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {Array.from({ length }).map((_, i) => {
        const filled = Boolean(chars[i]);
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            // Only the first slot advertises itself as the code field, so a
            // browser or phone offering to autofill puts the whole code in one
            // place — where distribute() can spread it — instead of six.
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of ${length}`}
            maxLength={1}
            disabled={disabled}
            value={chars[i] ?? ""}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.target.select()}
            className={
              "h-13 w-full min-w-0 flex-1 rounded-xl text-center font-mono " +
              "text-[21px] font-semibold tabular-nums leading-none " +
              "border transition-[border-color,box-shadow,background-color,color] duration-150 " +
              "outline-none disabled:opacity-50 disabled:cursor-not-allowed " +
              (invalid
                ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-fg)] "
                : filled
                  ? "border-[var(--brand)] bg-[var(--surface)] text-[var(--fg-primary)] "
                  : "border-[var(--input-border)] bg-[var(--bg-surface)] text-[var(--fg-primary)] ") +
              "focus:border-[var(--brand)] focus:bg-[var(--surface)] " +
              "focus:shadow-[0_0_0_3px_var(--brand-soft)]"
            }
            style={{ height: 52 }}
          />
        );
      })}
    </div>
  );
}
