import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isShareTokenShape, shareTokenFromPath } from '../shared/share-token.js';

/**
 * A path that matches no route, so the router itself produces the 404 — status
 * line included — with the app's not-found page. This is a rewrite, not a
 * redirect, so the visitor's URL never changes.
 */
const NOT_FOUND_TARGET = '/__inkwell/not-found';

/**
 * Refuse a `/share/<token>` request before it is rendered when the token opens
 * nothing, returning the rewrite that produces a real 404 — or null to let the
 * request through.
 *
 * Why this lives in the proxy rather than in the page: a dynamic route streams
 * its response, the status line goes out with the first byte, and Next.js
 * cannot change it afterwards. `notFound()` from the page (or its
 * generateMetadata) still renders the right UI, but the HTTP status is already
 * 200 by then — documented behaviour, not a bug, and the reason the docs point
 * at the proxy for "I need a 404 status" (see the note on the share page). The
 * page keeps its own `notFound()` for correctness of the body; this is what
 * makes the status line true.
 *
 * Cost: one indexed lookup of the token, selecting an id and nothing else, and
 * only for `/share/<token>` requests. If the database cannot be reached the
 * request is passed through rather than rewritten — a database blip must not
 * turn a working link into a 404, and the page will surface the real failure.
 */
async function denyUnusableShareToken(request) {
  const token = shareTokenFromPath(request.nextUrl.pathname);
  if (!token) return null;
  // Malformed tokens need no database at all: scanners and typos are the
  // common case, and the shape check is synchronous.
  if (!isShareTokenShape(token)) return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url));

  try {
    // Imported lazily so the database layer is only ever loaded for this path.
    const { shareTokenExists } = await import('@/lib/share-page');
    if (await shareTokenExists(token)) return null;
  } catch (err) {
    console.error('[proxy] share-token pre-flight failed, serving the page instead:', err.message);
    return null;
  }

  return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url));
}

// Next.js 16: middleware.js was renamed to proxy.js.
// Authenticates every request; route protection happens here + server-side in each API route/page.
//
// On Vercel production with a `*.vercel.app` host and a production publishable
// key, Clerk auto-enables its Frontend API proxy and serves clerk-js from the
// same origin at `/__clerk/*`. That only works if the matcher below lets those
// requests reach this middleware; see the note on the `/__clerk/(.*)` entry.
export default clerkMiddleware(async (_auth, request) => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const denied = await denyUnusableShareToken(request);
    if (denied) return denied;
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Always run for Clerk-specific frontend API routes. The first matcher skips
    // every path ending in `.js`, which includes Clerk's own proxy route
    // (`/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js`) — so without this
    // entry the middleware never sees those requests, the proxy never forwards
    // them to Clerk's Frontend API, and clerk-js fails to load with
    // `failed_to_load_clerk_js`. See the matcher in Clerk's clerkMiddleware docs.
    '/__clerk/(.*)',
  ],
};
