"use client";

import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/animated-background";
import { AnimatedHeading } from "@/components/animated-heading";
import { GitHubIcon } from "@/components/github-icon";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The five capability pills that drift around the hero.
 *
 * Each one is pinned to a far edge — both sides, top to bottom — so its closest
 * approach to the headline block stays comfortably past ~120px at 1366px and
 * wider (the headline column is 768px wide, which leaves roughly 300px of gutter
 * either side). Within that envelope each pill drifts ±6–10px on its own slow,
 * staggered cycle so the group never pulses in unison.
 */
const FLOATING_PILLS = [
  {
    label: "Real-time sync",
    position: "left-3 top-[7%]",
    x: "8px",
    y: "-8px",
    duration: "9s",
    delay: "0s",
  },
  {
    label: "Conflict-free editing",
    position: "right-3 top-[15%]",
    x: "-7px",
    y: "9px",
    duration: "10s",
    delay: "1.2s",
  },
  {
    label: "Version snapshots",
    position: "left-2 top-[46%]",
    x: "9px",
    y: "6px",
    duration: "8s",
    delay: "0.6s",
  },
  {
    label: "Guest access",
    position: "right-4 top-[53%]",
    x: "-8px",
    y: "-7px",
    duration: "7.5s",
    delay: "2s",
  },
  {
    label: "Self-hostable",
    position: "left-4 bottom-[9%]",
    x: "7px",
    y: "-9px",
    duration: "8.5s",
    delay: "1.6s",
  },
];

/**
 * `primaryCta` is owned by the page (a server component) rather than rendered
 * here: Clerk's <Show> needs the server's auth state, and inside this client
 * boundary it would stay empty until clerk-js finished loading.
 */
export function ParallaxHero({ primaryCta }) {
  return (
    <section className="relative flex flex-col items-center overflow-hidden px-6 pt-16 pb-24 text-center md:pt-20 md:pb-28">
      {/* Animated dot-grid + gradient background */}
      <AnimatedBackground />

      {/*
        Floating pills. Hidden below xl on purpose: the guarantee they carry is
        that none of them comes within ~120px of the headline block, and below
        1280px there is no longer a gutter wide enough to honour it (measured:
        ~40–80px at 1024px, 170px+ from 1280px up).
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden xl:block"
      >
        {FLOATING_PILLS.map((pill) => (
          <div key={pill.label} className={cn("absolute", pill.position)}>
            <div
              className="pill-drift rounded-2xl border border-border bg-card/70 px-4 py-2 shadow-sm backdrop-blur-md"
              style={{
                "--drift-x": pill.x,
                "--drift-y": pill.y,
                "--drift-duration": pill.duration,
                "--drift-delay": pill.delay,
              }}
            >
              <span className="text-xs font-medium whitespace-nowrap text-landing-muted">
                {pill.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Central hero content — large, editorial typography */}
      <div className="relative z-10 max-w-3xl">
        <p className="mb-6 text-sm font-medium uppercase tracking-[0.2em] text-landing-muted">
          A collaborative document platform
        </p>
        <AnimatedHeading
          lines={[
            { text: "Write together," },
            { text: "in real time.", bold: true },
          ]}
          delay={0.4}
        />
        <p className="landing-body mx-auto mt-6">
          Create, organize, share with granular permissions, and co-edit live
          with conflict-free sync. Open source. Self-hostable.
        </p>
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          {primaryCta}
          <Button
            variant="outline"
            size="lg"
            asChild
            className="w-full sm:w-auto"
          >
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon />
              View on GitHub
            </a>
          </Button>
        </div>
      </div>

      {/* Scroll hint — sits in the hero's own padding, not in a band of its own */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <span className="text-xs tracking-widest uppercase text-landing-muted">
          Scroll
        </span>
        <div className="h-8 w-px bg-border animate-pulse" />
      </div>
    </section>
  );
}
