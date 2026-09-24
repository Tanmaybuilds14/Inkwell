import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/github-icon";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PrimaryCta } from "@/components/primary-cta";
import { TypewriterHeading } from "@/components/typewriter-heading";
import { ScrollReveal } from "@/components/scroll-reveal";
import { WalkthroughStep } from "@/components/how-it-works/walkthrough-step";
import { PermissionsMatrix } from "@/components/how-it-works/permissions-matrix";
import { SelfHostQuickstart } from "@/components/how-it-works/self-host-quickstart";
import { Faq } from "@/components/how-it-works/faq";
import { NewDocumentMockup } from "@/components/mockups/new-document-mockup";
import { SharingMockup } from "@/components/mockups/sharing-mockup";
import { CoEditingMockup } from "@/components/mockups/co-editing-mockup";
import { OrganizationMockup } from "@/components/mockups/organization-mockup";
import { VersionHistoryMockup } from "@/components/mockups/version-history-mockup";
import { SelfHostMockup } from "@/components/mockups/self-host-mockup";

export const metadata = {
  title: "How it works",
  description:
    "How to use Inkwell: create a document, invite your team, edit live together, organize folders, restore any version, and run the whole stack on your own server.",
};

const ACCENTS = ["collab-1", "collab-2", "collab-3", "collab-4"];

const JUMP_LINKS = [
  { label: "Walkthrough", href: "#walkthrough" },
  { label: "Permissions", href: "#permissions" },
  { label: "Self-hosting", href: "#self-hosting" },
  { label: "FAQ", href: "#faq" },
];

const STEPS = [
  {
    step: "01",
    title: "Create your first document",
    body: "Sign in and press New document on the dashboard. Give it a title, start from a blank page or a template, and it saves as you type — there is no Save button to remember and nothing to email yourself.",
    mockup: <NewDocumentMockup />,
  },
  {
    step: "02",
    title: "Invite your team",
    body: "Open Share and invite people by email, choosing a role for each one: Owner, Editor, Commenter or Viewer. Prefer a link? Switch on the public link and anyone holding it can join without an account. Revoke it and their access stops instantly.",
    mockup: <SharingMockup />,
    note: "Only the Owner can change someone's role or revoke the link.",
  },
  {
    step: "03",
    title: "Write together, live",
    body: "Everyone you invited can edit the same paragraph at the same moment. Colored cursors and name tags show who is where, and the avatar stack in the header lists who is in the document right now. There is nothing to coordinate — edits merge as they arrive.",
    mockup: <CoEditingMockup />,
  },
  {
    step: "04",
    title: "Keep everything findable",
    body: "Group documents into nested folders and search by title. Owned by me and Shared with me keep your work separate from everyone else's. Deleting a document moves it to Trash for 30 days, remembering the folder it came from so a restore puts it back.",
    mockup: <OrganizationMockup />,
  },
  {
    step: "05",
    title: "Never lose a good draft",
    body: "Open Version history to walk back through the timeline, preview any snapshot as rendered HTML, and restore the one you want. A restore is a hot-swap: everyone in the document sees the new state without reloading, and what you replaced is saved so the restore can be undone.",
    mockup: <VersionHistoryMockup />,
  },
  {
    step: "06",
    title: "Run it on your own server",
    body: "Inkwell is yours to run: point it at a PostgreSQL database and a Redis, start the Next.js app and the sync service, and share the URL. Both processes enforce the same permissions against the same database.",
    mockup: <SelfHostMockup />,
    note: "Nothing here depends on a hosted collaboration vendor — the commands are below.",
  },
];

function SectionIntro({ eyebrow, accentIndex, heading, body }) {
  return (
    <div>
      <p
        className={cn(
          "mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-landing-muted",
          ACCENTS[accentIndex % ACCENTS.length]
        )}
      >
        <span
          aria-hidden="true"
          className="collab-dot h-1.5 w-1.5 shrink-0 rounded-full"
        />
        {eyebrow}
      </p>
      <TypewriterHeading
        text={heading}
        className="text-3xl font-light tracking-tight sm:text-4xl"
      />
      <p className="landing-body mt-3">{body}</p>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteHeader />

      {/* What this page is */}
      <section className="px-6 pt-12 pb-14 text-center md:pt-16 md:pb-16">
        <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-landing-muted">
          How Inkwell works
        </p>
        <h1 className="text-4xl font-light tracking-tight sm:text-5xl md:text-6xl">
          Start writing, together
        </h1>
        <p className="landing-body mx-auto mt-5">
          Inkwell is a collaborative document editor you can host yourself.
          Here is the whole loop — create a document, invite people, edit it at
          the same time, organize it, roll it back — plus the permission model
          and the commands that put it on your own server.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <PrimaryCta />
          <Button variant="outline" size="lg" asChild className="w-full sm:w-auto">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon />
              View on GitHub
            </a>
          </Button>
        </div>
        <nav
          aria-label="On this page"
          className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm"
        >
          {JUMP_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-landing-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </section>

      {/* The walkthrough */}
      <section id="walkthrough" className="scroll-mt-8">
        <div className="mx-auto max-w-5xl px-6 pt-14 pb-6 md:px-12 md:pt-16">
          <SectionIntro
            eyebrow="Walkthrough"
            accentIndex={0}
            heading="Set it up in six steps"
            body="Everything below happens in the browser unless a step says otherwise. The panels beside each step are the real interface, drawn in HTML and CSS."
          />
        </div>
        {STEPS.map((step) => (
          <WalkthroughStep key={step.step} {...step} />
        ))}
      </section>

      {/* Permissions */}
      <section
        id="permissions"
        className="scroll-mt-8 border-t border-border"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-12 md:py-16">
          <SectionIntro
            eyebrow="Permissions"
            accentIndex={1}
            heading="Who can do what"
            body="Four roles, ordered from most to least powerful. Every capability below is enforced server-side — on each HTTP request and on every live update sent over the socket — so a Viewer cannot write by forging a message, not merely by being denied a button."
          />
          <div className="mt-8">
            <PermissionsMatrix />
          </div>
        </div>
      </section>

      {/* Self-hosting */}
      <section
        id="self-hosting"
        className="scroll-mt-8 border-t border-border"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-12 md:py-16">
          <SectionIntro
            eyebrow="Self-hosting"
            accentIndex={2}
            heading="Run it yourself"
            body="No vendor sits between you and your documents. The web app, the WebSocket sync service, PostgreSQL and Redis are all it needs, and the Compose files ship with the repository."
          />
          <div className="mt-10">
            <SelfHostQuickstart />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-8 border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-12 md:py-16">
          <SectionIntro
            eyebrow="FAQ"
            accentIndex={3}
            heading="Questions people ask"
            body="The short answers, and the behaviour behind them."
          />
          <div className="mt-8">
            <Faq />
          </div>
        </div>
      </section>

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
