"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Feather } from "lucide-react";

/**
 * Floating cards that drift at different speeds as the user scrolls,
 * replicating the Mobbin homepage parallax effect.
 */
const CARDS = [
  { label: "CRDT-powered sync", top: "8%", left: "5%", speed: 0.15, size: "sm" },
  { label: "Real-time cursors", top: "5%", right: "8%", speed: 0.25, size: "sm" },
  { label: "Share links", top: "35%", left: "3%", speed: 0.35, size: "md" },
  { label: "Folder organization", top: "30%", right: "5%", speed: 0.1, size: "md" },
  { label: "Version snapshots", top: "60%", left: "8%", speed: 0.2, size: "sm" },
  { label: "Guest access", top: "55%", right: "10%", speed: 0.3, size: "sm" },
  { label: "Yjs + Redis", top: "75%", left: "15%", speed: 0.4, size: "md" },
  { label: "Self-hostable", top: "70%", right: "15%", speed: 0.18, size: "sm" },
];

function FloatingCard({ label, speed, size, style }) {
  const ref = useRef(null);

  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (ref.current) {
            const y = window.scrollY * speed;
            ref.current.style.transform = `translateY(${-y}px)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [speed]);

  const sizeClasses = size === "md"
    ? "px-5 py-3 text-sm"
    : "px-4 py-2 text-xs";

  return (
    <div
      ref={ref}
      className="absolute hidden md:flex items-center rounded-full border border-border bg-card/80 backdrop-blur-sm shadow-sm will-change-transform"
      style={style}
    >
      <span className={sizeClasses}>{label}</span>
    </div>
  );
}

export function ParallaxHero() {
  return (
    <section className="relative flex flex-col items-center overflow-hidden px-6 pt-28 pb-32 text-center md:pt-40 md:pb-40">
      {/* Floating parallax cards */}
      {CARDS.map((card) => {
        const { label, speed, size, top, left, right } = card;
        return (
          <FloatingCard
            key={label}
            label={label}
            speed={speed}
            size={size}
            style={{ top, left, right }}
          />
        );
      })}

      {/* Central hero content — stays fixed, doesn't move with scroll */}
      <div className="relative z-10">
        <p className="mb-6 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          A collaborative document platform
        </p>
        <h1 className="max-w-3xl text-5xl font-light tracking-tight sm:text-6xl md:text-7xl">
          Write together,
          <br />
          <span className="font-medium">in real time.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
          Create, organize, share with granular permissions, and co-edit live
          with conflict-free sync. Open source. Self-hostable.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Show when="signed-out">
            <Button asChild size="lg">
              <Link href="/sign-up">Get started</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild size="lg">
              <Link href="/documents">Open your documents</Link>
            </Button>
          </Show>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <Feather className="h-5 w-5 text-muted-foreground/40" strokeWidth={1.5} />
      </div>
    </section>
  );
}
