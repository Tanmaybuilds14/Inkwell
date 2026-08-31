import Link from "next/link";
import { Feather } from "lucide-react";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ScrollReveal } from "@/components/scroll-reveal";
import { ParallaxHero } from "@/components/parallax-hero";
import { FeatureSection } from "@/components/feature-section";

const SECTIONS = [
  {
    label: "Real-Time Co-Editing",
    heading: "Write together, simultaneously.",
    body: "Multiple people editing the same document at the same time — with no conflicts, no overwrites, no lost work. Inkwell uses Yjs CRDTs to merge every keystroke conflict-free, even when two people type in the same paragraph at the same instant. Edits propagate across horizontally-scaled servers in under 300ms, so everyone sees the same document state no matter which server they're connected to.",
    align: "left",
  },
  {
    label: "Sharing & Permissions",
    heading: "Control who sees what.",
    body: "Share a document with a teammate by email, or generate a public link for anyone. Four permission roles — Owner, Editor, Commenter, Viewer — are enforced server-side on every request and every WebSocket message. Revoke a link and access stops instantly. No one can edit a document they shouldn't be able to see.",
    align: "right",
  },
  {
    label: "Document Organization",
    heading: "Keep everything in its place.",
    body: "Nested folders let you structure your workspace the way you think. Move documents between folders, rename them, search by title. When you delete something it goes to Trash — soft-deleted for 30 days before Inngest background jobs permanently purge it. You can always restore.",
    align: "left",
  },
  {
    label: "Version History",
    heading: "Go back to any point in time.",
    body: "Inkwell snapshots your document every few minutes while you edit. Browse the timeline, preview any prior version as rendered HTML, and restore it in one click. The current state is saved first so the restore itself is always undoable. Old snapshots are automatically pruned after 30 days.",
    align: "right",
  },
  {
    label: "Live Presence",
    heading: "See who's here.",
    body: "Colored cursors with names show exactly where each collaborator is typing. An avatar bar in the header lists everyone currently in the document. Guest collaborators get a random name and color — no account needed, just a share link.",
    align: "left",
  },
  {
    label: "Self-Hostable",
    heading: "Your data, your server.",
    body: "Inkwell is designed to run on your own infrastructure. The Next.js web app deploys to Vercel, the WebSocket sync service runs on Railway or Fly.io with two or more instances, and PostgreSQL plus Redis handle persistence and cross-server broadcast. Docker Compose files are included for local development.",
    align: "right",
  },
];

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12">
        <div className="flex items-center gap-2">
          <Feather className="h-5 w-5" strokeWidth={1.5} />
          <span className="text-base font-semibold tracking-tight">Inkwell</span>
        </div>
        <div className="flex items-center gap-3">
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

      {/* Hero with floating parallax cards */}
      <ParallaxHero />

      {/* Feature sections — each aspect described in detail */}
      {SECTIONS.map((s, i) => (
        <FeatureSection key={s.label} {...s} index={i} />
      ))}

      {/* CTA */}
      <ScrollReveal>
        <section className="border-t border-border px-6 py-24 text-center md:py-32">
          <h2 className="text-4xl font-light tracking-tight sm:text-5xl">
            Ready to start?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Create your first document in seconds.
          </p>
          <div className="mt-10">
            <Show when="signed-out">
              <Button asChild size="lg">
                <Link href="/sign-up">Get started for free</Link>
              </Button>
            </Show>
            <Show when="signed-in">
              <Button asChild size="lg">
                <Link href="/documents">Go to documents</Link>
              </Button>
            </Show>
          </div>
        </section>
      </ScrollReveal>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Feather className="h-4 w-4" strokeWidth={1.5} />
            <span>Inkwell</span>
          </div>
          <p className="text-xs text-muted-foreground">
            A self-hostable collaborative document platform.
          </p>
        </div>
      </footer>
    </main>
  );
}
