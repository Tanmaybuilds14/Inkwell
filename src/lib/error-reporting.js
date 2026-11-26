/**
 * One funnel for caught errors and telemetry breadcrumbs: Sentry when a DSN is
 * configured, the console always.
 *
 * Every call site used to say "wire an error-reporting service here (e.g.
 * Sentry)". This is that wiring, in one place, so the three error boundaries
 * and the telemetry sink cannot drift apart.
 *
 * WHY THE FUNCTION LOOKUP INSTEAD OF `Sentry.captureException`:
 * @sentry/nextjs v10 resolves to `build/esm/index.server.js` under the node
 * condition, and that file is CJS — so under ESM the named-export surface is
 * only the names cjs-module-lexer can detect statically (~30 of them, and
 * `captureException`/`addBreadcrumb` are not among them). They hang off the
 * interop `default` object. Bundlers usually paper over that; "usually" is
 * not good enough INSIDE an error handler, where a TypeError would replace
 * the very error being reported. So resolve the function, or do nothing.
 *
 * The SDK is imported lazily: report-and-forget is off the critical path, and
 * a request that never errors should not pay for the SDK at all.
 */
const DSN_KEYS = ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'];

/** True when this runtime has somewhere to report to. */
export function isReportingConfigured() {
  return DSN_KEYS.some((key) => Boolean(process.env[key]));
}

const apiCache = new Map();

async function sentryFunction(name) {
  if (!apiCache.has(name)) {
    let resolved = null;
    try {
      const mod = await import('@sentry/nextjs');
      const candidate = mod?.[name] ?? mod?.default?.[name];
      resolved = typeof candidate === 'function' ? candidate : null;
    } catch {
      resolved = null; // Never let reporting break the caller.
    }
    apiCache.set(name, resolved);
  }
  return apiCache.get(name);
}

function fireAndForget(name, invocation) {
  if (!isReportingConfigured()) return;
  sentryFunction(name)
    .then((fn) => fn?.(...invocation))
    .catch(() => {});
}

/**
 * Report a caught error. Always logs locally; additionally forwards to Sentry
 * with the scope as a tag so reports can be filtered per boundary.
 */
export function reportError(error, { scope = 'app', ...extra } = {}) {
  console.error(`[error] ${scope}:`, error);
  fireAndForget('captureException', [error, { tags: { scope }, extra }]);
}

/**
 * Attach a telemetry event to the current request as a breadcrumb, so the
 * events leading up to a failure travel with the error report instead of
 * being lost in stdout.
 */
export function addTelemetryBreadcrumb(event, payload = {}) {
  fireAndForget('addBreadcrumb', [
    { category: 'telemetry', message: event, level: 'info', data: payload },
  ]);
}
