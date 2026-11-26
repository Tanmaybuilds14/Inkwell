"use client";

import { cn } from "@/lib/utils";

export function CursorLegend({ self, peers }) {
  const editors = [];
  if (self) {
    editors.push({ ...self, isSelf: true });
  }
  for (const peer of peers) {
    editors.push({ ...peer, isSelf: false });
  }

  if (editors.length < 2) return null;

  return (
    <div className="hidden w-48 shrink-0 border-l border-border bg-card/30 p-4 xl:block">
      <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Editors
      </span>
      <ul className="flex flex-col gap-1.5">
        {editors.map((editor, i) => (
          <li key={`${editor.name}-${i}`} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: editor.color }}
            />
            <span
              className={cn(
                "truncate",
                editor.isSelf
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {editor.name ?? "Anonymous"}
              {editor.isSelf ? " (you)" : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
