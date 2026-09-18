/**
 * Browser-side initialisation hook (Next.js instrumentation-client.js
 * convention). The client bundle cannot read SENTRY_DSN — only NEXT_PUBLIC_*
 * is inlined at build time — so the browser has its own key, and it is
 * optional: with no key, client errors still reach the console.
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  // Dynamic so the SDK is not in the critical bundle for the common case of
  // a deployment that does not report anywhere.
  import('@sentry/nextjs')
    .then((Sentry) => {
      const init = Sentry?.init ?? Sentry?.default?.init;
      init?.({
        dsn: DSN,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        sendDefaultPii: false,
      });
    })
    .catch(() => {});
}
