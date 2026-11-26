import Link from "next/link";
import { Feather } from "lucide-react";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { GitHubIcon } from "@/components/github-icon";
import { GITHUB_URL } from "@/lib/site";

/**
 * The public site's navbar, shared by the landing page and the how-it-works
 * page.
 *
 * A server component on purpose: Clerk's <Show> resolves from the server's auth
 * state, so the Sign in / Dashboard button is correct in the first paint rather
 * than waiting for clerk-js to load.
 */
export function SiteHeader() {
  return (
    <nav className="flex items-center justify-between gap-4 px-6 py-4 md:px-12">
      <Link href="/" className="flex items-center gap-2">
        <Feather className="h-5 w-5" strokeWidth={1.5} />
        <span className="text-base font-semibold tracking-tight">Inkwell</span>
      </Link>
      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
          <Link href="/how-it-works">How it works</Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="text-muted-foreground [&_svg]:size-[1.2rem]"
        >
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <GitHubIcon />
          </a>
        </Button>
        <ThemeToggle />
        <Show when="signed-out">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </Show>
        <Show when="signed-in">
          <Button size="sm" asChild>
            <Link href="/documents">Dashboard</Link>
          </Button>
        </Show>
      </div>
    </nav>
  );
}
