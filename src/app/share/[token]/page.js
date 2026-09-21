import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { yUpdateToHtml } from "@/lib/ydoc-utils";
import { getSharedDocument, ownerDisplayName } from "@/lib/share-page";

/**
 * The public, read-only view of a shared document: `/share/<token>`.
 *
 * Why a page and not just the `?share=` editor route: this is the only way a
 * link recipient who is not a signed-in user of this deployment — a crawler,
 * a chat client unfurling the link, someone who just wants to read — gets the
 * document's actual content. The editor is a client component that fetches
 * the document over the API, so its HTML response contains a loading shell and
 * always 200s; here the content is in the response body and an unusable token
 * is a real 404 (see generateMetadata for why the status is decided there).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const doc = await getSharedDocument(token);

  // The 404 is thrown HERE, not (only) in the page body below.
  //
  // Metadata is resolved before the response body starts streaming, and once
  // streaming has begun the status line is already on the wire and cannot be
  // changed — Next.js documents this as "200 for streamed responses, 404 for
  // non-streamed", and this route has the root loading.js Suspense boundary
  // above it, so the body always streams. Asking for the 404 from the render
  // body alone would answer 200 with a 404 page inside it, which is exactly
  // the soft-404 this page exists to avoid.
  if (!doc) notFound();

  const owner = ownerDisplayName(doc.owner);
  const title = doc.title?.trim() || "Untitled document";
  const description = owner
    ? `A document shared by ${owner} on Inkwell.`
    : "A document shared on Inkwell.";

  return {
    title,
    description,
    // The token is a bearer credential: whoever holds it can read the
    // document. Keeping the page out of search indexes is what stops "shared
    // with a few people" from silently becoming "findable by anyone". Crawlers
    // and link unfurlers still read the rendered HTML below — that is the
    // point of server rendering — they just do not follow or archive it.
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "article" },
  };
}

export default async function SharePage({ params }) {
  const { token } = await params;
  const doc = await getSharedDocument(token, { withContent: true });
  if (!doc) notFound();

  const html = await yUpdateToHtml(doc.snapshot);
  const owner = ownerDisplayName(doc.owner);
  const title = doc.title?.trim() || "Untitled document";
  const editorHref = `/documents/${doc.id}?share=${encodeURIComponent(token)}`;
  const canCollaborate = doc.shareRole !== "VIEWER";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">Inkwell</span>
            <Badge variant="secondary" className="text-[10px] font-normal uppercase tracking-wide">
              {canCollaborate ? "shared by link" : "read-only"}
            </Badge>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={editorHref}>Open in Inkwell</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {owner ? <>Shared by {owner} · </> : null}
          <time dateTime={doc.updatedAt.toISOString()}>
            last edited{" "}
            {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(doc.updatedAt)}
          </time>
        </p>

        <hr className="my-8 border-border" />

        {html ? (
          // Static HTML from the stored Yjs snapshot, styled by the same
          // `.inkwell-editor .ProseMirror` rules the editor uses — the public
          // page and the editor render the same nodes on purpose.
          <div
            className="inkwell-editor"
            dangerouslySetInnerHTML={{ __html: `<div class="ProseMirror">${html}</div>` }}
          />
        ) : (
          <p className="text-sm italic text-muted-foreground">
            This document is empty.
          </p>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4">
        <p className="mx-auto w-full max-w-3xl text-xs text-muted-foreground">
          You are viewing a snapshot of a shared document. Anyone with this link can read it;
          {canCollaborate
            ? " open it in Inkwell to edit alongside everyone else."
            : " it does not grant editing access."}
        </p>
      </footer>
    </div>
  );
}
