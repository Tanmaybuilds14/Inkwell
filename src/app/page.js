import { ScrollReveal } from "@/components/scroll-reveal";
import { ParallaxHero } from "@/components/parallax-hero";
import { FeatureSection } from "@/components/feature-section";
import { TypewriterHeading } from "@/components/typewriter-heading";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PrimaryCta } from "@/components/primary-cta";
import { GITHUB_URL } from "@/lib/site";
import { CoEditingMockup } from "@/components/mockups/co-editing-mockup";
import { SharingMockup } from "@/components/mockups/sharing-mockup";
import { OrganizationMockup } from "@/components/mockups/organization-mockup";
import { VersionHistoryMockup } from "@/components/mockups/version-history-mockup";
import { SelfHostMockup } from "@/components/mockups/self-host-mockup";

/**
 * The feature tour. Five sections, each with a mockup filling the column the
 * words are not using — "Live Presence" folded into co-editing, because two
 * carets typing in one paragraph is the same story.
 */
const SECTIONS = [
  {
    label: "Real-Time Co-Editing",
    heading: "No conflicts. No overwrites.",
    body: "Everyone edits the same document at once, and every change merges cleanly, even in the same sentence. Colored cursors show who's where, and guests can join from a link without an account.",
    align: "left",
    mockup: <CoEditingMockup />,
  },
  {
    label: "Sharing & Permissions",
    heading: "Control who sees what.",
    body: "Invite teammates by email or create a public link. Choose Owner, Editor, Commenter, or Viewer, and revoke access instantly.",
    align: "right",
    mockup: <SharingMockup />,
  },
  {
    label: "Document Organization",
    heading: "Keep everything in its place.",
    body: "Nested folders, quick search, and a 30-day trash, so nothing is lost by accident.",
    align: "left",
    mockup: <OrganizationMockup />,
  },
  {
    label: "Version History",
    heading: "Go back to any point in time.",
    body: "Inkwell saves snapshots as you write. Preview any version and restore it in one click, and restores can be undone too.",
    align: "right",
    mockup: <VersionHistoryMockup />,
  },
  {
    label: "Self-Hostable",
    heading: "Your data, your server.",
    body: "Run Inkwell on your own infrastructure: a Next.js app, a WebSocket sync service, PostgreSQL, and Redis. Docker Compose files are included.",
    align: "left",
    mockup: <SelfHostMockup />,
    // Per the landing-page brief this points at the repository; the how-it-works
    // page carries the full walkthrough at /how-it-works#self-hosting.
    link: { label: "Read the setup guide →", href: GITHUB_URL },
  },
];

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteHeader />

      {/* Hero with floating drifting pills */}
      <ParallaxHero primaryCta={<PrimaryCta />} />

      {/* Feature sections — each one pairs its copy with a live-looking mockup */}
      {SECTIONS.map((section, index) => (
        <FeatureSection key={section.label} {...section} index={index} />
      ))}

      {/* CTA */}
      <ScrollReveal>
        <section className="border-t border-border px-6 py-16 text-center md:py-20">
          <TypewriterHeading
            text="Ready to start?"
            className="text-4xl font-light tracking-tight sm:text-5xl"
          />
          <p className="landing-body mx-auto mt-4">
            Create your first document in seconds.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <PrimaryCta />
          </div>
        </section>
      </ScrollReveal>

      <SiteFooter />
    </main>
  );
}
