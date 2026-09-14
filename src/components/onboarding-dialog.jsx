"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Camera, Sparkles } from "lucide-react";
import { api } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * First-sign-in onboarding: asks the new user for a display name and a
 * profile photo. Triggered once per user (gated by User.onboardedAt); the
 * dialog itself lives in the root layout so it appears on any page.
 */
export function OnboardingDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/onboarding")
      .then((data) => {
        if (cancelled) return;
        if (!data.onboarded) {
          setName(data.name ?? "");
          setImageUrl(data.imageUrl ?? null);
          setOpen(true);
        }
      })
      .catch(() => {}); // signed-out / offline: stay silent
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setImageUrl(await downscaleImage(file));
    } catch {
      toast({ title: "Couldn't read that image", variant: "destructive" });
    }
  }

  async function finish() {
    setSaving(true);
    try {
      await api("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), imageUrl }),
      });
      setOpen(false);
      // Tell the header (and anything else listening) to re-fetch the profile
      // so the avatar/name update without a reload.
      window.dispatchEvent(new Event("inkwell:profile-updated"));
    } catch (err) {
      toast({ title: "Couldn't save your profile", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Welcome to Inkwell!
          </DialogTitle>
          <DialogDescription>
            Set up how you&apos;ll appear to collaborators. You can change this anytime in your profile.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar user={{ name, imageUrl, id: "self" }} className="h-16 w-16" ring />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors hover:bg-accent"
              title="Add a photo"
            >
              <Camera className="h-3 w-3" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChosen} className="hidden" />
          </div>
          <div className="flex-1 space-y-1.5">
            <label htmlFor="onboarding-name" className="text-sm text-muted-foreground">
              Display name
            </label>
            <Input
              id="onboarding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !saving) finish();
              }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={finish} disabled={saving}>
            Skip for now
          </Button>
          <Button size="sm" onClick={finish} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Get started
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
