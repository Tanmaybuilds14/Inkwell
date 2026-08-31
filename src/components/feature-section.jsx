"use client";

import { ScrollReveal } from "@/components/scroll-reveal";
import { cn } from "@/lib/utils";

/**
 * Full-width feature section with alternating alignment.
 * Left-aligned sections have text on the left, right-aligned on the right.
 * A thin vertical line and label sit above the heading.
 */
export function FeatureSection({ label, heading, body, align = "left", index }) {
  const isRight = align === "right";

  return (
    <section className="border-t border-border">
      <div
        className={cn(
          "mx-auto flex max-w-5xl flex-col gap-12 px-6 py-24 md:flex-row md:items-start md:gap-20 md:py-32 md:px-12",
          isRight && "md:flex-row-reverse"
        )}
      >
        {/* Text content */}
        <ScrollReveal className="flex-1">
          <div className="max-w-md">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            <h2 className="mb-5 text-3xl font-light tracking-tight sm:text-4xl">
              {heading}
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        </ScrollReveal>

        {/* Visual element — a minimal, abstract representation */}
        <ScrollReveal delay={2} className="flex-1">
          <div className="flex items-center justify-center">
            <FeatureVisual index={index} align={align} />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

/**
 * Abstract visual for each feature section.
 * Uses simple geometric shapes to represent the concept.
 */
function FeatureVisual({ index, align }) {
  const visuals = [
    // Real-time sync — overlapping circles
    <div key={0} className="relative h-48 w-48">
      <div className="absolute left-4 top-4 h-32 w-32 rounded-full border-2 border-border" />
      <div className="absolute right-4 top-4 h-32 w-32 rounded-full border-2 border-border" />
      <div className="absolute left-1/2 top-10 -translate-x-1/2 text-[10px] font-medium text-muted-foreground">sync</div>
    </div>,
    // Sharing — nested circles
    <div key={1} className="relative h-48 w-48">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-40 rounded-full border border-border" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-24 rounded-full border border-border" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-border" />
      </div>
    </div>,
    // Organization — grid of lines
    <div key={2} className="h-48 w-48 grid grid-cols-3 gap-3 p-4">
      <div className="col-span-2 rounded-lg border border-border" />
      <div className="rounded-lg border border-border" />
      <div className="rounded-lg border border-border" />
      <div className="rounded-lg border border-border" />
      <div className="col-span-2 rounded-lg border border-border" />
    </div>,
    // Version history — stacked rectangles
    <div key={3} className="relative h-48 w-48">
      <div className="absolute bottom-4 left-4 h-32 w-32 rounded-lg border border-border" />
      <div className="absolute bottom-8 left-8 h-32 w-32 rounded-lg border border-border" />
      <div className="absolute bottom-12 left-12 h-32 w-32 rounded-lg border border-border bg-card" />
    </div>,
    // Presence — overlapping dots
    <div key={4} className="relative h-48 w-48">
      <div className="absolute left-8 top-8 h-10 w-10 rounded-full bg-border" />
      <div className="absolute left-20 top-8 h-10 w-10 rounded-full border-2 border-border bg-background" />
      <div className="absolute left-8 top-20 h-10 w-10 rounded-full border-2 border-border bg-background" />
      <div className="absolute left-20 top-20 h-10 w-10 rounded-full bg-border" />
      <div className="absolute left-14 top-14 h-10 w-10 rounded-full border-2 border-border bg-card shadow-sm" />
    </div>,
    // Self-host — split rectangle
    <div key={5} className="relative h-48 w-48">
      <div className="absolute inset-0 rounded-xl border border-border" />
      <div className="absolute left-0 top-0 h-full w-1/2 rounded-l-xl border-r border-border bg-secondary/50" />
      <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">you</div>
      <div className="absolute left-6 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">data</div>
    </div>,
  ];

  return visuals[index % visuals.length];
}
