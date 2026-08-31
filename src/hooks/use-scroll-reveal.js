"use client";

import { useEffect, useRef } from "react";

/**
 * Hook that attaches Intersection Observer to a container's children.
 * Elements with `.reveal` or `.reveal-stagger` classes fade-in-up when
 * they enter the viewport.
 *
 * Usage:
 *   const containerRef = useScrollReveal();
 *   return <div ref={containerRef}>...</div>;
 */
export function useScrollReveal(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const elements = node.querySelectorAll(".reveal, .reveal-stagger");
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: options.threshold ?? 0.1,
        rootMargin: options.rootMargin ?? "0px 0px -60px 0px",
      }
    );

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [options.threshold, options.rootMargin]);

  return ref;
}
