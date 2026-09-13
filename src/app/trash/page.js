"use client";

import { useCallback, useEffect, useState } from "react";
import { Show } from "@clerk/nextjs";
import { Trash2, RotateCcw, FileText } from "lucide-react";
import { AppHeader, api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export default function TrashPage() {
  const { toast } = useToast();
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
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function restore(doc) {
    try {
      await api(`/api/documents/${doc.id}/restore`, { method: "POST" });
      toast({
        title: "Document restored",
        description: doc.title || "Untitled",
        variant: "success",
      });
      load();
    } catch (err) {
      toast({
        title: `Couldn't restore "${doc.title || "Untitled"}"`,
        description: err.message,
        variant: "destructive",
      });
    }
  }

  async function purge(doc) {
    if (!confirm(`Permanently delete "${doc.title || "Untitled"}"? This cannot be undone.`)) return;
    try {
      await api(`/api/trash?docId=${doc.id}`, { method: "DELETE" });
      toast({ title: "Deleted forever", description: doc.title || "Untitled" });
      load();
    } catch (err) {
      toast({
        title: `Couldn't delete "${doc.title || "Untitled"}"`,
        description: err.message,
        variant: "destructive",
      });
    }
  }

  async function emptyTrash() {
    if (!confirm("Permanently delete everything in trash? This cannot be undone.")) return;
    try {
      await api("/api/trash", { method: "DELETE" });
      toast({ title: "Trash emptied" });
      load();
    } catch (err) {
      toast({ title: "Couldn't empty trash", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Show when="signed-in">
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader backHref="/documents" />
        <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold">Trash</h1>
            </div>
            {docs !== null && docs.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={emptyTrash}
              >
                Empty trash
              </Button>
            ) : null}
          </div>

          {docs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
          ) : docs.length === 0 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <Trash2 className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm text-muted-foreground">
                Trash is empty. Deleted documents stay here for 30 days before being purged.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{doc.title || "Untitled"}</span>
                  <span className="text-xs text-muted-foreground">
                    deleted {new Date(doc.deletedAt).toLocaleString()}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => restore(doc)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => purge(doc)}>
                    Delete forever
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </Show>
  );
}
