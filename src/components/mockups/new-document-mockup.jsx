"use client";

import { useEffect, useState } from "react";
import { Check, FileText } from "lucide-react";
import { MockupFrame } from "@/components/mockups/mockup-frame";
import { useOnScreen } from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

const TITLE = "Q3 roadmap";
const TEMPLATES = ["Blank", "Meeting notes", "Spec"];

const TICK_MS = 90;
const SETTLE_MS = 1400;
const HOLD_MS = 1400;

/**
 * The first-run dialog: type a title, pick a template, create the document.
 * The title types itself, the primary button lifts once a title exists, then
 * the whole thing starts over — same start/pause/reduced-motion rules as every
 * other mockup (see use-mockup-animation.js).
 */
export function NewDocumentMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.35 });
  const [typed, setTyped] = useState(0);
  const [ready, setReady] = useState(false);

  const complete = typed >= TITLE.length;

  useEffect(() => {
    if (reducedMotion || !onScreen) return;

    if (!complete) {
      const id = setTimeout(() => setTyped((count) => count + 1), TICK_MS);
      return () => clearTimeout(id);
    }

    if (!ready) {
      const id = setTimeout(() => setReady(true), SETTLE_MS);
      return () => clearTimeout(id);
    }

    const id = setTimeout(() => {
      setReady(false);
      setTyped(0);
    }, HOLD_MS);
    return () => clearTimeout(id);
  }, [reducedMotion, onScreen, complete, ready]);

  const shown = reducedMotion ? TITLE.length : typed;
  const isReady = reducedMotion || ready;

  return (
    <MockupFrame observeRef={ref}>
      <div>
        <p className="text-sm font-semibold text-foreground">New document</p>
        <p className="text-[11px] text-muted-foreground">
          Everything is editable later.
        </p>
      </div>

      <div className="mockup-rule mt-4 flex-1 pt-4">
        <p className="text-[11px] font-medium text-muted-foreground">Title</p>
        <div className="mockup-hairline mt-2 flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs text-foreground">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{TITLE.slice(0, shown)}</span>
          {!isReady && (
            <span className="ml-px inline-block h-[1em] w-[2px] animate-pulse rounded-full bg-foreground align-text-bottom" />
          )}
        </div>

        <p className="mt-5 text-[11px] font-medium text-muted-foreground">
          Start from
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TEMPLATES.map((template, index) => (
            <span
              key={template}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[11px]",
                index === 0
                  ? "bg-secondary text-secondary-foreground"
                  : "mockup-hairline text-muted-foreground"
              )}
            >
              {template}
            </span>
          ))}
        </div>
      </div>

      <span
        className={cn(
          "mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-medium text-primary-foreground transition-opacity duration-300",
          isReady ? "opacity-100" : "opacity-60"
        )}
      >
        {isReady && <Check className="h-3.5 w-3.5" />}
        Create document
      </span>
    </MockupFrame>
  );
}
