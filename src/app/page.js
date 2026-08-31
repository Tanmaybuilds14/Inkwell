import Link from "next/link";
import { Feather, Users, History, Share2, FolderOpen, Zap } from "lucide-react";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  {
    icon: Zap,
    title: "Real-time co-editing",
    desc: "Conflict-free Yjs CRDTs merge edits instantly across horizontally-scaled servers.",
  },
  {
    icon: Share2,
    title: "Granular sharing",
    desc: "Invite by email or share via revocable links with four permission roles.",
  },
  {
    icon: History,
    title: "Version history",
    desc: "Auto-snapshots every few minutes — preview and restore any prior version.",
  },
  {
    icon: FolderOpen,
    title: "Organization",
    desc: "Nested folders, title search, and soft-delete with 30-day retention.",
  },
  {
    icon: Users,
    title: "Live presence",
    desc: "See who's online with colored cursors and avatar presence indicators.",
  },
  {
    icon: Feather,
    title: "Self-hostable",
    desc: "Full control over your data — deploy on your own infrastructure.",
  },
];

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <div className="flex justify-end px-4 pt-4">
        <ThemeToggle />
      </div>
      <section className="flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-muted-foreground">
          <Feather className="h-4 w-4 text-primary" />
          Inkwell
        </div>
        <h1 className="mt-6 max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
          Write together,
          <br />
          <span className="text-primary">in real time.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          A self-hostable collaborative document platform — create, organize,
          share with granular permissions, and co-edit live with conflict-free sync.
        </p>
        <Show when="signed-out">
          <div className="mt-10 flex items-center gap-4">
            <Button asChild size="lg">
              <Link href="/sign-up">Get started</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </Show>
        <Show when="signed-in">
          <div className="mt-10">
            <Button asChild size="lg">
              <Link href="/documents">Open your documents</Link>
            </Button>
          </div>
        </Show>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-8 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-border">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="mt-2 text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
