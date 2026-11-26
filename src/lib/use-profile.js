"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";

/**
 * The signed-in user's Inkwell profile (display name + photo), from
 * /api/profile. Null while it loads, and for share-link guests — who have no
 * profile by definition.
 *
 * One fetch implementation for every surface that needs the identity the app
 * shows (header avatar, presence). The profile page announces edits through
 * `inkwell:profile-updated`, so a rename reaches live carets and the avatar
 * without a reload.
 *
 * The response is held with the account id it belongs to: after a sign-out (or
 * an account switch in the same tab) it must not be handed back as the next
 * session's identity — presence would broadcast the previous person's name.
 */
export function useProfile() {
  const { isSignedIn, user } = useUser();
  const [loaded, setLoaded] = useState(null); // { userId, profile }
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isSignedIn) return undefined;

    let cancelled = false;
    const load = () =>
      fetch("/api/profile")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data?.user) setLoaded({ userId, profile: data.user });
        })
        .catch(() => {
          // Best-effort: Clerk's own profile is still a usable fallback name.
        });

    load();
    window.addEventListener("inkwell:profile-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("inkwell:profile-updated", load);
    };
  }, [isSignedIn, userId]);

  return isSignedIn && loaded?.userId === userId ? loaded.profile : null;
}
