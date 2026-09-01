"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Heading that types out its text character-by-character when scrolled into view.
 * Shows a blinking cursor while typing; the cursor disappears once complete.
 */
export function TypewriterHeading({
  text,
  className,
  speed = 45,
  delay = 0,
}) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  // Trigger once the element enters the viewport
  useEffect(() => {
    const node = ref.current;
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
      { threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Typewriter loop
  useEffect(() => {
    if (!started) return;
    if (displayed.length >= text.length) return;

    const id = setTimeout(() => {
      setDisplayed(text.slice(0, displayed.length + 1));
    }, delay || speed);

    return () => clearTimeout(id);
  }, [started, displayed, text, speed, delay]);

  const done = displayed.length >= text.length;

  return (
    <h2
      ref={ref}
      className={cn(
        "mb-5 text-3xl font-light tracking-tight sm:text-4xl",
        className
      )}
    >
      {displayed}
      {started && !done && <span className="tw-cursor" />}
    </h2>
  );
}
