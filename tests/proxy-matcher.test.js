/**
 * Regression test for the proxy matcher and Clerk's Frontend API proxy path.
 *
 * Symptom reported in production: the sign-in page never rendered. The browser
 * console showed
 *   Clerk: Failed to load Clerk JS, failed to load script:
 *   /__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js
 *   (code="failed_to_load_clerk_js")
 *
 * Root cause: on Vercel production with a `*.vercel.app` host and a production
 * publishable key, Clerk auto-enables its Frontend API proxy (see
 * getAutoProxyUrlFromEnvironment / shouldAutoProxy in @clerk/shared, and the
 * frontendApiProxy branch in clerkMiddleware) and injects `proxyUrl:
 * '/__clerk'` into ClerkProvider. ClerkJS then loads its own bundle from the
 * same origin — and clerkMiddleware is what forwards that request to Clerk's
 * Frontend API.
 *
 * But the matcher here is copied from Clerk's static-file example, whose
 * negative lookahead rejects *every* path ending in `.js`:
 *   '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|...)).*)'
 * `…/dist/clerk.browser.js` matches that rejection, so the request never
 * reached the proxy, nothing forwarded it upstream, Next.js answered with its
 * 404 page, and the script element fired `error`. Clerk's documented matcher
 * adds a third entry for exactly this reason: '/__clerk/(.*)'.
 *
 * The matcher entries are already regular expressions (not `/foo/:id` route
 * patterns), so Next compiles each of them to an anchored regex tested against
 * the pathname; anchoring them by hand reproduces the compiled behaviour the
 * router applies for these two shapes. What is pinned is which paths reach the
 * proxy, which is the only thing that separates working sign-in from the bug.
 */
import { describe, it, expect } from 'vitest';
import { config } from '../src/proxy.js';

/** Next tests each matcher against the pathname, anchored; these entries are regexes already. */
const reachable = (pathname) =>
  config.matcher.some((entry) => new RegExp(`^${entry}$`).test(pathname));

describe('proxy matcher — Clerk frontend API proxy path', () => {
  // The exact URL from the production error report.
  it('routes the ClerkJS bundle through the proxy', () => {
    expect(reachable('/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).toBe(true);
  });

  it('routes Clerk API calls made by the same proxy', () => {
    expect(reachable('/__clerk/v1/client?__clerk_api_version=2025-04-10')).toBe(true);
    expect(reachable('/__clerk/v1/environment')).toBe(true);
  });

  it('keeps the static-file entry from swallowing the proxy path', () => {
    // The bug in one assertion: the first matcher alone rejects this path.
    const [staticFiles] = config.matcher;
    expect(new RegExp(`^${staticFiles}$`).test('/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js')).toBe(
      false,
    );
  });
});

describe('proxy matcher — everything else is unchanged', () => {
  it('still skips Next.js internals and static files', () => {
    expect(reachable('/_next/static/chunks/2-pl2jbkne1fu.js')).toBe(false);
    expect(reachable('/logo.svg')).toBe(false);
    expect(reachable('/fonts/outfit.woff2')).toBe(false);
  });

  it('still runs for pages, API routes and share links', () => {
    expect(reachable('/documents')).toBe(true);
    expect(reachable('/sign-in')).toBe(true);
    expect(reachable('/share/abcdef0123456789abcdef0123456789')).toBe(true);
    expect(reachable('/api/documents/doc1/share')).toBe(true);
  });
});
