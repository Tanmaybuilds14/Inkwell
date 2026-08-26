"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Show } from "@clerk/nextjs";
import { api } from "@/components/app-header";

export function Dashboard() {
  const router = useRouter();
  const [folders, setFolders] = useState(null);
  const [docs, setDocs] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null); // null = root
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("owned"); // owned | shared
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
    return () => {
      cancelled = true;
    };
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
    return () => {
      cancelled = true;
    };
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
        <aside
          className="hidden w-60 shrink-0 border-r p-4 md:block"
          style={{ borderColor: "var(--inkwell-line)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--inkwell-muted)" }}>
              Folders
            </span>
            <button
              onClick={createFolder}
              className="text-lg leading-none"
              style={{ color: "var(--inkwell-accent)" }}
              title="New folder"
            >
              +
            </button>
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
                  <span className="mr-1 text-xs opacity-50">{f._count.documents}</span>
                </SidebarLink>
                <span className="flex">
                  <button title="Rename" onClick={() => renameFolder(f)} className="px-1 opacity-40 hover:opacity-100">✎</button>
                  <button title="Delete" onClick={() => deleteFolder(f)} className="px-1 opacity-40 hover:opacity-100">✕</button>
                </span>
              </SidebarGroup>
            ))}
          </nav>
          <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--inkwell-line)" }}>
            <Link href="/trash" className="text-sm hover:underline" style={{ color: "var(--inkwell-muted)" }}>
              🗑 Trash
            </Link>
          </div>
        </aside>

        {/* Main list */}
        <main className="flex-1 px-8 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title…"
                className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-teal-600"
                style={{ borderColor: "var(--inkwell-line)" }}
              />
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="rounded-lg border bg-transparent px-2 py-2 text-sm"
                style={{ borderColor: "var(--inkwell-line)" }}
              >
                <option value="owned">Owned by me</option>
                <option value="shared">Shared with me</option>
              </select>
              <button
                onClick={() => createDocument(scope === "owned" ? activeFolderId : null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ background: "var(--inkwell-accent)" }}
              >
                New document
              </button>
            </div>

            {error ? (
              <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>
            ) : null}

            {docs === null ? (
              <p className="text-sm" style={{ color: "var(--inkwell-muted)" }}>Loading…</p>
            ) : docs.length === 0 ? (
              <p className="mt-16 text-center text-sm" style={{ color: "var(--inkwell-muted)" }}>
                No documents yet — click “New document” to start writing.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--inkwell-line)" }}>
                {docs.map((doc) => (
                  <li key={doc.id} className="group flex items-center gap-3 py-3">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="flex-1 truncate font-medium hover:underline"
                    >
                      {doc.title || "Untitled"}
                      {doc.shareEnabled ? (
                        <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
                          style={{ background: "var(--inkwell-accent-soft)", color: "var(--inkwell-accent)" }}>
                          shared link
                        </span>
                      ) : null}
                    </Link>
                    <span className="text-xs" style={{ color: "var(--inkwell-muted)" }}>
                      {new Date(doc.updatedAt).toLocaleString()}
                    </span>
                    <select
                      value=""
                      onChange={(e) => moveDoc(doc, e.target.value || null)}
                      className="rounded border bg-transparent px-1 py-0.5 text-xs opacity-0 group-hover:opacity-100"
                      style={{ borderColor: "var(--inkwell-line)" }}
                      title="Move to folder"
                    >
                      <option value="">Move to…</option>
                      <option value="">(root)</option>
                      {(folders ?? []).map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    {scope === "owned" ? (
                      <button
                        onClick={() => deleteDoc(doc)}
                        className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100"
                        style={{ color: "var(--inkwell-danger)" }}
                      >
                        Delete
                      </button>
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
      className={`flex flex-1 items-center rounded-md px-2 py-1.5 text-left ${active ? "font-medium" : ""}`}
      style={active ? { background: "var(--inkwell-accent-soft)", color: "var(--inkwell-accent)" } : {}}
    >
      {children}
    </button>
  );
}

function SidebarGroup({ children }) {
  return <div className="flex items-center">{children}</div>;
}

