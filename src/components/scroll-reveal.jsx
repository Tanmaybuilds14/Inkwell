"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps children in a container that fades in when scrolled into view.
 * Uses Intersection Observer — no JS animation libraries needed.
 */
export function ScrollReveal({ children, className, delay = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "reveal",
        delay && `reveal-delay-${delay}`,
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Wraps a grid/list container whose direct children animate in sequence.
 * The container itself is NOT hidden — only the children are animated.
 * Each child gets the `reveal-stagger` class with incremental delay.
 */
export function ScrollRevealStagger({ children, className, delay = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const items = node.querySelectorAll(":scope > *");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -20px 0px" }
    );

    items.forEach((child, i) => {
      child.classList.add("reveal-stagger");
      child.style.transitionDelay = `${i * 0.1 + delay * 0.1}s`;
      observer.observe(child);
    });

    return () => observer.disconnect();
  }, [delay]);

  // Note: no `reveal` class on the container — it stays visible.
  // Only the children animate in with staggered timing.
  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
