"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Animated heading that reveals text with two combined effects (inspired by
 * remocn's Soft Blur In + Tracking In typography components):
 *
 *  1. Per-character staggered fade-in with blur + upward slide
 *  2. Letter-spacing collapse from wide to normal (tracking in)
 *
 * Uses IntersectionObserver — triggers once when scrolled into view.
 * Pure CSS/React, no Remotion dependency.
 */
export function AnimatedHeading({
  lines,
  className,
  delay = 0,
}) {
  const containerRef = useRef(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStarted(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Build flat character list with line breaks preserved
  const chars = useMemo(() => {
    const result = [];
    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) result.push({ char: "\n", key: `br-${lineIdx}`, lineIdx });
      for (let i = 0; i < line.text.length; i++) {
        result.push({
          char: line.text[i],
          key: `${lineIdx}-${i}`,
          lineIdx,
          charIdx: i,
          bold: line.bold ?? false,
        });
      }
    });
    return result;
  }, [lines]);

  // Total delay offset before this line starts
  let charCounter = 0;

  return (
    <h1
      ref={containerRef}
      className={cn(
        "text-6xl font-light tracking-tight leading-[1.05] sm:text-7xl md:text-8xl",
        className
      )}
      aria-label={lines.map((l) => l.text).join(" ")}
    >
      {chars.map((c) => {
        if (c.char === "\n") {
          return <br key={c.key} />;
        }

        const idx = charCounter++;
        const staggerDelay = delay + idx * 0.035;

        return (
          <span
            key={c.key}
            className={cn(
              "ah-char",
              started && "ah-char-visible",
              c.bold && "font-medium"
            )}
            style={{
              "--ah-delay": `${staggerDelay}s`,
            }}
          >
            {c.char === " " ? "\u00A0" : c.char}
          </span>
        );
      })}
    </h1>
  );
}
