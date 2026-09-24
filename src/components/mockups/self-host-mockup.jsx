"use client";

import { MockupFrame } from "@/components/mockups/mockup-frame";
import {
  useMockupSteps,
  useOnScreen,
} from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

const COMMAND = "docker compose up";

/** What `docker compose up` prints, in order, ending with the green line. */
const LINES = [
  { text: "postgres   ready", tone: "check" },
  { text: "redis      ready", tone: "check" },
  { text: "sync-server listening on :1234", tone: "info" },
  { text: "web ready on :3000", tone: "info" },
  { text: "✓ Inkwell is running", tone: "success" },
];

const LINE_TONE = {
  check: "text-stone-300",
  info: "text-stone-400",
  success: "font-semibold text-emerald-400",
};

export function SelfHostMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.3 });
  // Step 0 is the bare command; each step after it prints one more log line.
  const step = useMockupSteps({
    playing: onScreen,
    reducedMotion,
    length: LINES.length + 1,
    intervalMs: 650,
    holdMs: 2600,
  });

  const visible = Math.min(step, LINES.length);

  return (
    <MockupFrame
      observeRef={ref}
      padding="p-0"
      className="mockup-surface-dark"
    >
      <div className="flex items-center gap-1.5 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 font-mono text-[11px] text-stone-400">
          inkwell — bash
        </span>
      </div>

      <div className="flex-1 border-t border-white/10 px-4 py-3 font-mono text-[11px] leading-relaxed">
        <p className="text-stone-200">
          <span className="text-emerald-400">$</span> {COMMAND}
        </p>
        <div className="mt-2 space-y-1">
          {LINES.slice(0, visible).map((line) => (
            <p key={line.text} className={cn("mockup-fade-in", LINE_TONE[line.tone])}>
              {line.tone === "check" && <span className="text-emerald-400">✔ </span>}
              {line.text}
            </p>
          ))}
        </div>
      </div>
    </MockupFrame>
  );
}
