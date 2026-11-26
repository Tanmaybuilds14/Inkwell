"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readReducedMotionOnServer() {
  return false;
}

/**
 * True when the visitor asked for reduced motion — read live, so flipping the
 * OS setting reaches a component without a reload.
 *
 * useSyncExternalStore rather than a matchMedia call inside an effect: the
 * server snapshot keeps hydration honest (no mismatch, no flash of a
 * half-animated state), which matters because every consumer of this hook
 * renders a *different* tree when motion is reduced.
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    readReducedMotion,
    readReducedMotionOnServer
  );
}
