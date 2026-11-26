import * as Sentry from '@sentry/nextjs';

/**
 * Edge-runtime Sentry configuration (middleware, edge routes). Imported by
 * src/instrumentation.js only when SENTRY_DSN is set.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
});
