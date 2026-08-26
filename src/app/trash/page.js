"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Show } from "@clerk/nextjs";
import { AppHeader, api } from "@/components/app-header";

export default function TrashPage() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    return api("/api/trash")
      .then((data) => {
        setDocs(data.documents);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/trash")
      .then((data) => {
        if (!cancelled) {
          setDocs(data.documents);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function restore(doc) {
    await api(`/api/documents/${doc.id}/restore`, { method: "POST" });
    load();
  }

  async function purge(doc) {
    if (!confirm(`Permanently delete "${doc.title}"? This cannot be undone.`)) return;
    await api(`/api/trash?docId=${doc.id}`, { method: "DELETE" });
    load();
  }

  return (
    <Show when="signed-in">
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader backHref="/documents" />
        <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Trash</h1>
            {docs !== null && docs.length > 0 ? (
              <button
                onClick={async () => {
                  if (!confirm("Permanently delete everything in trash?")) return;
                  await api("/api/trash", { method: "DELETE" });
                  load();
                }}
                className="text-sm"
                style={{ color: "var(--inkwell-danger)" }}
              >
                Empty trash
              </button>
            ) : null}
          </div>

            {docs === null ? (
              <p className="text-sm" style={{ color: "var(--inkwell-muted)" }}>Loading…</p>
            ) : error ? (
              <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>
            ) : docs.length === 0 ? (
            <p className="mt-16 text-center text-sm" style={{ color: "var(--inkwell-muted)" }}>
              Trash is empty. Deleted documents stay here for 30 days before being purged.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--inkwell-line)" }}>
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-3">
                  <span className="flex-1 truncate">{doc.title || "Untitled"}</span>
                  <span className="text-xs" style={{ color: "var(--inkwell-muted)" }}>
                    deleted {new Date(doc.deletedAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => restore(doc)}
                    className="rounded-md border px-2 py-1 text-xs"
                    style={{ borderColor: "var(--inkwell-line)" }}
                  >
                    Restore
                  </button>
                  <button onClick={() => purge(doc)} className="text-xs" style={{ color: "var(--inkwell-danger)" }}>
                    Delete forever
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </Show>
  );
}

