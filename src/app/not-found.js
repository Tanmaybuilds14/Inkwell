import Link from "next/link";
import { Feather } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

/**
 * Global 404 (app/not-found.js convention). Rendered inside the root layout,
 * so global styles and the theme apply automatically.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
        <Feather className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        404
      </p>
      <h1 className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">
        This page has no ink
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist, was moved, or was
        deleted forever.
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
