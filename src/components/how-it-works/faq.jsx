import { ChevronDown } from "lucide-react";

const QUESTIONS = [
  {
    q: "Do guests need an account?",
    a: "No. A public link carries a signed, revocable token — never the document ID — so a guest joins with a room role and no user row is ever created for them. Switch the link off and access stops immediately for everyone holding it.",
  },
  {
    q: "What happens when two people type the same sentence?",
    a: "Both sets of keystrokes are kept. Documents are CRDTs, not a lock: each edit merges at the character level on every client, in any order, and edits reach collaborators through a per-document channel in under 300ms.",
  },
  {
    q: "Can I keep working offline?",
    a: "Yes. The editor caches the document in IndexedDB, the connection pill switches to “Offline — edits saved locally”, and whatever you wrote merges back in when the socket returns.",
  },
  {
    q: "How often are versions saved?",
    a: "Every five minutes while a document is being edited. You can preview any snapshot as rendered HTML and restore it in one click; the state you had before the restore is written to history first, so a restore is itself undoable. Snapshots older than 30 days are pruned automatically.",
  },
  {
    q: "What happens to deleted documents?",
    a: "Deleting is soft. A document goes to Trash for 30 days and remembers the folder it came from, so restoring puts it back where it was. An hourly job purges anything past the window, and a trashed document is invisible to collaborators in the meantime — not merely absent from your dashboard.",
  },
  {
    q: "Who can change permissions or revoke a link?",
    a: "Only the Owner. Roles are enforced server-side on every HTTP request and every WebSocket frame, so a Viewer cannot write even by sending a forged update frame — the room rejects it, rather than the UI merely hiding the button.",
  },
  {
    q: "Do I need a hosted collaboration vendor?",
    a: "No. The Next.js app, the WebSocket sync service, PostgreSQL and Redis are all you run, and the Compose files are in the repository. Nothing about editing, presence or version history depends on a third party.",
  },
];

/** Native <details> accordions: keyboard and screen-reader support for free. */
export function Faq() {
  return (
    <div className="space-y-3">
      {QUESTIONS.map((item) => (
        <details
          key={item.q}
          className="mockup-card group rounded-2xl px-5 py-4 [&::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-medium text-foreground marker:content-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none">
            {item.q}
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <p className="mt-3 text-[17px] leading-[1.65] text-landing-muted">
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}
