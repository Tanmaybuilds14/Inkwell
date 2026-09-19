"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Feather } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileButton } from "@/components/profile-button";
import { InboxBell } from "@/components/inbox/inbox-bell";
import { cn } from "@/lib/utils";

/**
 * `leftSlot` reserves header space on the left (e.g. the documents page's
 * mobile hamburger trigger sits fixed at top-left and would otherwise
 * overlap the feather + wordmark).
 */
export function AppHeader({ title = "Inkwell", actions = null, backHref = null, showThemeToggle = true, leftSlot = null }) {
  return (
    <header className="flex h-14 w-full items-center justify-between border-b border-border bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        {leftSlot ? <div className="w-10 md:hidden" aria-hidden="true" /> : null}
        {backHref ? (
          <Link
            href={backHref}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back
          </Link>
        ) : null}
        <Link href="/documents" className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <Feather className="h-4 w-4" strokeWidth={1.5} />
          {title}
        </Link>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showThemeToggle ? <InboxBell /> : null}
        {showThemeToggle ? <ProfileButton /> : null}
        {showThemeToggle ? <ThemeToggle /> : null}
      </div>
    </header>
  );
}

/** Small helper for fetch + JSON with consistent error surfacing. */
export async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The status travels with the error because callers have to branch on it:
    // a 404 means "gone, or not shared with you" (render a 404 page), while
    // anything else is a real failure (render the error page). Matching on the
    // message string instead would break the moment the API's wording changes.
    const error = new Error(body.error ?? `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return body;
}

export function useDebouncedCallback(fn, delay) {
  const [timer, setTimer] = useState(null);
  useEffect(() => () => timer && clearTimeout(timer), [timer]);
  return (...args) => {
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => fn(...args), delay));
  };
}
