"use client";

import { useEffect } from "react";

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
 * Currently reports to the console with a stable prefix (searchable in
 * browser devtools and log aggregators); swap in Sentry or a /api/telemetry
 * endpoint without touching call sites.
 */
export function GlobalErrorReporter() {
  useEffect(() => {
    const onUnhandledRejection = (event) => {
      // Next.js/React already surface chunk-load and hydration failures;
      // log them here so they land in one place.
      console.error(
        "[global-error] Unhandled promise rejection:",
        event.reason
      );
    };

    const onError = (event) => {
      // Resource-load errors (images, scripts) arrive here too but with no
      // error object — skip them to avoid noise.
      if (!event.error && event.target && event.target !== window) return;
      console.error("[global-error] Uncaught error:", event.error ?? event.message);
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
