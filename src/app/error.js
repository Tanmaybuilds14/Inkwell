"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Feather } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-reporting";

/**
 * Route-segment error boundary (app/error.js convention).
 * Catches runtime errors in pages/layouts below the root layout and shows
 * branded fallback UI. The root layout (header, providers) stays mounted,
 * so navigation and the theme remain functional.
 *
 * Next.js serializes server errors with a generic message + digest in
 * production; the digest is shown so users can correlate with server logs.
 */
export default function Error({ error, retry }) {
  useEffect(() => {
    // Console always; Sentry when a DSN is configured (see lib/error-reporting).
    reportError(error, { scope: "route-error" });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
        <Feather className="h-6 w-6 text-destructive" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2 className="mt-6 text-2xl font-light tracking-tight sm:text-3xl">
        Something went wrong
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        An unexpected error occurred while loading this page. It may be
        temporary — try again, or head back to your documents.
      </p>
      {error?.digest ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground/70">
          Error ID: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/documents">Back to documents</Link>
        </Button>
      </div>
    </main>
  );
}
