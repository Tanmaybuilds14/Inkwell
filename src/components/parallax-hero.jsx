"use client";

import { useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Feather } from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { AnimatedHeading } from "@/components/animated-heading";

/**
 * Floating description cards that drift at different speeds as the user scrolls,
 * replicating the Mobbin homepage parallax effect.
 * Each card has a short heading describing a core feature.
 */
const FLOATING_CARDS = [
  { heading: "Real-time sync", x: "4%", y: "12%", speed: 0.12, rotate: -3 },
  { heading: "Conflict-free editing", x: "78%", y: "8%", speed: 0.22, rotate: 2 },
  { heading: "Granular permissions", x: "2%", y: "48%", speed: 0.18, rotate: -1 },
  { heading: "Version snapshots", x: "82%", y: "42%", speed: 0.14, rotate: 3 },
  { heading: "Live cursors", x: "10%", y: "78%", speed: 0.28, rotate: -2 },
  { heading: "Folder organization", x: "75%", y: "75%", speed: 0.16, rotate: 1 },
  { heading: "Guest access", x: "88%", y: "28%", speed: 0.24, rotate: -1.5 },
  { heading: "Self-hostable", x: "15%", y: "30%", speed: 0.2, rotate: 2.5 },
  { heading: "Yjs CRDTs", x: "60%", y: "85%", speed: 0.3, rotate: -1 },
  { heading: "Share links", x: "90%", y: "60%", speed: 0.15, rotate: 1.5 },
];

function FloatingCard({ heading, speed, rotate, style }) {
  const ref = useRef(null);

  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (ref.current) {
            const y = window.scrollY * speed;
            const opacity = Math.max(0, 1 - window.scrollY / 800);
            ref.current.style.transform = `translateY(${-y}px) rotate(${rotate}deg)`;
            ref.current.style.opacity = opacity;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [speed, rotate]);

  return (
    <div
      ref={ref}
      className="absolute hidden md:flex items-center will-change-transform"
      style={style}
    >
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-md px-5 py-3 shadow-sm">
        <span className="text-sm font-medium text-foreground/80">{heading}</span>
      </div>
    </div>
  );
}

export function ParallaxHero() {
  const cards = useMemo(
    () =>
      FLOATING_CARDS.map((c) => ({
        ...c,
        style: {
          left: c.x,
          top: c.y,
        },
      })),
    []
  );

  return (
    <section className="relative flex flex-col items-center overflow-hidden px-6 pt-32 pb-40 text-center md:pt-48 md:pb-52">
      {/* Animated dot-grid + gradient background */}
      <AnimatedBackground />

      {/* Floating parallax cards */}
      {cards.map((card) => (
        <FloatingCard
          key={card.heading}
          heading={card.heading}
          speed={card.speed}
          rotate={card.rotate}
          style={card.style}
        />
      ))}

      {/* Central hero content — large, editorial typography */}
      <div className="relative z-10 max-w-3xl">
        <p className="mb-8 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          A collaborative document platform
        </p>
        <AnimatedHeading
          lines={[
            { text: "Write together," },
            { text: "in real time.", bold: true },
          ]}
          delay={0.4}
        />
        <p className="mx-auto mt-8 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
          Create, organize, share with granular permissions, and co-edit live
          with conflict-free sync. Open source. Self-hostable.
        </p>
        <div className="mt-12 flex items-center justify-center gap-3">
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
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="text-xs tracking-widest uppercase text-muted-foreground/50">
          Scroll
        </span>
        <div className="h-8 w-px bg-border animate-pulse" />
      </div>
    </section>
  );
}
