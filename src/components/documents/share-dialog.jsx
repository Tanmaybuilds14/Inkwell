"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, X, Trash2, Link2, Mail } from "lucide-react";
import { api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

const ROLE_OPTIONS = ["VIEWER", "COMMENTER", "EDITOR"];

export function ShareDialog({ documentId, open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () =>
      api(`/api/documents/${documentId}/share`)
        .then((d) => { setData(d); setError(null); })
        .catch((err) => setError(err.message)),
    [documentId]
  );

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Share document</DialogTitle>
          <DialogDescription>
            Invite collaborators by email or enable link sharing.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>
        ) : null}

        {/* Invite by email */}
        <form onSubmit={invite} className="flex gap-2">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="pl-9"
            />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r.toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit">Invite</Button>
        </form>

        {/* Collaborators */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            People with access
          </h3>
          {!data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.collaborators.map((c) => (
                <li key={c.permissionId ?? c.userId} className="flex items-center gap-2 text-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">
                    {(c.name ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.role === "OWNER" ? (
                    <Badge variant="secondary">owner</Badge>
                  ) : (
                    <>
                      <Select
                        value={c.role}
                        onValueChange={(val) => changeRole(c.permissionId, val)}
                      >
                        <SelectTrigger className="h-7 w-[100px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>{r.toLowerCase()}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeCollaborator(c.permissionId)}
                        title="Remove access"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Link sharing */}
        <div className="space-y-3">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Anyone with the link</span>
            </div>
            <Switch
              checked={data?.link?.enabled ?? false}
              onCheckedChange={toggleLink}
            />
          </div>

          {data?.link?.enabled ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={data.link.url ?? ""}
                  className="text-xs text-muted-foreground"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(data.link.url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => toggleLink(false)}
                >
                  Revoke
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">link holders can:</span>
                <Select
                  value={data.link.role ?? "VIEWER"}
                  onValueChange={setLinkRole}
                >
                  <SelectTrigger className="h-7 w-[100px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r.toLowerCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
