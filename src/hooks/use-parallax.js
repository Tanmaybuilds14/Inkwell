"use client";

import { useEffect, useState } from "react";

/**
 * Returns the current scroll Y position, updated on requestAnimationFrame.
 * Use this to drive parallax transforms on elements.
 *
 * Usage:
 *   const scrollY = useScrollY();
 *   <div style={{ transform: `translateY(${scrollY * 0.3}px)` }}>
 */
export function useScrollY() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return scrollY;
}
