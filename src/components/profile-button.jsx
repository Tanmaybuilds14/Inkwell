"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Avatar } from "@/components/avatar";
import { useProfile } from "@/lib/use-profile";

/**
 * Header button linking to the profile page. Renders only for signed-in
 * users; shows the local profile photo/name as soon as they're known.
 */
export function ProfileButton() {
  const { isSignedIn } = useUser();
  const user = useProfile();

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
