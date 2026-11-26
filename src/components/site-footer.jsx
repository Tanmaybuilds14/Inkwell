import Link from "next/link";
import { Feather } from "lucide-react";
import { GitHubIcon } from "@/components/github-icon";
import { GITHUB_URL, LICENSE_URL } from "@/lib/site";

const FOOTER_LINKS = [
  { label: "How it works", href: "/how-it-works", internal: true },
  { label: "GitHub", href: GITHUB_URL, brand: true },
  { label: "Docs", href: GITHUB_URL },
  { label: "License", href: LICENSE_URL },
];

/** The public site's footer: logo, tagline, links, copyright. */
export function SiteFooter() {
  return (
    <footer className="border-t border-border px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <Feather className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">Inkwell</p>
              <p className="mt-1 text-xs text-landing-muted">
                A self-hostable collaborative document platform.
              </p>
            </div>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
          >
            {FOOTER_LINKS.map((link) =>
              link.internal ? (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-landing-muted transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-landing-muted transition-colors hover:text-foreground"
                >
                  {link.brand && <GitHubIcon className="h-3.5 w-3.5" />}
                  {link.label}
                </a>
              )
            )}
          </nav>
        </div>
        <p className="text-xs text-landing-muted">© 2026 Inkwell</p>
      </div>
    </footer>
  );
}
