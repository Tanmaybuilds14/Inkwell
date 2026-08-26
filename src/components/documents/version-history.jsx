"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/app-header";

export function VersionHistory({ documentId, qs, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null); // { id, html, createdAt }
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/documents/${documentId}/versions${qs}`);
      setVersions(data.versions);
    } catch (err) {
      setError(err.message);
    }
  }, [documentId, qs]);

  useEffect(() => {
    let cancelled = false;
    api(`/api/documents/${documentId}/versions${qs}`)
      .then((data) => !cancelled && setVersions(data.versions))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [documentId, qs]);

  async function openPreview(versionId) {
    try {
      const data = await api(`/api/documents/${documentId}/versions/${versionId}${qs}`);
      setPreview(data.version);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function restore(versionId) {
    if (!confirm("Restore this version as the current document? The current state is saved to history first.")) return;
    setRestoring(true);
    try {
      await api(`/api/documents/${documentId}/versions/${versionId}/restore${qs}`, {
        method: "POST",
      });
      onRestored?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <aside
      className="w-80 shrink-0 border-l"
      style={{ borderColor: "var(--inkwell-line)", background: "var(--inkwell-paper)" }}
    >
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--inkwell-line)" }}>
        <h2 className="text-sm font-semibold">Version history</h2>
        <button onClick={onClose} className="text-sm opacity-50 hover:opacity-100">✕</button>
      </div>

      {error ? (
        <p className="m-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</p>
      ) : null}

      {!preview ? (
        <ul className="max-h-[70vh] overflow-y-auto p-3">
          {versions.length === 0 ? (
            <li className="py-6 text-center text-xs" style={{ color: "var(--inkwell-muted)" }}>
              No snapshots yet. Versions are captured automatically every few minutes while editing.
            </li>
          ) : (
            versions.map((v) => (
              <li key={v.id} className="mb-1">
                <button
                  onClick={() => openPreview(v.id)}
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="block font-medium">{v.title || "Untitled"}</span>
                  <span className="block text-xs" style={{ color: "var(--inkwell-muted)" }}>
                    {new Date(v.createdAt).toLocaleString()}
                    {v.createdBy ? ` · ${v.createdBy}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className="flex max-h-[75vh] flex-col p-3">
          <button onClick={() => setPreview(null)} className="mb-2 self-start text-xs underline" style={{ color: "var(--inkwell-muted)" }}>
            ← All versions
          </button>
          <p className="mb-2 text-xs" style={{ color: "var(--inkwell-muted)" }}>
            Preview of version from {new Date(preview.createdAt).toLocaleString()} (read-only)
          </p>
          <div
            className="version-preview mb-3 flex-1 overflow-y-auto rounded-lg border p-3 text-sm"
            style={{ borderColor: "var(--inkwell-line)" }}
            dangerouslySetInnerHTML={{ __html: preview.html || "<p><em>Empty document</em></p>" }}
          />
          <button
            onClick={() => restore(preview.id)}
            disabled={restoring}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--inkwell-accent)" }}
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </button>
        </div>
      )}
    </aside>
  );
}
