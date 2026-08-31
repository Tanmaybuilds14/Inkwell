"use client";

import { useCallback, useEffect, useState } from "react";
import { History, X, ArrowLeft, RotateCcw } from "lucide-react";
import { api } from "@/components/app-header";
import { Button } from "@/components/ui/button";

export function VersionHistory({ documentId, qs, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
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
    return () => { cancelled = true; };
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
    <aside className="w-80 shrink-0 border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Version history</h2>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>
      ) : null}

      {!preview ? (
        <ul className="max-h-[70vh] overflow-y-auto p-3">
          {versions.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No snapshots yet. Versions are captured automatically every few minutes while editing.
            </li>
          ) : (
            versions.map((v) => (
              <li key={v.id} className="mb-1">
                <button
                  onClick={() => openPreview(v.id)}
                  className="w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span className="block font-medium">{v.title || "Untitled"}</span>
                  <span className="block text-xs text-muted-foreground">
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
          <Button variant="ghost" size="sm" className="mb-2 self-start" onClick={() => setPreview(null)}>
            <ArrowLeft className="h-4 w-4" />
            All versions
          </Button>
          <p className="mb-2 text-xs text-muted-foreground">
            Preview of version from {new Date(preview.createdAt).toLocaleString()} (read-only)
          </p>
          <div
            className="version-preview mb-3 flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm"
            dangerouslySetInnerHTML={{ __html: preview.html || "<p><em>Empty document</em></p>" }}
          />
          <Button onClick={() => restore(preview.id)} disabled={restoring}>
            <RotateCcw className="h-4 w-4" />
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </div>
      )}
    </aside>
  );
}
