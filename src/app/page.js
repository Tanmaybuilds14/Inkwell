import Link from "next/link";
import { Show } from "@clerk/nextjs";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: "var(--inkwell-accent)" }}>
        Inkwell
      </p>
      <h1 className="mt-4 max-w-2xl text-5xl font-bold tracking-tight">
        Write together, in real time.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
        A self-hostable collaborative document platform — create, organize into folders,
        share with granular permissions, and co-edit live with conflict-free sync.
      </p>
      <div className="mt-10 flex items-center gap-4">
        <Show when="signed-out">
          <Link
            href="/sign-up"
            className="rounded-lg px-6 py-3 font-medium text-white transition-colors"
            style={{ background: "var(--inkwell-accent)" }}
          >
            Get started
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border px-6 py-3 font-medium"
            style={{ borderColor: "var(--inkwell-line)" }}
          >
            Sign in
          </Link>
        </Show>
        <Show when="signed-in">
          <Link
            href="/documents"
            className="rounded-lg px-6 py-3 font-medium text-white transition-colors"
            style={{ background: "var(--inkwell-accent)" }}
          >
            Open your documents
          </Link>
        </Show>
      </div>
    </main>
  );
}

