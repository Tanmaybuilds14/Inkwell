"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Show } from "@@clerk/nextjs";
import { Plus, FolderPlus, Trash2, Pencil, FileText, Search } from "lucide-react";
import { api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const router = useRouter();
  const [folders, setFolders] = useState(null);
  const [docs, setDocs] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("owned");
  const [error, setError] = useState(null);

  const refreshFolders = useCallback(
    () =>
      api("/api/folders")
        .then((data) => setFolders(data.folders))
        .catch((err) => setError(err.message)),
    []
  );

  const refreshDocs = useCallback(() => {
    const params = new URLSearchParams({ scope });
    if (query.trim()) {
      params.set("q", query.trim());
    } else if (scope === "owned" && activeFolderId !== null) {
      params.set("folderId", activeFolderId);
    }
    return api(`/api/documents?${params}`)
      .then((data) => {
        setDocs(data.documents);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [activeFolderId, query, scope]);

  useEffect(() => {
    let cancelled = false;
    api("/api/folders")
      .then((data) => !cancelled && setFolders(data.folders))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ scope });
    if (query.trim()) {
      params.set("q", query.trim());
    } else if (scope === "owned" && activeFolderId !== null) {
      params.set("folderId", activeFolderId);
    }
    api(`/api/documents?${params}`)
      .then((data) => {
        if (!cancelled) {
          setDocs(data.documents);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [activeFolderId, query, scope]);

  async function createDocument(folderId = null) {
    const data = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({ folderId }),
    });
    router.push(`/documents/${data.document.id}`);
  }

  async function createFolder() {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    await api("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
    refreshFolders();
  }

  async function renameFolder(folder) {
    const name = prompt("Rename folder:", folder.name);
    if (!name?.trim()) return;
    await api(`/api/folders/${folder.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    refreshFolders();
  }

  async function deleteFolder(folder) {
    if (!confirm(`Delete "${folder.name}"? Documents inside move to the root.`)) return;
    await api(`/api/folders/${folder.id}`, { method: "DELETE" });
    if (activeFolderId === folder.id) setActiveFolderId(null);
    refreshFolders();
    refreshDocs();
  }

  async function moveDoc(doc, folderId) {
    await api(`/api/documents/${doc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderId }),
    });
    refreshDocs();
  }

  async function deleteDoc(doc) {
    if (!confirm(`Move "${doc.title}" to trash?`)) return;
    await api(`/api/documents/${doc.id}`, { method: "DELETE" });
    refreshDocs();
  }

  return (
    <Show when="signed-in">
      <div className="flex w-full flex-1">
        {/* Folder sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card/30 p-4 md:block">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Folders
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={createFolder} title="New folder">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <nav className="flex flex-col gap-0.5 text-sm">
            <SidebarLink active={activeFolderId === null} onClick={() => setActiveFolderId(null)}>
              All documents
            </SidebarLink>
            {(folders ?? []).map((f) => (
              <SidebarGroup key={f.id}>
                <SidebarLink
                  active={activeFolderId === f.id}
                  onClick={() => setActiveFolderId(f.id)}
                >
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="mr-1 text-xs text-muted-foreground">{f._count.documents}</span>
                </SidebarLink>
                <span className="flex">
                  <button title="Rename" onClick={() => renameFolder(f)} className="px-1 text-muted-foreground transition-opacity hover:text-foreground">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button title="Delete" onClick={() => deleteFolder(f)} className="px-1 text-muted-foreground transition-opacity hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </SidebarGroup>
            ))}
          </nav>
          <div className="mt-6 border-t border-border pt-4">
            <Link href="/trash" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <Trash2 className="h-4 w-4" />
              Trash
            </Link>
          </div>
        </aside>

        {/* Main list */}
        <main className="flex-1 px-8 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by title…"
                  className="pl-9"
                />
              </div>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owned">Owned by me</SelectItem>
                  <SelectItem value="shared">Shared with me</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => createDocument(scope === "owned" ? activeFolderId : null)}>
                <Plus className="h-4 w-4" />
                New document
              </Button>
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
            ) : null}

            {docs === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : docs.length === 0 ? (
              <div className="mt-16 flex flex-col items-center text-center">
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm text-muted-foreground">
                  No documents yet — click &ldquo;New document&rdquo; to start writing.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {docs.map((doc) => (
                  <li key={doc.id} className="group flex items-center gap-3 py-3">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="flex flex-1 items-center gap-2 truncate font-medium transition-colors hover:text-primary"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {doc.title || "Untitled"}
                      {doc.shareEnabled ? <Badge variant="default">shared link</Badge> : null}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {new Date(doc.updatedAt).toLocaleString()}
                    </span>
                    <Select onValueChange={(val) => moveDoc(doc, val || null)}>
                      <SelectTrigger className="w-[120px] text-xs opacity-0 group-hover:opacity-100">
                        <SelectValue placeholder="Move to…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">(root)</SelectItem>
                        {(folders ?? []).map((f) => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {scope === "owned" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive opacity-0 group-hover:opacity-100"
                        onClick={() => deleteDoc(doc)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    </Show>
  );
}

function SidebarLink({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center rounded-md px-2 py-1.5 text-left transition-colors",
        active ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function SidebarGroup({ children }) {
  return <div className="flex items-center">{children}</div>;
}
