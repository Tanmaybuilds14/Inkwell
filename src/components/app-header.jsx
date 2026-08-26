"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export function AppHeader({ title = "Inkwell", actions = null, backHref = null }) {
  const { userId } = useAuth();
  return (
    <header
      className="flex h-14 w-full items-center justify-between border-b px-4"
      style={{ borderColor: "var(--inkwell-line)", background: "var(--inkwell-paper)" }}
    >
      <div className="flex items-center gap-3">
        {backHref ? (
          <Link href={backHref} className="text-sm" style={{ color: "var(--inkwell-muted)" }}>
            ← Back
          </Link>
        ) : null}
        <Link href="/documents" className="font-semibold tracking-tight">
          {title}
        </Link>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
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
