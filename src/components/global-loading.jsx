"use client";

import { Feather } from "lucide-react";
import { AppHeader } from "@/components/app-header";
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
 * Skeleton shaped like the app pages: the real AppHeader on top plus a
 * content-area skeleton, so navigation feels instant instead of flashing
 * a spinner. Used by documents/trash/profile route loading.js files.
 */
export function GlobalLoadingSkeleton({ backHref = "/documents" }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader backHref={backHref} />
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

const ROW_WIDTHS = [
  "h-4 w-2/3",
  "h-4 w-2/5",
  "h-4 w-1/2",
  "h-4 w-2/3",
  "h-4 w-2/5",
  "h-4 w-1/2",
];
