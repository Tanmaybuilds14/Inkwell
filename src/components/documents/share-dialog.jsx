"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/app-header";

const ROLE_OPTIONS = ["VIEWER", "COMMENTER", "EDITOR"];

export function ShareDialog({ documentId, onClose }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () =>
      api(`/api/documents/${documentId}/share`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((err) => setError(err.message)),
    [documentId]
  );

  useEffect(() => {
    let cancelled = false;
    api(`/api/documents/${documentId}/share`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function invite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await api(`/api/documents/${documentId}/share`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeRole(permissionId, newRole) {
    await api(`/api/documents/${documentId}/share`, {
      method: "PATCH",
      body: JSON.stringify({ permissionId, role: newRole }),
    });
    load();
  }

  async function removeCollaborator(permissionId) {
    await api(`/api/documents/${documentId}/share?permissionId=${permissionId}`, {
      method: "DELETE",
    });
    load();
  }

  async function toggleLink(enabled) {
    if (!enabled) {
      if (!confirm("Revoke the share link? Everyone holding it loses access immediately.")) return;
    }
    await api(`/api/documents/${documentId}/share`, {
      method: "PATCH",
      body: JSON.stringify({ linkEnabled: enabled, linkRole: data?.link?.role ?? "VIEWER" }),
    });
    load();
  }

  async function setLinkRole(linkRole) {
    await api(`/api/documents/${documentId}/share`, {
      method: "PATCH",
      body: JSON.stringify({ linkEnabled: true, linkRole }),
    });
    load();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl p-6 shadow-xl"
        style={{ background: "var(--inkwell-paper)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share document</h2>
          <button onClick={onClose} className="text-sm opacity-50 hover:opacity-100">✕</button>
        </div>

        {error ? (
          <p className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>
        ) : null}

        {/* Invite by email */}
        <form onSubmit={invite} className="mb-5 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--inkwell-line)" }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border px-2 py-2 text-sm"
            style={{ borderColor: "var(--inkwell-line)" }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r.toLowerCase()}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--inkwell-accent)" }}
          >
            Invite
          </button>
        </form>

        {/* Collaborators */}
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--inkwell-muted)" }}>
            People with access
          </h3>
          {!data ? (
            <p className="text-sm" style={{ color: "var(--inkwell-muted)" }}>Loading…</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.collaborators.map((c) => (
                <li key={c.permissionId ?? c.userId} className="flex items-center gap-2 text-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: "#78716c" }}>
                    {(c.name ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.role === "OWNER" ? (
                    <span className="text-xs" style={{ color: "var(--inkwell-muted)" }}>owner</span>
                  ) : (
                    <>
                      <select
                        value={c.role}
                        onChange={(e) => changeRole(c.permissionId, e.target.value)}
                        className="rounded border px-1 py-0.5 text-xs"
                        style={{ borderColor: "var(--inkwell-line)" }}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r.toLowerCase()}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeCollaborator(c.permissionId)}
                        className="px-1 text-xs"
                        style={{ color: "var(--inkwell-danger)" }}
                        title="Remove access"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Link sharing */}
        <div className="border-t pt-4" style={{ borderColor: "var(--inkwell-line)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Anyone with the link</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={data?.link?.enabled ?? false}
                onChange={(e) => toggleLink(e.target.checked)}
                className="sr-only"
              />
              <span
                className={`h-5 w-9 rounded-full transition-colors ${data?.link?.enabled ? "" : "opacity-40"}`}
                style={{ background: data?.link?.enabled ? "var(--inkwell-accent)" : "#a8a29e" }}
              />
            </label>
          </div>

          {data?.link?.enabled ? (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={data.link.url ?? ""}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs"
                  style={{ borderColor: "var(--inkwell-line)", color: "var(--inkwell-muted)" }}
                />
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(data.link.url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  style={{ borderColor: "var(--inkwell-line)" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => toggleLink(false)}
                  className="text-xs"
                  style={{ color: "var(--inkwell-danger)" }}
                >
                  Revoke
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "var(--inkwell-muted)" }}>link holders can:</span>
                <select
                  value={data.link.role ?? "VIEWER"}
                  onChange={(e) => setLinkRole(e.target.value)}
                  className="rounded border px-1 py-0.5 text-xs"
                  style={{ borderColor: "var(--inkwell-line)" }}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r.toLowerCase()}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
