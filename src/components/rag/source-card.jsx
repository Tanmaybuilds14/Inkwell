"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

/**
 * One retrieved source. `snippet` is the only text the browser gets for a
 * source until the user opens the document (PLAN §7.6) — the full chunk is
 * never shipped to the client.
 */
export function SourceCard({ source, index }) {
  return (
    <Link
      href={`/documents/${source.documentId}`}
      className="block rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-accent"
    >
      <span className="flex items-center gap-2 text-xs font-medium">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          {index}
        </span>
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{source.title}</span>
      </span>
      {source.headingPath ? (
        <span className="mt-1 block truncate text-xs text-muted-foreground">{source.headingPath}</span>
      ) : null}
      <span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-muted-foreground">
        {source.snippet}
      </span>
    </Link>
  );
}
