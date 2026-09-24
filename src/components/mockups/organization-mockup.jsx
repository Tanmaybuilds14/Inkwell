"use client";

import { FileText, Folder, FolderOpen, Search, Trash2 } from "lucide-react";
import { MockupFrame } from "@/components/mockups/mockup-frame";
import {
  useMockupSteps,
  useOnScreen,
} from "@/components/mockups/use-mockup-animation";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

/** in Specs → dropped into Marketing (highlighted) → settled, then loop. */
const STEP_COUNT = 3;

function TreeRow({
  icon: Icon,
  label,
  depth = 0,
  muted = false,
  highlight = false,
  entering = false,
}) {
  return (
    <li
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={cn(
        "flex items-center gap-2 rounded-md py-1.5 pr-2 text-xs",
        muted ? "text-muted-foreground" : "text-foreground",
        // The destination folder tints in the document's collab colour for a beat.
        highlight && "collab-3 collab-highlight",
        entering && "mockup-fade-in"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </li>
  );
}

export function OrganizationMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen({ threshold: 0.3 });
  const step = useMockupSteps({
    playing: onScreen,
    reducedMotion,
    length: STEP_COUNT,
    intervalMs: 1500,
    holdMs: 1800,
    finalStep: 2,
  });

  const moved = step >= 1;
  const justMoved = step === 1;

  return (
    <MockupFrame observeRef={ref} padding="p-3 sm:p-4">
      <div className="mockup-hairline flex items-center gap-2 rounded-lg px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Search documents</span>
      </div>

      <ul className="mt-3 flex-1 space-y-0.5">
        <TreeRow icon={FolderOpen} label="Product" depth={0} />
        <TreeRow icon={FolderOpen} label="Specs" depth={1} />
        {!moved && (
          <TreeRow icon={FileText} label="Q3 roadmap" depth={2} entering />
        )}
        <TreeRow icon={Folder} label="Marketing" depth={1} />
        {moved && (
          <TreeRow
            icon={FileText}
            label="Q3 roadmap"
            depth={2}
            highlight={justMoved}
            entering={justMoved}
          />
        )}
      </ul>

      {/* Trash lives at the bottom of the rail, the way it does in the app. */}
      <ul className="mockup-rule mt-3 pt-2">
        <TreeRow icon={Trash2} label="Trash" depth={0} muted />
      </ul>
    </MockupFrame>
  );
}
