"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Avatar } from "@/components/avatar";

/**
 * Header button linking to the profile page. Renders only for signed-in
 * users; shows the local profile photo/name as soon as they're known.
 */
export function ProfileButton() {
  const { isSignedIn } = useUser();
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    const load = () =>
      fetch("/api/profile")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => !cancelled && data?.user && setUser(data.user))
        .catch(() => {});
    load();
    // Re-fetch when the profile changes (onboarding, profile page edits).
    window.addEventListener("inkwell:profile-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("inkwell:profile-updated", load);
    };
  }, [isSignedIn]);

  if (!isSignedIn) return null;

  return (
    <Link
      href="/profile"
      aria-label="Your profile"
      className="rounded-full transition-opacity hover:opacity-80"
    >
      {user ? (
        <Avatar user={user} />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          …
        </span>
      )}
    </Link>
  );
}
