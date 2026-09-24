"use client";

import { MockupFrame } from "@/components/mockups/mockup-frame";
import {
  useMockupSteps,
  useOnScreen,
} from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

const VERSIONS = [
  {
    when: "2 min ago",
    note: "Aisha Khan",
    text: "We ship the beta in June, and the design review lands next week.",
  },
  {
    when: "15 min ago",
    note: "Ben Ortiz",
    text: "We ship the beta in June, and the design review is still open.",
  },
  {
    when: "1 hr ago",
    note: "Aisha Khan",
    text: "We plan to ship the beta, and the design review is still open.",
  },
  {
    when: "3 hr ago",
    note: "Chen Wu",
    text: "We plan to ship this quarter. The design review is still open.",
  },
  {
    when: "Yesterday",
    note: "Ben Ortiz",
    text: "Draft: goals for the next quarter.",
  },
];

export function VersionHistoryMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.3 });
  const step = useMockupSteps({
    playing: onScreen,
    reducedMotion,
    length: VERSIONS.length,
    intervalMs: 1500,
    holdMs: 1800,
    // Resting state: the newest snapshot selected.
    finalStep: 0,
  });

  const selected = VERSIONS[step];

  return (
    <MockupFrame observeRef={ref}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Version history</p>
        <span className="text-[11px] text-muted-foreground">
          5 snapshots · 30 days
        </span>
      </div>

      <div className="mt-4 flex flex-1 gap-3">
        <div className="relative w-[6.5rem] shrink-0">
          <span className="absolute inset-y-2 left-3 w-px -translate-x-1/2 bg-border" />
          <ol className="relative space-y-0.5">
            {VERSIONS.map((version, index) => {
              const active = index === step;
              return (
                <li
                  key={version.when}
                  className={cn(
                    "flex items-center gap-2 rounded-md py-1.5 pl-2 pr-1.5",
                    // The moving selection is a highlight, not a repaint.
                    active && "collab-2 collab-highlight"
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      active ? "collab-2 collab-dot" : "bg-border"
                    )}
                  />
                  <span
                    className={cn(
                      "whitespace-nowrap text-[11px]",
                      active
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {version.when}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mockup-hairline flex flex-1 flex-col rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground">
            Preview · {selected.when} · {selected.note}
          </p>
          <p className="mt-2 min-h-[3.5rem] flex-1 text-xs leading-relaxed text-foreground">
            {selected.text}
          </p>
          <span className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-[11px] font-medium text-primary-foreground">
            Restore this version
          </span>
        </div>
      </div>
    </MockupFrame>
  );
}
