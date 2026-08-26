import { clerkMiddleware } from '@clerk/nextjs/server';

// Next.js 16: middleware.js was renamed to proxy.js.
// Authenticates every request; route protection happens here + server-side in each API route/page.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
