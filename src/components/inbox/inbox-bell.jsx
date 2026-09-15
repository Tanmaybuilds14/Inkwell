"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000; // gentle polling; inbox is not realtime-critical

/**
 * Header bell linking to /inbox with an unread badge. Polls the unread
 * count on a slow interval and refreshes on window focus — cheap, and
 * good enough until a realtime channel is warranted.
 */
export function InboxBell() {
  const { isSignedIn } = useUser();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    fetch("/api/inbox?limit=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.unread === "number") {
          setUnread(data.unread);
        }
      })
      .catch(() => {}); // offline / signed out — badge just stays stale
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    const stop = refresh();

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Opening an item updates its readAt elsewhere; re-poll when returning.
    window.addEventListener("inkwell:inbox-updated", refresh);

    return () => {
      stop?.();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("inkwell:inbox-updated", refresh);
    };
  }, [isSignedIn, refresh]);

  if (!isSignedIn) return null;

  return (
    <Button variant="ghost" size="icon" className="relative text-muted-foreground" asChild>
      <Link href="/inbox" aria-label={`Inbox${unread > 0 ? ` (${unread} unread)` : ""}`}>
        <Bell className="h-[1.2rem] w-[1.2rem]" />
        {unread > 0 ? (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full",
              "bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground"
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
        <span className="sr-only">Open inbox</span>
      </Link>
    </Button>
  );
}
