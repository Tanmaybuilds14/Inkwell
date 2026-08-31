"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Feather } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function AppHeader({ title = "Inkwell", actions = null, backHref = null }) {
  return (
    <header
      className="flex h-14 w-full items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4"
    >
      <div className="flex items-center gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back
          </Link>
        ) : null}
        <Link href="/documents" className="flex items-center gap-2 font-semibold tracking-tight">
          <Feather className="h-4 w-4 text-primary" />
          {title}
        </Link>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <ThemeToggle />
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
    throw new Error(body.error ?? `Request failed (${res.status})`);
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
