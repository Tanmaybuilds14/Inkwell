"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

function initialsOf(name, email) {
  const source = name?.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function shadeFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const shades = [
    "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  ];
  return shades[hash % shades.length];
}

/**
 * Consistent avatar: profile photo when present, otherwise colored initials
 * (seeded from the user id so a user's shade is stable across surfaces).
 * Falls back gracefully when a stored image URL fails to load.
 */
export function Avatar({ user, className, ring = false }) {
  const [broken, setBroken] = useState(false);
  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const showImage = user?.imageUrl && !broken;

  return (
    <span
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full",
        ring && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        className
      )}
      title={name || email || undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL stored by the user, not a remote asset
        <img
          src={user.imageUrl}
          alt={name || "Profile photo"}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center text-[10px] font-bold",
            shadeFor(user?.id ?? email ?? "anon")
          )}
        >
          {initialsOf(name, email)}
        </span>
      )}
    </span>
  );
}
