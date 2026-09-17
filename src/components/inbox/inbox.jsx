"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  FileText,
  Link2,
  Mail,
  CheckCheck,
  Check,
  Trash2,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { AppHeader, api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

const TYPE_META = {
  invite: { icon: Mail, label: "Invitation" },
  link_shared: { icon: Link2, label: "Link shared" },
  link_opened: { icon: FileText, label: "Opened by link" },
};

/** Role label shown on invite items; meta.role is optional. */
function roleLabel(meta) {
  const role = meta?.role;
  if (!role || role === "OWNER") return null;
  return role.toLowerCase();
}

export function Inbox() {
  const { toast } = useToast();
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);

  const load = useCallback((cursor) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    return api(`/api/inbox?${params}`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setUnread(data.unread);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await load(nextCursor);
      setItems((prev) => [...(prev ?? []), ...data.items]);
      setUnread(data.unread);
      setNextCursor(data.nextCursor);
    } catch (err) {
      toast({ title: "Couldn't load more", description: err.message, variant: "destructive" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(ids) {
    try {
      await api("/api/inbox", { method: "PATCH", body: JSON.stringify({ ids }) });
      setItems((list) =>
        (list ?? []).map((it) => (ids.includes(it.id) ? { ...it, readAt: new Date().toISOString() } : it))
      );
      setUnread((u) => Math.max(0, u - ids.filter((id) => items?.some((it) => it.id === id && !it.readAt)).length));
      window.dispatchEvent(new Event("inkwell:inbox-updated"));
    } catch (err) {
      toast({ title: "Couldn't update", description: err.message, variant: "destructive" });
    }
  }

  async function markAllRead() {
    try {
      await api("/api/inbox", { method: "PATCH", body: JSON.stringify({ all: true }) });
      setItems((list) => (list ?? []).map((it) => ({ ...it, readAt: it.readAt ?? new Date().toISOString() })));
      setUnread(0);
      window.dispatchEvent(new Event("inkwell:inbox-updated"));
    } catch (err) {
      toast({ title: "Couldn't update", description: err.message, variant: "destructive" });
    }
  }

  async function remove(id) {
    // Optimistic removal; rollback on failure.
    const previous = items;
    setItems((list) => (list ?? []).filter((it) => it.id !== id));
    try {
      await api("/api/inbox", { method: "DELETE", body: JSON.stringify({ ids: [id] }) });
    } catch (err) {
      setItems(previous);
      toast({ title: "Couldn't delete", description: err.message, variant: "destructive" });
    }
  }

  async function accept(id) {
    setAcceptingId(id);
    try {
      const data = await api("/api/inbox/accept", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setItems((list) =>
        (list ?? []).map((it) =>
          it.id === id
            ? { ...it, meta: data.item.meta, readAt: data.item.readAt ?? it.readAt }
            : it
        )
      );
      setUnread((u) => Math.max(0, u - 1));
      toast({ title: "Invitation accepted", description: "The document is now in your documents.", variant: "success" });
      window.dispatchEvent(new Event("inkwell:inbox-updated"));
    } catch (err) {
      toast({ title: "Couldn't accept", description: err.message, variant: "destructive" });
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader backHref="/documents" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Inbox</h1>
            {unread > 0 ? (
              <Badge variant="default" className="ml-1">
                {unread} new
              </Badge>
            ) : null}
          </div>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : items === null ? (
          <div className="divide-y divide-border" aria-hidden="true">
            {ITEM_SKELETON_WIDTHS.map((width, i) => (
              <div key={i} className="flex items-center gap-3 py-3.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className={cn("h-4", width)} />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <Bell className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No notifications yet. Invitations and shared documents land here.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  accepting={acceptingId === item.id}
                  onAccept={() => accept(item.id)}
                  onOpen={() => markRead([item.id])}
                  onRemove={() => remove(item.id)}
                />
              ))}
            </ul>
            {nextCursor ? (
              <div className="border-t border-border p-3 text-center">
                <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Load more
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function InboxRow({ item, accepting, onAccept, onOpen, onRemove }) {
  const meta = TYPE_META[item.type] ?? TYPE_META.link_opened;
  const Icon = meta.icon;
  const inviterName = item.inviter?.name ?? item.inviter?.email ?? null;
  const role = roleLabel(item.meta);
  const when = new Date(item.createdAt);
  const unread = !item.readAt;
  const accepted = !!item.meta?.acceptedAt;
  const acceptable =
    (item.type === "invite" || item.type === "link_opened") && item.documentId;

  const title =
    item.type === "invite"
      ? inviterName
        ? `${inviterName} invited you to collaborate`
        : "You've been invited to collaborate"
      : item.type === "link_shared"
        ? inviterName
          ? `${inviterName} shared a link to a document`
          : "A document link is being shared"
        : "Opened via shared link";

  const href = item.documentId ? `/documents/${item.documentId}` : null;

  return (
    <li
      className={cn(
        "group flex items-center gap-3 py-3 transition-colors",
        unread ? "bg-primary/[0.03]" : ""
      )}
    >
      <span
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          unread ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", unread ? "font-medium" : "text-foreground/80")}>
          {title}
          {role ? <span className="text-muted-foreground"> as {role}</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {meta.label} · {item.docTitle || "Untitled"}
        </p>
      </div>

      <time
        dateTime={when.toISOString()}
        title={when.toLocaleString()}
        className="shrink-0 text-xs text-muted-foreground"
      >
        {when.toLocaleDateString()}
      </time>

      <div className="flex shrink-0 items-center gap-1">
        {acceptable && !accepted ? (
          <Button size="sm" onClick={onAccept} disabled={accepting}>
            {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Accept
          </Button>
        ) : null}
        {accepted ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            Accepted
          </span>
        ) : null}
        {href ? (
          <Button variant="outline" size="sm" asChild onClick={onOpen}>
            <Link href={href}>Open</Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={onRemove}
          title="Remove notification"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

const ITEM_SKELETON_WIDTHS = ["w-48", "w-64", "w-56", "w-64", "w-48"];
