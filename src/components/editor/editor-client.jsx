"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { History, Share2, Trash2, WifiOff } from "lucide-react";
import { AppHeader, api } from "@/components/app-header";
import { EditorLoadingSkeleton } from "@/components/global-loading";
import { CollabEditor } from "@/components/editor/collab-editor";
import { PresenceBar } from "@/components/editor/presence-bar";
import { CursorLegend } from "@/components/editor/cursor-legend";
import { ShareDialog } from "@/components/documents/share-dialog";
import { VersionHistory } from "@/components/documents/version-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { OPEN_FAILURE, classifyOpenFailure } from "@/lib/open-failure";
import { offlineDbName } from "@/lib/offline-docs";
// The wire contract lives outside src/ so the sync service can import the same
// file; the close codes below are its values, not copies of them.
import { WS_CLOSE_CODES } from "../../../shared/protocol.js";

const SYNC_WS_URL = process.env.NEXT_PUBLIC_SYNC_WS_URL ?? "ws://localhost:1234";

/**
 * Wait before retrying a connection the service throttled. The limiter's
 * window is a minute, so this is a first step rather than a guarantee — a
 * still-throttled retry is simply throttled again.
 */
const THROTTLE_RETRY_MS = 5_000;

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
  // The whole error (not just its message): the status decides whether this is
  // a missing document or a genuine failure.
  const [openError, setOpenError] = useState(null);
  const [terminalError, setTerminalError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [connState, setConnState] = useState("connecting");
  // Browser-level network state (navigator.onLine). Tracked separately from
  // connState: offline is a *local* condition — editing continues and local
  // changes are cached — while connState describes the socket to the sync
  // service. Both are shown so "you're offline" and "reconnecting" don't
  // blur into one ambiguous badge.
  // null = no browser event seen yet (resolved against navigator.onLine at
  // render time); true/false = last event received.
  const [isOffline, setIsOffline] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  // True when the document opened from the IndexedDB cache because the API
  // was unreachable — the editor then shows the last synced content in a
  // degraded (offline) mode instead of an error page.
  const [openedOffline, setOpenedOffline] = useState(false);
  const idbRef = useRef(null);
  const [peers, setPeers] = useState([]);
  const [selfUser, setSelfUser] = useState(null);
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

  // Browser online/offline transitions. Poll-free: the events fire on real
  // changes in every modern browser. The initial state is derived lazily in
  // the badge (navigator.onLine is meaningless during SSR anyway); the
  // listeners only record *changes*.
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Local (offline) persistence: the ydoc mirrors into IndexedDB under a
  // per-viewer key, so a reload with no network restores the last known
  // content instantly and edits made offline merge into the server copy on
  // reconnect (Yjs syncs the delta, not the whole doc). Guest sessions cache
  // under the signed share token instead of an account id.
  const offlineKey = useMemo(
    () => offlineDbName(documentId, { userId: user?.id ?? null, shareToken }),
    [documentId, user?.id, shareToken]
  );
  useEffect(() => {
    // No identity (not signed in, no share token): caching nothing is the
    // correct, secure fallback — see offline-docs.js.
    if (!offlineKey) return undefined;
    let disposed = false;
    const idb = new IndexeddbPersistence(offlineKey, ydoc);
    idbRef.current = idb;
    idb.on("synced", () => {
      if (!disposed) setOfflineReady(true);
    });
    return () => {
      disposed = true;
      setOfflineReady(false);
      idbRef.current = null;
      // destroy() finalizes the write-through; not awaiting is fine here —
      // destroy flushes pending state before closing the connection.
      idb.destroy();
    };
  }, [offlineKey, ydoc]);

  useEffect(() => {
    let cancelled = false;
    api(`/api/documents/${documentId}${qs}`)
      .then((data) => {
        if (cancelled) return;
        setDoc(data.document);
        setTitle(data.document.title ?? "");
      })
      .catch((err) => {
        if (cancelled) return;
        // A transport failure with no HTTP status (offline, DNS, refused
        // connection) is not "the document is gone" — classifyOpenFailure
        // already fails that case towards the error page, but throwing an
        // error here would kill the offline-editing promise: the editor
        // unmounts and the IndexedDB cache never gets a chance to open the
        // doc. If we have a local cache, open the degraded offline copy
        // instead; sync and metadata refresh when connectivity returns.
        if (err.status === undefined && offlineKey) {
          setOpenedOffline(true);
          setDoc({ id: documentId, role: null, offline: true });
          return;
        }
        setOpenError(err);
      });
    return () => { cancelled = true; };
  }, [documentId, qs, offlineKey]);

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
      } else if (mode === "backoff") {
        // `finish` re-checks the generation, so a terminal close during the
        // wait still wins over this pending retry.
        setTimeout(() => finish(null), THROTTLE_RETRY_MS);
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
        user?.fullName ?? user?.username ?? (isSignedIn ? null : "Guest");
      // A signed-in user whose profile hasn't hydrated yet has no name —
      // send NO user field at all rather than a placeholder, so peers see a
      // pending cursor (client id) instead of everyone being called "You".
      const userColor = colorFor(user?.id ?? doc?.id);
      wsProvider.awareness.setLocalStateField("user",
        displayName ? { name: displayName, color: userColor } : { color: userColor }
      );
      setSelfUser({ name: displayName ?? "You", color: userColor });

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
      //   TOKEN_EXPIRED → refresh the token and reconnect
      //   RATE_LIMITED  → wait out the throttle window and reconnect
      //   INVALID_TOKEN / NO_ACCESS / NOT_FOUND → stop and explain
      // (y-websocket's own loop already treats 4400-4499 as non-reconnectable,
      // so anything retryable has to be retried here.)
      const onClosed = ({ code }) => {
        if (disposedRef.current) return;
        if (code === WS_CLOSE_CODES.TOKEN_EXPIRED) {
          scheduleReconnect("refresh");
          return;
        }
        // Throttled rather than rejected: retry instead of stranding the user
        // on an error until they think to reload the page. 44xx is
        // non-reconnectable as far as y-websocket is concerned, so this branch
        // is the only thing that keeps a busy collaborator from being locked
        // out permanently.
        if (code === WS_CLOSE_CODES.RATE_LIMITED) {
          setTerminalError("Too many connection attempts — reconnecting in a few seconds…");
          scheduleReconnect("backoff");
          return;
        }
        // Cancel any reconnect the 'disconnected' status started, then stop.
        cancelPendingReconnect();
        wsProvider.destroy();
        if (providerRef.current === wsProvider) providerRef.current = null;
        setProvider(null);
        setConnState("disconnected");
        setTerminalError(
          code === WS_CLOSE_CODES.NO_ACCESS
            ? "You no longer have access to this document."
            : code === WS_CLOSE_CODES.NOT_FOUND
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

  if (openError) {
    const failure = classifyOpenFailure({ isSignedIn, status: openError.status });

    // A signed-out visitor hitting an invite link sees the same 404 as a
    // truly unauthorized user — the API is deliberately fail-closed. The
    // client knows its own auth state, so offer sign-in instead of a dead end.
    if (failure === OPEN_FAILURE.SIGN_IN) {
      return (
        // w-full: this renders inside documents/layout.js's horizontal flex
        // row — without it the root shrinks to content width and everything
        // pins to the left edge of the page.
        <div className="flex min-h-screen w-full flex-col">
          <AppHeader backHref="/documents" />
          <main className="flex flex-1 items-center justify-center text-center">
            <div>
              <p className="text-lg font-medium">Can&apos;t open this document</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to open this document.
              </p>
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
            </div>
          </main>
        </div>
      );
    }

    // Signed in and the API said 404: the document is gone, or it was never
    // shared with this user — and the API deliberately does not say which, so
    // neither does the page. That is a not-found rather than a failure, so it
    // renders the 404 page instead of printing the API's message at the user,
    // and it stays out of error reporting.
    if (failure === OPEN_FAILURE.NOT_FOUND) notFound();

    // Everything else is a genuine failure. Throwing during render hands it to
    // the route error boundary (app/error.js), which shows the branded error
    // page with a digest and reports it through lib/error-reporting.
    throw openError;
  }

  if (terminalError) {
    return (
      <div className="flex min-h-screen w-full flex-col">
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
    // Full-page editor-shaped skeleton, not a bare "Loading…": it fills the
    // layout row (w-full inside) and shows the page's real silhouette.
    return <EditorLoadingSkeleton />;
  }

  const role = doc.role;
  // An offline-opened document has no authoritative role yet — the API never
  // answered. Fall back to EDITOR so the local cache stays editable (the role
  // is enforced server-side anyway; offline edits merge subject to the real
  // permission when the connection returns).
  const effectiveRole = role ?? (doc.offline ? "EDITOR" : null);
  const canEditContent = effectiveRole === "OWNER" || effectiveRole === "EDITOR";

  const actions = (
    <>
      <ConnBadge state={connState} offline={isOffline === true || openedOffline} offlineReady={offlineReady} />
      <PresenceBar peers={peers} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowVersions((v) => !v)}
      >
        <History className="h-4 w-4" />
        History
      </Button>
      {effectiveRole === "OWNER" ? (
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
            role={effectiveRole}
          />
        </main>

        <CursorLegend self={selfUser} peers={peers} />

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

function ConnBadge({ state, offline, offlineReady }) {
  // `offline` is tri-state until the first browser event: null means "no
  // offline/online event seen yet", resolved against navigator.onLine at
  // render time (client-only component; SSR never reaches here because the
  // editor renders after the document fetch).
  const isOffline = offline === null ? typeof navigator !== "undefined" && !navigator.onLine : offline;
  // Browser-level offline wins: while offline, socket state is irrelevant —
  // the user can still edit and local changes are cached in IndexedDB.
  if (isOffline) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600 dark:text-amber-400"
        title={
          offlineReady
            ? "You're offline. Editing still works — changes will sync when you reconnect."
            : "You're offline. Changes can't be cached locally yet — they'll sync if you keep this tab open until reconnection."
        }
      >
        <WifiOff className="h-3.5 w-3.5" />
        Offline — edits saved locally
      </span>
    );
  }
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
