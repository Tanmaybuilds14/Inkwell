import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/**
 * The one auth-aware primary call to action, shared by the hero, the closing
 * section and the how-it-works page so the three can never drift apart.
 *
 * It lives in a server component (never inside a client boundary) because
 * Clerk's <Show> resolves from the server's auth state — inside a client
 * component it would stay empty until clerk-js finished loading.
 */
export function PrimaryCta({ size = "lg" }) {
  return (
    <>
      <Show when="signed-out">
        <Button asChild size={size} className="w-full sm:w-auto">
          <Link href="/sign-up">Get started</Link>
        </Button>
      </Show>
      <Show when="signed-in">
        <Button asChild size={size} className="w-full sm:w-auto">
          <Link href="/documents">Open your documents</Link>
        </Button>
      </Show>
    </>
  );
}
