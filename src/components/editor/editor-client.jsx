"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader, api } from "@/components/app-header";
import { CollabEditor } from "@/components/editor/collab-editor";
import { PresenceBar } from "@/components/editor/presence-bar";
import { ShareDialog } from "@/components/documents/share-dialog";
import { VersionHistory } from "@/components/documents/version-history";

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

  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [connState, setConnState] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [title, setTitle] = useState("");
  const titleTimer = useRef(null);

  // Stable CRDT document for this session.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const providerRef = useRef(null);

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
    return () => {
      cancelled = true;
    };
  }, [documentId, qs]);

  // WebSocket lifecycle: connect on load, auto-reconnect on disconnect.
  const docId = doc?.id ?? null;
  useEffect(() => {
    if (!docId) return undefined;

    let disposed = false;
    let cancelledAsync = false;

    (async () => {
      let token = null;
      try {
        token = await getToken();
      } catch {
        /* guest flow */
      }
      if (cancelledAsync || disposed) return;

      // y-websocket joins `${serverUrl}/${roomname}`.
      let room = `ws?docId=${encodeURIComponent(docId)}`;
      if (token) room += `&token=${encodeURIComponent(token)}`;
      else if (shareToken) room += `&share=${encodeURIComponent(shareToken)}`;

      const provider = new WebsocketProvider(SYNC_WS_URL, room, ydoc, {
        disableBc: true,
      });
      providerRef.current = provider;

      const displayName =
        user?.fullName ?? user?.username ?? (isSignedIn ? "You" : "Guest");
      provider.awareness.setLocalStateField("user", {
        name: displayName,
        color: colorFor(user?.id ?? docId),
      });

      provider.on("status", ({ status }) => {
        setConnState(
          status === "connected"
            ? "connected"
            : status === "disconnected"
              ? "disconnected"
              : "connecting"
        );
      });

      const onAwarenessChange = () => {
        const list = [];
        for (const [clientId, state] of provider.awareness.getStates()) {
          if (clientId !== provider.awareness.clientID && state.user) {
            list.push(state.user);
          }
        }
        setPeers(list);
      };
      provider.awareness.on("change", onAwarenessChange);
      onAwarenessChange();
    })();

    return () => {
      disposed = true;
      cancelledAsync = true;
      providerRef.current?.destroy();
      providerRef.current = null;
    };
  }, [docId, getToken, shareToken, ydoc, user, isSignedIn]);

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
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-lg font-medium">Can’t open this document</p>
            <p className="mt-2 text-sm" style={{ color: "var(--inkwell-muted)" }}>{error}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main
          className="flex flex-1 items-center justify-center text-sm"
          style={{ color: "var(--inkwell-muted)" }}
        >
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
      <button
        onClick={() => setShowVersions((v) => !v)}
        className="rounded-md border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--inkwell-line)" }}
      >
        History
      </button>
      {role === "OWNER" ? (
        <>
          <button
            onClick={() => setShowShare(true)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--inkwell-accent)" }}
          >
            Share
          </button>
          <button
            onClick={deleteDoc}
            className="text-sm"
            style={{ color: "var(--inkwell-danger)" }}
            title="Move to trash"
          >
            Delete
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader backHref="/documents" actions={actions} title="" />
      <div
        className="border-b px-8 py-3"
        style={{ borderColor: "var(--inkwell-line)", background: "var(--inkwell-paper)" }}
      >
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={!canEditContent}
          placeholder="Untitled"
          className="w-full bg-transparent text-2xl font-semibold outline-none"
        />
      </div>

      <div className="flex w-full flex-1">
        <main className="mx-auto w-full max-w-4xl px-6 py-10">
          <CollabEditor
            documentId={doc.id}
            ydoc={ydoc}
            getProvider={() => providerRef.current}
            role={role}
          />
        </main>

        {showVersions ? (
          <VersionHistory
            documentId={doc.id}
            qs={qs}
            onClose={() => setShowVersions(false)}
            onRestored={() => window.location.reload()}
          />
        ) : null}
      </div>

      {showShare ? (
        <ShareDialog documentId={doc.id} onClose={() => setShowShare(false)} />
      ) : null}
    </div>
  );
}

function ConnBadge({ state }) {
  const map = {
    connected: { label: "Live", color: "#10b981" },
    connecting: { label: "Connecting…", color: "#f59e0b" },
    disconnected: { label: "Reconnecting…", color: "#ef4444" },
  };
  const s = map[state] ?? map.connecting;
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      style={{ borderColor: "var(--inkwell-line)" }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
