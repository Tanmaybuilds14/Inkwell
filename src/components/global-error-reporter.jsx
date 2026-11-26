"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-reporting";

/**
 * Global client-side error catcher mounted once in the root layout.
 * Complements error.js boundaries: those only catch render-time errors,
 * while this also captures:
 *   - unhandled promise rejections (fetch failures outside try/catch)
 *   - window.onerror (unexpected runtime errors)
 *   - uncaught errors in error boundaries via `onunhandledrejection`-style
 *     reporting hooks (React 19 reports recoverable errors through
 *     onUncaughtError / onCaughtError on the root — see below).
 *
 * Reports through lib/error-reporting: the console always (stable `[error]`
 * prefix + scope, searchable in devtools and log aggregators) and Sentry when
 * a public DSN is configured.
 */
export function GlobalErrorReporter() {
  useEffect(() => {
    const onUnhandledRejection = (event) => {
      // Next.js/React already surface chunk-load and hydration failures;
      // report them here so they land in one place.
      reportError(event.reason, { scope: "global-error/unhandled-rejection" });
    };

    const onError = (event) => {
      // Resource-load errors (images, scripts) arrive here too but with no
      // error object — skip them to avoid noise.
      if (!event.error && event.target && event.target !== window) return;
      reportError(event.error ?? event.message, { scope: "global-error/uncaught" });
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
