import * as Sentry from '@sentry/nextjs';

/**
 * Node-runtime Sentry configuration. Imported by src/instrumentation.js only
 * when SENTRY_DSN is set.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Errors are always captured; traces are sampled because they are the
  // expensive part and the sync path is already observable via telemetry.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // Documents are the product's sensitive data: keep user identity and
  // request bodies out of reports.
  sendDefaultPii: false,
});
