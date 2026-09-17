"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Show } from "@clerk/nextjs";
import { Plus, ChevronDown, FileText, FolderOpen, Trash2, Pencil, Search, Bell, Menu } from "lucide-react";
import { api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// Radix Select v2 throws on SelectItem value="", so the root entry uses a
// sentinel that maps back to null (no folder) before hitting the API.
const ROOT_FOLDER_VALUE = "__root__";
const DOCS_SKELETON_WIDTHS = ["w-2/3", "w-2/5", "w-1/2", "w-2/3", "w-2/5", "w-1/2"];

export function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [folders, setFolders] = useState(null);
  const [docs, setDocs] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("owned");
  const [error, setError] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    try {
      await api("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
      refreshFolders();
    } catch (err) {
      toast({ title: "Couldn't create folder", description: err.message, variant: "destructive" });
    }
  }

  async function renameFolder(folder) {
    const name = prompt("Rename folder:", folder.name);
    if (!name?.trim()) return;
    try {
      await api(`/api/folders/${folder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      refreshFolders();
    } catch (err) {
      toast({ title: "Couldn't rename folder", description: err.message, variant: "destructive" });
    }
  }

  async function deleteFolder(folder) {
    if (!confirm(`Delete "${folder.name}"? Documents inside move to the root.`)) return;
    try {
      await api(`/api/folders/${folder.id}`, { method: "DELETE" });
      if (activeFolderId === folder.id) setActiveFolderId(null);
      refreshFolders();
      refreshDocs();
    } catch (err) {
      toast({ title: "Couldn't delete folder", description: err.message, variant: "destructive" });
    }
  }

  async function moveDoc(doc, folderId) {
    const previousDocs = docs;
    const folderFiltered = scope === "owned" && !query.trim() && activeFolderId !== null;
    // Optimistic: show the move instantly. In a folder-filtered view the
    // document leaves the list as soon as it moves elsewhere; in the
    // unfiltered list it stays and just re-labels. Reverted on failure.
    setDocs((list) => {
      if (!list) return list;
      const updated = list.map((d) => (d.id === doc.id ? { ...d, folderId } : d));
      return folderFiltered && folderId !== activeFolderId
        ? updated.filter((d) => d.id !== doc.id)
        : updated;
    });
    try {
      await api(`/api/documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ folderId }),
      });
      const folderName = folderId
        ? (folders ?? []).find((f) => f.id === folderId)?.name
        : null;
      toast({
        title: folderName ? `Moved to "${folderName}"` : "Moved to root",
        description: doc.title || "Untitled",
        variant: "success",
      });
      refreshFolders(); // keep sidebar counts honest, non-blocking
    } catch (err) {
      setDocs(previousDocs); // rollback
      toast({
        title: `Couldn't move "${doc.title || "Untitled"}"`,
        description: err.message,
        variant: "destructive",
      });
    }
  }

  async function deleteDoc(doc) {
    if (!confirm(`Move "${doc.title || "Untitled"}" to trash?`)) return;
    try {
      await api(`/api/documents/${doc.id}`, { method: "DELETE" });
      toast({ title: "Moved to trash", description: doc.title || "Untitled", variant: "success" });
      refreshDocs();
    } catch (err) {
      toast({ title: "Couldn't move to trash", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Show when="signed-in">
      <div className="flex w-full flex-1">
        {/* Mobile sidebar trigger */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="fixed left-4 top-3.5 z-30 md:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4">
              <SidebarNav
                folders={folders}
                activeFolderId={activeFolderId}
                setActiveFolderId={(id) => {
                  setActiveFolderId(id);
                  setMobileOpen(false);
                }}
                onRename={renameFolder}
                onDelete={deleteFolder}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Folder sidebar — desktop */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/30 p-4 md:flex">
          <SidebarNav
            folders={folders}
            activeFolderId={activeFolderId}
            setActiveFolderId={setActiveFolderId}
            onRename={renameFolder}
            onDelete={deleteFolder}
          />
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4" />
                    New
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => createDocument(scope === "owned" ? activeFolderId : null)}>
                    <FileText className="mr-2 h-4 w-4" />
                    New document
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={createFolder}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    New folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
            ) : null}

            {docs === null ? (
              <div className="divide-y divide-border" aria-hidden="true">
                {DOCS_SKELETON_WIDTHS.map((width, i) => (
                  <div key={i} className="flex items-center gap-3 py-3.5">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className={cn("h-4", width)} />
                    <Skeleton className="ml-auto h-3 w-32" />
                    <Skeleton className="h-9 w-[120px] rounded-lg" />
                  </div>
                ))}
              </div>
            ) : docs.length === 0 ? (
              <div className="mt-16 flex flex-col items-center text-center">
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm text-muted-foreground">
                  No documents yet — click &ldquo;New&rdquo; to create a document or folder.
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
                    {doc.isOwner === false ? (
                      // Received document (shared by email or link): no move/
                      // delete controls — just a role badge.
                      <Badge variant="outline">shared with you</Badge>
                    ) : (
                      <>
                        <Select
                          value={doc.folderId ?? ROOT_FOLDER_VALUE}
                          onValueChange={(val) =>
                            moveDoc(doc, val === ROOT_FOLDER_VALUE ? null : val)
                          }
                        >
                          <SelectTrigger className="w-[120px] text-xs opacity-0 group-hover:opacity-100">
                            <SelectValue placeholder="Move to…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ROOT_FOLDER_VALUE}>(root)</SelectItem>
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
                      </>
                    )}
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

function SidebarNav({ folders, activeFolderId, setActiveFolderId, onRename, onDelete }) {
  return (
    <>
      <div className="mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Folders
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
        <SidebarLink active={activeFolderId === null} onClick={() => setActiveFolderId(null)}>
          All documents
        </SidebarLink>
        {folders === null ? (
          <div className="flex flex-col gap-2 px-2 pt-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ) : null}
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
              <button title="Rename" onClick={() => onRename(f)} className="px-1 text-muted-foreground transition-opacity hover:text-foreground">
                <Pencil className="h-3 w-3" />
              </button>
              <button title="Delete" onClick={() => onDelete(f)} className="px-1 text-muted-foreground transition-opacity hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          </SidebarGroup>
        ))}
      </nav>
      <div className="mt-6 border-t border-border pt-4">
        <Link href="/inbox" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Bell className="h-4 w-4" />
          Inbox
        </Link>
        <Link href="/trash" className="mt-2 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Trash2 className="h-4 w-4" />
          Trash
        </Link>
      </div>
    </>
  );
}
