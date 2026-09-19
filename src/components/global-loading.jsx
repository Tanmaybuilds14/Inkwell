"use client";

import { Feather } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Branded full-screen loading state — the pulsing feather.
 * Used by root loading.js (covers the landing page) and as the fallback
 * for segments without their own skeleton shape.
 */
export function GlobalLoading() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-background">
      <Feather
        className="h-8 w-8 animate-pulse text-muted-foreground/60"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      <span className="sr-only" role="status">
        Loading
      </span>
    </main>
  );
}

/**
 * Skeleton shaped like the app pages: a content-area skeleton mirroring the
 * dashboard/trash/profile list layout, so navigation feels instant instead
 * of flashing a spinner. Renders NO header — routes under documents/ get one
 * from documents/layout.js; trash and profile render their own in their
 * loading.js (their pages do the same).
 * (The editor route has its own shape — see EditorLoadingSkeleton.)
 */
export function GlobalLoadingSkeleton() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-6">
        {/* Page title row */}
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="ml-auto h-9 w-[120px] rounded-lg" />
        </div>
        {/* Content rows */}
        <div className="divide-y divide-border" aria-hidden="true">
          {ROW_WIDTHS.map((width, i) => (
            <div key={i} className="flex items-center gap-3 py-3.5">
              <Skeleton className="h-4 w-4" />
              <Skeleton className={width} />
              <Skeleton className="ml-auto h-3 w-32" />
              <Skeleton className="h-9 w-[120px] rounded-lg" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * Skeleton shaped like the editor page: the title-bar strip and the content
 * column with a centered brand mark — so opening a document shows the page's
 * real silhouette instead of a bare word pinned to the left.
 *
 * Renders NO header of its own: everything under /documents gets the header
 * from documents/layout.js, and adding another stacked a second bar on top.
 *
 * Used by the editor's own document-fetch state and by
 * app/documents/[id]/loading.js (the route boundary while the editor chunk
 * loads).
 */
export function EditorLoadingSkeleton() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {/* Title bar — same strip the real editor renders under the header */}
      <div className="border-b border-border bg-card px-8 py-3">
        <Skeleton className="h-7 w-56 max-w-full" />
      </div>
      <main className="flex w-full flex-1 items-center justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center px-6 py-10 text-center">
          <Feather
            className="h-8 w-8 animate-pulse text-muted-foreground/60"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="mt-4 text-sm text-muted-foreground">Loading document…</p>
          {/* A few paragraph ghosts hint at the content that will land here */}
          <div className="mt-8 w-full space-y-3" aria-hidden="true">
            <Skeleton className="mx-auto h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mx-auto h-4 w-5/6" />
          </div>
          <span className="sr-only" role="status">
            Loading document
          </span>
        </div>
      </main>
    </div>
  );
}

const ROW_WIDTHS = [
  "h-4 w-2/3",
  "h-4 w-2/5",
  "h-4 w-1/2",
  "h-4 w-2/3",
  "h-4 w-2/5",
  "h-4 w-1/2",
];
