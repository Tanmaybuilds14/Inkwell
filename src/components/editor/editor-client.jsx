"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Share2, Trash2 } from "lucide-react";
import { AppHeader, api } from "@/components/app-header";
import { CollabEditor } from "@/components/editor/collab-editor";
import { PresenceBar } from "@/components/editor/presence-bar";
import { ShareDialog } from "@/components/documents/share-dialog";
import { VersionHistory } from "@/components/documents/version-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const SYNC_WS_URL = process.env.NEXT_PUBLIC_SYNC_WS_URL ?? "ws://localhost:1234";

const PRESENCE_COLORS = [
  "#0ea5e9", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#ef4444", "#6366f1", "#14b8a6",
];

function colorFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

export function EditorClient({ documentId }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share");
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const { toast } = useToast();

  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [terminalError, setTerminalError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [connState, setConnState] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [title, setTitle] = useState("");
  const titleTimer = useRef(null);

  const ydoc = useMemo(() => new Y.Doc(), []);
  const providerRef = useRef(null);
  // Guard against mounting cleanup racing with a reconnect attempt.
  const disposedRef = useRef(false);
  const connectRef = useRef(null);
  // Single-flight reconnect: reconnectingRef blocks parallel attempts, and
  // reconnectGenRef lets a terminal close cancel one that is in flight.
  const reconnectingRef = useRef(false);
  const reconnectGenRef = useRef(0);

  const qs = useMemo(
    () => (shareToken ? `?share=${encodeURIComponent(shareToken)}` : ""),
    [shareToken]
  );

  useEffect(() => {
    let cancelled = false;
    api(`/api/documents/${documentId}${qs}`)
      .then((data) => {
        if (cancelled) return;
        setDoc(data.document);
        setTitle(data.document.title ?? "");
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, [documentId, qs]);

  /**
   * The single reconnect path. mode 'refresh' re-fetches the Clerk token
   * first (Clerk JWTs are short-lived (~60s), so always re-fetch rather than
   * reuse the old URL). A generation counter lets a terminal close (44xx)
   * cancel a reconnect that a transient 'disconnected' status already started.
   */
  const scheduleReconnect = useCallback(
    (mode) => {
      if (disposedRef.current || reconnectingRef.current) return;
      reconnectingRef.current = true;
      const gen = reconnectGenRef.current;
      // Destroy the current provider to stop y-websocket's own reconnect
      // loop (it would reuse the stale URL indefinitely).
      providerRef.current?.destroy();
      providerRef.current = null;
      setProvider(null);
      const finish = (token) => {
        reconnectingRef.current = false;
        if (disposedRef.current || reconnectGenRef.current !== gen) return;
        connectRef.current?.(token);
      };
      if (mode === "refresh") {
        getToken()
          .then(finish)
          .catch(() => finish(null));
      } else {
        finish(null);
      }
    },
    [getToken]
  );

  const cancelPendingReconnect = useCallback(() => {
    reconnectGenRef.current += 1;
    reconnectingRef.current = false;
  }, []);

  /**
   * Create (or recreate) a WebsocketProvider for the given token.
   * The same `ydoc` instance is reused — Yjs handles reconciliation via
   * its normal sync-step handshake automatically.
   */
  const connect = useCallback(
    async (token) => {
      // Tear down any existing provider first.
      providerRef.current?.destroy();
      providerRef.current = null;
      setProvider(null);
      setTerminalError(null);

      let room = `ws?docId=${encodeURIComponent(doc?.id)}`;
      if (token) room += `&token=${encodeURIComponent(token)}`;
      else if (shareToken) room += `&share=${encodeURIComponent(shareToken)}`;

      const wsProvider = new WebsocketProvider(SYNC_WS_URL, room, ydoc, {
        disableBc: true,
      });
      providerRef.current = wsProvider;
      setProvider(wsProvider);

      const displayName =
        user?.fullName ?? user?.username ?? (isSignedIn ? "You" : "Guest");
      wsProvider.awareness.setLocalStateField("user", {
        name: displayName,
        color: colorFor(user?.id ?? doc?.id),
      });

      wsProvider.on("status", ({ status }) => {
        setConnState(
          status === "connected"
            ? "connected"
            : status === "disconnected"
              ? "disconnected"
              : "connecting"
        );
      });

      // Transient drops (network blips, server restart): refresh the token
      // and reconnect. Permanent rejections are handled by 'closed' below.
      const onStatus = ({ status }) => {
        if (status === "disconnected" && !disposedRef.current) {
          scheduleReconnect("refresh");
        }
      };
      wsProvider.on("status", onStatus);

      // Close codes 4400-4499 are the sync service's terminal verdict: it
      // completes the upgrade handshake and immediately closes with one of
      //   4400 — token expired  → refresh the token and reconnect
      //   4401 — invalid token  → stop
      //   4403 — no access      → stop
      //   4404 — doc not found  → stop
      // (y-websocket's own loop already treats 4400-4499 as non-reconnectable.)
      const onClosed = ({ code }) => {
        if (disposedRef.current) return;
        if (code === 4400) {
          scheduleReconnect("refresh");
          return;
        }
        // Cancel any reconnect the 'disconnected' status started, then stop.
        cancelPendingReconnect();
        wsProvider.destroy();
        if (providerRef.current === wsProvider) providerRef.current = null;
        setProvider(null);
        setConnState("disconnected");
        setTerminalError(
          code === 4403
            ? "You no longer have access to this document."
            : code === 4404
              ? "This document no longer exists."
              : "Your session could not be authenticated. Refresh the page to sign in again."
        );
      };
      wsProvider.on("closed", onClosed);

      const onAwarenessChange = () => {
        const list = [];
        for (const [clientId, state] of wsProvider.awareness.getStates()) {
          if (clientId !== wsProvider.awareness.clientID && state.user) {
            list.push(state.user);
          }
        }
        setPeers(list);
      };
      wsProvider.awareness.on("change", onAwarenessChange);
      onAwarenessChange();

      return () => {
        wsProvider.off("status", onStatus);
        wsProvider.off("closed", onClosed);
        wsProvider.awareness.off("change", onAwarenessChange);
      };
    },
    [doc?.id, shareToken, ydoc, user, isSignedIn, scheduleReconnect, cancelPendingReconnect]
  );

  // Keep the latest connect() reachable from reconnect handlers without
  // touching refs during render.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // A pending debounced title save must not fire after unmount.
  useEffect(() => () => clearTimeout(titleTimer.current), []);

  const docId = doc?.id ?? null;
  useEffect(() => {
    if (!docId) return undefined;

    disposedRef.current = false;
    let cleanupStatus;

    (async () => {
      let token = null;
      try {
        token = await getToken();
      } catch {
        /* guest flow */
      }
      if (disposedRef.current) return;

      cleanupStatus = await connect(token);
    })();

    return () => {
      disposedRef.current = true;
      cleanupStatus?.();
      providerRef.current?.destroy();
      providerRef.current = null;
      setProvider(null);
    };
  }, [docId, getToken, connect]);

  useEffect(
    () => () => {
      ydoc.destroy();
    },
    [ydoc]
  );

  const onTitleChange = useCallback(
    (value) => {
      setTitle(value);
      clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        api(`/api/documents/${documentId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: value }),
        }).catch(() => {});
      }, 600);
    },
    [documentId]
  );

  async function deleteDoc() {
    if (!confirm("Move this document to trash?")) return;
    await api(`/api/documents/${documentId}`, { method: "DELETE" });
    router.push("/documents");
  }

  if (error) {
    // A signed-out visitor hitting an invite link sees the same 404 as a
    // truly unauthorized user — the API is deliberately fail-closed. The
    // client knows its own auth state, so offer sign-in instead of a dead end.
    const signedOut = !isSignedIn;
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-lg font-medium">Can&apos;t open this document</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {signedOut ? "Sign in to open this document." : error}
            </p>
            {signedOut ? (
              <SignInButton
                mode="modal"
                forceRedirectUrl={
                  typeof window !== "undefined"
                    ? window.location.pathname + window.location.search
                    : "/documents"
                }
              >
                <Button className="mt-4">Sign in to continue</Button>
              </SignInButton>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  if (terminalError) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-lg font-medium">Session ended</p>
            <p className="mt-2 text-sm text-muted-foreground">{terminalError}</p>
            <Button className="mt-4" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </main>
      </div>
    );
  }

  const role = doc.role;
  const canEditContent = role === "OWNER" || role === "EDITOR";

  const actions = (
    <>
      <ConnBadge state={connState} />
      <PresenceBar peers={peers} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowVersions((v) => !v)}
      >
        <History className="h-4 w-4" />
        History
      </Button>
      {role === "OWNER" ? (
        <>
          <Button size="sm" onClick={() => setShowShare(true)}>
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={deleteDoc}
            title="Move to trash"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader backHref="/documents" actions={actions} title="" showThemeToggle={false} />
      <div className="border-b border-border bg-card px-8 py-3">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={!canEditContent}
          placeholder="Untitled"
          className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex w-full flex-1">
        <main className="mx-auto w-full max-w-4xl px-6 py-10">
          <CollabEditor
            documentId={doc.id}
            ydoc={ydoc}
            provider={provider}
            role={role}
          />
        </main>

        {showVersions ? (
          <VersionHistory
            documentId={doc.id}
            qs={qs}
            onClose={() => setShowVersions(false)}
            onRestored={() => {
              // The hot-swap via Redis updates all connected clients without
              // a reload. Show a brief confirmation to the actor.
              toast({ title: "Version restored", variant: "success" });
            }}
          />
        ) : null}
      </div>

      <ShareDialog
        documentId={doc.id}
        open={showShare}
        onOpenChange={setShowShare}
      />
    </div>
  );
}

function ConnBadge({ state }) {
  const map = {
    connected: { label: "Live", color: "bg-emerald-500" },
    connecting: { label: "Connecting…", color: "bg-amber-500" },
    disconnected: { label: "Reconnecting…", color: "bg-rose-500" },
  };
  const s = map[state] ?? map.connecting;
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
      <span className={cn("h-2 w-2 rounded-full", s.color)} />
      {s.label}
    </span>
  );
}
