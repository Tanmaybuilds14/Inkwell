"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Show } from "@clerk/nextjs";
import {
  FileText,
  Pencil,
  Share2,
  Eye,
  RotateCcw,
  Camera,
  Trash2,
  Upload,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { AppHeader, api } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

const PAGE_SIZE = 25;

// Maps audit event types to icons + labels for the feed.
const ACTIVITY_META = {
  doc_created: { icon: FileText, label: "Created" },
  doc_edited: { icon: Pencil, label: "Edited" },
  doc_renamed: { icon: Pencil, label: "Renamed" },
  doc_moved: { icon: FileText, label: "Moved" },
  doc_shared: { icon: Share2, label: "Shared" },
  doc_shared_link: { icon: Share2, label: "Share link" },
  access_granted: { icon: Share2, label: "Access changed" },
  doc_opened: { icon: Eye, label: "Opened" },
  doc_moved_to_trash: { icon: Trash2, label: "Trashed" },
  doc_restored: { icon: RotateCcw, label: "Restored" },
  doc_purged: { icon: Trash2, label: "Deleted forever" },
  version_created: { icon: RotateCcw, label: "Version saved" },
  version_restored: { icon: RotateCcw, label: "Version restored" },
  profile_updated: { icon: Camera, label: "Profile updated" },
};

export default function ProfilePage() {
  return (
    <Show when="signed-in">
      <ProfileContent />
    </Show>
  );
}

function ProfileContent() {
  const router = useRouter();
  const { toast } = useToast();

  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadProfile = useCallback(
    () =>
      api("/api/profile")
        .then((data) => setProfile(data.user))
        .catch((err) => setLoadError(err.message)),
    []
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function deleteAccountData() {
    // Placeholder guard — real account deletion runs through Clerk.
    toast({
      title: "Account deletion runs through Clerk",
      description: "Use the security tab in Clerk's account portal to delete your account.",
      variant: "destructive",
    });
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-lg font-medium">Can&apos;t load your profile</p>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader backHref="/documents" />
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-8 py-8">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader backHref="/documents" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-8 py-8">
        <ProfileCard key={profile.updatedAt ?? profile.id} profile={profile} onSaved={setProfile} />
        <ActivitySection />
        <DangerZone onDelete={deleteAccountData} />
      </main>
    </div>
  );
}

/* ---------------- Profile card ---------------- */

function ProfileCard({ profile, onSaved }) {
  const { toast } = useToast();
  // `key` (in the parent) remounts this form whenever the saved profile
  // changes, so the input re-initializes from props without a setState
  // effect — local edits stay live in between.
  const [name, setName] = useState(profile.name ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const hasNameChanged = (name.trim() || null) !== (profile.name ?? null);

  async function saveName() {
    if (!hasNameChanged) return;
    setSaving(true);
    try {
      const data = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      onSaved(data.user);
      toast({ title: "Profile updated", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't save your name", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await downscaleImage(file);
      const data = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ imageUrl: dataUrl }),
      });
      onSaved(data.user);
      toast({ title: "Profile photo updated", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't update photo", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    try {
      const data = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ imageUrl: null }),
      });
      onSaved(data.user);
      toast({ title: "Profile photo removed" });
    } catch (err) {
      toast({ title: "Couldn't remove photo", description: err.message, variant: "destructive" });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="relative">
          <Avatar user={profile} className="h-20 w-20 text-lg" ring />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title={profile.imageUrl ? "Change photo" : "Upload photo"}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChosen}
            className="hidden"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{profile.name || "Unnamed"}</p>
          <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="secondary">{profile.onboardedAt ? "Onboarded" : "New"}</Badge>
            <span className="text-xs text-muted-foreground">
              Member since {new Date(profile.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {profile.imageUrl ? (
            <Button variant="ghost" size="sm" onClick={removePhoto}>
              Remove photo
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" />
            Upload
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center">
        <label htmlFor="display-name" className="w-32 text-sm text-muted-foreground">
          Display name
        </label>
        <Input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={80}
          className="flex-1"
        />
        <Button size="sm" onClick={saveName} disabled={saving || !hasNameChanged}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </section>
  );
}

/**
 * Client-side downscale so uploads stay tiny: draw the image onto a canvas
 * capped at 256×256 and export as a JPEG/PNG data URL well under the
 * server's 200 KB cap.
 */
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the image"));
      img.onload = () => {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = file.type === "image/png";
        resolve(canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Activity ---------------- */

function ActivitySection() {
  const [events, setEvents] = useState(null);
  const [stats, setStats] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback((cursor) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    return api(`/api/activity?${params}`).then((data) => data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setStats(data.stats);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await load(nextCursor);
      setEvents((prev) => [...(prev ?? []), ...data.events]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Your activity
      </h2>

      {stats ? <StatsGrid stats={stats} /> : <Skeleton className="h-20 rounded-xl" />}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {events === null ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No activity yet — create a document to get started.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {events.map((ev) => (
                <ActivityRow key={ev.id} event={ev} />
              ))}
            </ul>
            {nextCursor ? (
              <div className="border-t border-border p-3 text-center">
                <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Load more
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function StatsGrid({ stats }) {
  const tiles = [
    { label: "Created", value: stats.created },
    { label: "Edited", value: stats.edited, hint: "documents" },
    { label: "Share actions", value: stats.shared },
    { label: "Opened", value: stats.opened },
    { label: "Versions", value: stats.versions },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.label}
            {t.hint ? ` ${t.hint}` : ""}
          </p>
        </div>
  ))}
    </div>
  );
}

function ActivityRow({ event }) {
  const meta = ACTIVITY_META[event.type] ?? { icon: FileText, label: event.type };
  const Icon = meta.icon;
  const when = new Date(event.createdAt);
  const title = event.docTitle || "Untitled";

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {meta.label}
      </span>
      <span className="flex-1 truncate">{title}</span>
      {event.meta?.removed ? <Badge variant="outline">removed</Badge> : null}
      <time
        dateTime={when.toISOString()}
        title={when.toLocaleString()}
        className="shrink-0 text-xs text-muted-foreground"
      >
        {when.toLocaleDateString()}{" "}
        {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
    </li>
  );
}

/* ---------------- Danger zone ---------------- */

function DangerZone({ onDelete }) {
  return (
    <section className="rounded-xl border border-destructive/30 p-5">
      <h2 className="text-sm font-semibold">Account</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Display name and photo are stored in Inkwell. Your sign-in identity is managed by Clerk.
      </p>
      <Button variant="outline" size="sm" className="mt-3 text-destructive" onClick={onDelete}>
        Delete account…
      </Button>
    </section>
  );
}
