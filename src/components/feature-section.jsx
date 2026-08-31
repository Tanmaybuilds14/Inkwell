"use client";

import { ScrollReveal } from "@/components/scroll-reveal";
import { cn } from "@/lib/utils";

/**
 * Full-width feature section with alternating alignment.
 * Pure text — no decorative visuals. The focus is on the description.
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

        {/* Empty spacer for alignment — keeps the alternating rhythm */}
        <div className="hidden flex-1 md:block" />
      </div>
    </section>
  );
}
