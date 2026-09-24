import { cn } from "@/lib/utils";

/**
 * One numbered step of the walkthrough: the number in a rail on the left, the
 * instructions in the middle and the matching mockup beside them. On mobile the
 * rail collapses to a row and the mockup stacks under the text, full width.
 */
export function WalkthroughStep({ step, title, body, mockup, note }) {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-10 md:px-12 md:py-16">
        <div className="relative flex items-center gap-3 md:block">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-landing-muted">
            {step}
          </span>
          {/* A hairline rail that ties the numbers into one sequence. */}
          <span
            aria-hidden="true"
            className="absolute top-12 left-[1.125rem] hidden h-[calc(100%-2rem)] w-px bg-border md:block"
          />
          <span aria-hidden="true" className="h-px flex-1 bg-border md:hidden" />
        </div>

        <div>
          <h3 className="text-xl font-medium tracking-tight text-foreground">
            {title}
          </h3>
          <p className="landing-body mt-3">{body}</p>
          {note}
        </div>

        <div className={cn("w-full")}>{mockup}</div>
      </div>
    </section>
  );
}
