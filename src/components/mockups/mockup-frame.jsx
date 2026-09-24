"use client";

import { cn } from "@/lib/utils";

/**
 * The shell every landing mockup renders inside: a card one notch lighter than
 * the page, behind a hairline border and a 16px radius.
 *
 * Mockups are illustration, not UI. The whole surface is aria-hidden so a
 * screen reader never walks a fake toolbar, and nothing inside it is focusable
 * (no real buttons or inputs — every control is a styled span).
 *
 * `observeRef` is where the mockup hangs its IntersectionObserver, so the
 * animation can start and stop with the card's own visibility.
 */
export function MockupFrame({
  children,
  className,
  padding = "p-4 sm:p-5",
  observeRef,
}) {
  return (
    <div
      ref={observeRef}
      aria-hidden="true"
      className={cn(
        "mockup-card flex min-h-[20rem] flex-col overflow-hidden rounded-2xl",
        padding,
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * One collaborator, as a filled circle. `index` picks the hue (1–4); the ink on
 * top is always dark, which is what keeps the initials readable in both themes.
 */
export function CollabAvatar({ index, initials, className }) {
  return (
    <span
      className={cn(
        "collab-fill inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
        `collab-${index}`,
        className
      )}
    >
      {initials}
    </span>
  );
}

/**
 * A remote collaborator's caret: a 2px bar in their colour with a name tag
 * riding above it, exactly how the product's own carets are labelled.
 */
export function CollabCaret({ index, name }) {
  return (
    <span
      className={cn(
        "relative inline-block w-[2px] align-baseline",
        `collab-${index}`
      )}
    >
      <span className="collab-dot block h-[1.15em] w-[2px] rounded-full" />
      <span className="collab-fill absolute -top-[1.45em] -left-[2px] whitespace-nowrap rounded-[4px] rounded-bl-none px-1.5 py-px text-[10px] font-semibold leading-tight">
        {name}
      </span>
    </span>
  );
}

/** A label/value row used by the share and version mockups. */
export function MockupRow({ children, className }) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2", className)}>
      {children}
    </div>
  );
}
