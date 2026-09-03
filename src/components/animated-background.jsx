"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Subtle animated dot-grid + gradient background.
 *  - Drifting gradient blob (soft radial gradient)
 *  - Gentle floating dots that drift slowly
 *  - Adds depth without competing with the hero content
 */
export function AnimatedBackground({ className }) {
  const canvasRef = useRef(null);
  const dotsRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Generate dots once (client-only, avoids render purity lint)
    if (dotsRef.current.length === 0) {
      const arr = [];
      for (let i = 0; i < 48; i++) {
        arr.push({
          x: Math.random(),
          y: Math.random(),
          r: 1.5 + Math.random() * 2,
          dx: (Math.random() - 0.5) * 0.00015,
          dy: (Math.random() - 0.5) * 0.00015,
          opacity: 0.08 + Math.random() * 0.18,
          phase: Math.random() * Math.PI * 2,
        });
      }
      dotsRef.current = arr;
    }

    const ctx = canvas.getContext("2d");
    let frame;
    let elapsed = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (time) => {
      elapsed = time * 0.001;
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);

      ctx.clearRect(0, 0, w, h);

      // Drifting gradient blob — soft, large, slow
      const blobX = w * 0.5 + Math.sin(elapsed * 0.08) * w * 0.15;
      const blobY = h * 0.4 + Math.cos(elapsed * 0.06) * h * 0.1;
      const blobR = Math.min(w, h) * 0.55;

      const grad = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR);
      const isDark =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark");

      if (isDark) {
        grad.addColorStop(0, "rgba(120, 113, 108, 0.07)");
        grad.addColorStop(1, "rgba(12, 10, 9, 0)");
      } else {
        grad.addColorStop(0, "rgba(214, 211, 209, 0.22)");
        grad.addColorStop(1, "rgba(250, 250, 249, 0)");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Floating dots
      for (const dot of dotsRef.current) {
        dot.x += dot.dx;
        dot.y += dot.dy;
        if (dot.x < -0.05) dot.x = 1.05;
        if (dot.x > 1.05) dot.x = -0.05;
        if (dot.y < -0.05) dot.y = 1.05;
        if (dot.y > 1.05) dot.y = -0.05;

        const px = dot.x * w;
        const py = dot.y * h;
        const pulse = Math.sin(elapsed * 0.5 + dot.phase) * 0.04;
        const alpha = Math.max(0, dot.opacity + pulse);

        ctx.beginPath();
        ctx.arc(px, py, dot.r, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(168, 162, 158, ${alpha})`
          : `rgba(120, 113, 108, ${alpha})`;
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
