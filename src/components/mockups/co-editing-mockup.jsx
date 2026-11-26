"use client";

import { useEffect, useState } from "react";
import {
  CollabAvatar,
  CollabCaret,
  MockupFrame,
} from "@/components/mockups/mockup-frame";
import { useOnScreen } from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * The sentence both collaborators are writing into. Aisha types the middle of
 * the first clause, Ben the middle of the second — two carets, two positions,
 * one paragraph, which is the whole point of the section.
 */
const LEAD = "We ship the beta in ";
const AISHA_TEXT = "June";
const MIDDLE = ", and the design review ";
const BEN_TEXT = "lands next week";
const TAIL = ".";

const TICK_MS = 130;
const HOLD_MS = 2000;

const EDITORS = [
  { initials: "AK", index: 1 },
  { initials: "BO", index: 3 },
  { initials: "CW", index: 4 },
];

export function CoEditingMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.35 });
  const [typed, setTyped] = useState({ aisha: 0, ben: 0 });

  const complete =
    typed.aisha >= AISHA_TEXT.length && typed.ben >= BEN_TEXT.length;

  useEffect(() => {
    if (reducedMotion || !onScreen) return;

    // Both carets advance on the same tick, then the finished paragraph rests
    // for two seconds before starting over.
    if (complete) {
      const id = setTimeout(() => setTyped({ aisha: 0, ben: 0 }), HOLD_MS);
      return () => clearTimeout(id);
    }

    const id = setTimeout(() => {
      setTyped((previous) => ({
        aisha: Math.min(previous.aisha + 1, AISHA_TEXT.length),
        ben: Math.min(previous.ben + 1, BEN_TEXT.length),
      }));
    }, TICK_MS);
    return () => clearTimeout(id);
  }, [reducedMotion, onScreen, complete, typed]);

  const aisha = reducedMotion ? AISHA_TEXT.length : typed.aisha;
  const ben = reducedMotion ? BEN_TEXT.length : typed.ben;

  return (
    <MockupFrame observeRef={ref}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Q3 roadmap</p>
          <p className="text-[11px] text-muted-foreground">
            Draft · saved just now
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {EDITORS.map((editor) => (
              <CollabAvatar
                key={editor.initials}
                index={editor.index}
                initials={editor.initials}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">3 editing</span>
        </div>
      </div>

      <div className="mockup-rule mt-4 flex flex-1 items-center pt-5">
        <p className="text-sm leading-[2.1] text-foreground">
          {LEAD}
          <span className="whitespace-nowrap">
            {AISHA_TEXT.slice(0, aisha)}
            <CollabCaret index={1} name="Aisha" />
          </span>
          {MIDDLE}
          <span className="whitespace-nowrap">
            {BEN_TEXT.slice(0, ben)}
            <CollabCaret index={3} name="Ben" />
          </span>
          {TAIL}
        </p>
      </div>
    </MockupFrame>
  );
}
