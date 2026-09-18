/**
 * Runtime initialisation hook (Next.js instrumentation.js convention).
 *
 * Sentry is only initialised when a DSN is configured, so a self-hosted
 * instance without one behaves exactly as before and nothing is sent from a
 * developer's machine. The SDK's own calls are no-ops until init runs, which
 * is why every call site is free to just call reportError().
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

/**
 * Next calls this for every uncaught error in a server component, route
 * handler or middleware, with the request context attached — the server-side
 * counterpart to the client boundaries.
 */
export async function onRequestError(...args) {
  const mod = await import('@sentry/nextjs');
  const handler = mod?.captureRequestError ?? mod?.default?.captureRequestError;
  if (typeof handler === 'function') return handler(...args);
  return undefined;
}
