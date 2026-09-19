import Link from "next/link";
import { Feather } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Document not found" };

/**
 * 404 for a single document (rendered inside documents/layout.js, so the app
 * header is present). The editor calls notFound() when the API answers 404.
 *
 * The wording matters as much as the layout: the API is fail-closed and answers
 * 404 for "no such document" and "not shared with you" alike, precisely so a
 * stranger cannot probe which documents exist. The copy must keep that
 * ambiguity — "you don't have access" would leak the document's existence.
 * (Signed-out visitors never reach here at all: the editor offers sign-in
 * instead, because an invite link is not a dead end.)
 */
export default function DocumentNotFound() {
  return (
    <main className="flex min-h-[70vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
        <Feather className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        404
      </p>
      <h1 className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">
        This document isn&apos;t available
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        It may have been deleted, or it may not be shared with you. If someone
        sent you a link, ask them to check that it is still active.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Button asChild>
          <Link href="/documents">Back to documents</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
