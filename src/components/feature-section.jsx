"use client";

import { useCallback, useState } from "react";
import { TypewriterHeading } from "@/components/typewriter-heading";
import { cn } from "@/lib/utils";

/** The four collaborator hues, cycled down the page's eyebrows. */
const EYEBROW_COLORS = ["collab-1", "collab-2", "collab-3", "collab-4"];

/**
 * One feature: eyebrow, typed heading, body copy, and the mockup that fills the
 * column opposite the text. Alignment alternates per section, so on desktop the
 * mockup and the words swap sides down the page — and on mobile the text always
 * comes first with the mockup stacked full width underneath it.
 *
 * The body does not wait for the typewriter: `TypewriterHeading` reports the
 * moment typing starts and the copy fades in 150ms behind it.
 */
export function FeatureSection({
  label,
  heading,
  body,
  align = "left",
  index = 0,
  mockup,
  link,
}) {
  const isRight = align === "right";
  const [bodyVisible, setBodyVisible] = useState(false);
  const revealBody = useCallback(() => setBodyVisible(true), []);

  return (
    <section className="border-t border-border">
      <div
        className={cn(
          "mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16 md:flex-row md:items-center md:gap-16 md:px-12 md:py-20",
          isRight && "md:flex-row-reverse"
        )}
      >
        <div className="w-full flex-1">
          <p
            className={cn(
              "mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-landing-muted",
              EYEBROW_COLORS[index % EYEBROW_COLORS.length]
            )}
          >
            <span
              aria-hidden="true"
              className="collab-dot h-1.5 w-1.5 shrink-0 rounded-full"
            />
            {label}
          </p>

          <TypewriterHeading
            text={heading}
            onStart={revealBody}
            className="mb-4 text-3xl font-light tracking-tight sm:text-4xl"
          />

          <div
            className={cn(
              "transition-opacity duration-500 ease-out",
              bodyVisible ? "opacity-100" : "opacity-0"
            )}
            style={{ transitionDelay: bodyVisible ? "150ms" : "0ms" }}
          >
            <p className="landing-body">{body}</p>
            {link ? (
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                {link.label}
              </a>
            ) : null}
          </div>
        </div>

        <div className="w-full flex-1">{mockup}</div>
      </div>
    </section>
  );
}
