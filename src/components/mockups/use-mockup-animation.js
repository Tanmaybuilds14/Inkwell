"use client";

import { useEffect, useRef, useState } from "react";

/**
 * IntersectionObserver as a boolean.
 *
 * `onScreen` is true only while the observed element is actually in the
 * viewport, which is what lets the mockups start on arrival, stop their timers
 * the moment they scroll out of view, and pick up where they left off when they
 * come back. (Reduced motion is handled separately: `usePrefersReducedMotion`
 * from @/hooks, which makes a mockup render its finished state with no timers.)
 */
export function useOnScreen({ threshold = 0.3, rootMargin = "0px" } = {}) {
  const ref = useRef(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return [ref, onScreen];
}

/**
 * A small step machine for the mockups.
 *
 * While `playing` it walks 0 → length - 1 one step at a time, pauses `holdMs`
 * on the last step, then loops (or settles there when `loop` is false). When
 * the element leaves the viewport the effect is cleaned up, so the sequence
 * freezes in place instead of running off-screen.
 *
 * Under reduced motion the timers never start at all: the hook reports
 * `finalStep`, which is how every mockup ends up rendering its finished state
 * statically.
 */
export function useMockupSteps({
  playing,
  reducedMotion,
  length,
  intervalMs,
  holdMs = 0,
  loop = true,
  finalStep,
}) {
  const settled = finalStep ?? length - 1;
  const [step, setStep] = useState(0);
  const current = reducedMotion ? settled : step;

  useEffect(() => {
    if (reducedMotion || !playing) return;
    const atEnd = current >= length - 1;
    if (atEnd && !loop) return;

    const id = setTimeout(
      () => setStep((previous) => (previous >= length - 1 ? 0 : previous + 1)),
      atEnd ? Math.max(holdMs, intervalMs) : intervalMs
    );
    return () => clearTimeout(id);
  }, [current, playing, reducedMotion, length, intervalMs, holdMs, loop]);

  return current;
}
