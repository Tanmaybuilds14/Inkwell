"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const TYPE_SPEED_MS = 35;
const CARET_FADE_MS = 800;
const REVEAL_THRESHOLD = 0.4;

/**
 * A heading that types itself out, once, when it scrolls into view.
 *
 * Four things make this safe to drop around any heading:
 *
 *  - **No layout shift.** The full text is rendered twice: an invisible copy
 *    holds the final box (same font, same wrapping), and the typed copy paints
 *    over it from an absolutely positioned layer, so not one pixel moves while
 *    characters appear.
 *  - **Screen readers get the whole heading immediately.** The *visible* copy
 *    is aria-hidden; the accessible name comes from an sr-only copy of the full
 *    text, which is in the tree from first paint.
 *  - **Runs once.** The observer unobserves on first intersection, so scrolling
 *    back up never replays it.
 *  - **Reduced motion.** The finished heading is shown at once, with no caret
 *    and no timers.
 *
 * `onStart` fires the moment typing begins — used by the feature sections to
 * fade the body copy in behind the heading instead of making it wait.
 */
export function TypewriterHeading({
  text,
  as: Tag = "h2",
  className,
  speed = TYPE_SPEED_MS,
  onStart,
}) {
  const ref = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const [started, setStarted] = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const [caretGone, setCaretGone] = useState(false);

  // Start on first intersection, then stop watching.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStarted(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: REVEAL_THRESHOLD }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Let the parent fade in the rest of the section. Kept in an effect (not in
  // the observer callback) so it can never fire during the observer's own pass.
  useEffect(() => {
    if (!started) return;
    onStart?.();
  }, [started, onStart]);

  // Type one character per tick.
  useEffect(() => {
    if (reducedMotion || !started || typedCount >= text.length) return;
    const id = setTimeout(() => setTypedCount((count) => count + 1), speed);
    return () => clearTimeout(id);
  }, [reducedMotion, started, typedCount, text.length, speed]);

  const done = typedCount >= text.length;

  // Hold the caret for a beat after the last character, then fade it out.
  useEffect(() => {
    if (reducedMotion || !done) return;
    const id = setTimeout(() => setCaretGone(true), CARET_FADE_MS);
    return () => clearTimeout(id);
  }, [reducedMotion, done]);

  const visibleCount = reducedMotion ? text.length : typedCount;
  const showCaret = !reducedMotion && started && !caretGone;

  return (
    <Tag ref={ref} className={cn("relative", className)}>
      {/* The accessible heading, available immediately. */}
      <span className="sr-only">{text}</span>
      {/* Reserves the final box so nothing reflows while typing. */}
      <span aria-hidden="true" className="invisible">
        {text}
      </span>
      {/* The typed copy, painted exactly on top of the reservation. */}
      <span aria-hidden="true" className="absolute inset-0">
        {text.slice(0, visibleCount)}
        {showCaret && (
          <span className={cn("tw-caret", done && "tw-caret-hidden")}>
            <span className="tw-caret-bar" />
          </span>
        )}
      </span>
    </Tag>
  );
}
