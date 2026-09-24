"use client";

import { Check, ChevronDown, Copy, Globe, Mail, X } from "lucide-react";
import { CollabAvatar, MockupFrame } from "@/components/mockups/mockup-frame";
import {
  useMockupSteps,
  useOnScreen,
} from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

const PEOPLE = [
  { initials: "AK", name: "Aisha Khan", role: "Editor", index: 1 },
  { initials: "BO", name: "Ben Ortiz", role: "Commenter", index: 3 },
  { initials: "CW", name: "Chen Wu", role: "Viewer", index: 4 },
];

/** idle → link switched on → "Copied" → (hold) → loop. */
const STEP_COUNT = 3;

export function SharingMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.3 });
  const step = useMockupSteps({
    playing: onScreen,
    reducedMotion,
    length: STEP_COUNT,
    intervalMs: 1200,
    holdMs: 1600,
    finalStep: 1,
  });

  const linkOn = reducedMotion || step >= 1;
  const copied = step === 2;

  return (
    <MockupFrame observeRef={ref}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Share “Q3 roadmap”
          </p>
          <p className="text-[11px] text-muted-foreground">
            Invited people get access immediately.
          </p>
        </div>
        <X className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Email invite */}
      <div className="mockup-rule mt-4 flex items-center gap-2 pt-4">
        <div className="mockup-hairline flex h-8 flex-1 items-center gap-2 rounded-lg px-2.5">
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-xs text-muted-foreground">
            teammate@example.com
          </span>
        </div>
        <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
          Invite
        </span>
      </div>

      {/* Who has access */}
      <ul className="mt-3 flex-1 space-y-1">
        {PEOPLE.map((person) => (
          <li key={person.name} className="flex items-center gap-2.5 py-1">
            <CollabAvatar index={person.index} initials={person.initials} />
            <span className="flex-1 truncate text-xs text-foreground">
              {person.name}
            </span>
            <span className="mockup-hairline inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-foreground">
              {person.role}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </span>
          </li>
        ))}
      </ul>

      {/* Public link */}
      <div className="mockup-rule mt-3 flex items-center gap-2 pt-3">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-xs text-foreground">Public link</span>
        <span
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-300",
            linkOn ? "bg-primary" : "bg-input"
          )}
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-background shadow transition-transform duration-300",
              linkOn ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </span>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors duration-300",
            copied
              ? "bg-secondary text-secondary-foreground"
              : "mockup-hairline text-foreground"
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy link
            </>
          )}
        </span>
      </div>
    </MockupFrame>
  );
}
