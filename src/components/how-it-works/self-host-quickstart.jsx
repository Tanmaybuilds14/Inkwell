import { CommandBlock } from "@/components/how-it-works/copy-button";

const LOCAL_COMMANDS = `git clone https://github.com/inkwell-app/inkwell.git
cd inkwell
npm install --legacy-peer-deps
npm ci --prefix sync-service
cp .env.example .env
docker compose up -d redis
npx prisma migrate deploy
npm run dev        # web on :3000
npm run dev:sync   # sync service on :1234`;

const COMPOSE_COMMAND = `docker compose --profile app up --build`;

const SERVICES = [
  { port: ":3000", what: "Next.js web app" },
  { port: ":1234", what: "Sync service instance 1" },
  { port: ":1235", what: "Sync service instance 2" },
  { port: ":6379", what: "Redis" },
];

const ENV_VARS = [
  { name: "DATABASE_URL", what: "PostgreSQL connection string" },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY · CLERK_SECRET_KEY",
    what: "Clerk application keys — sign-in, sign-up and session tokens",
  },
  {
    name: "REDIS_URL",
    what: "Redis: cross-instance relay and rate-limit counters",
  },
  {
    name: "NEXT_PUBLIC_SYNC_WS_URL",
    what: "The URL browsers use to reach the sync service",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    what: "Public origin used to build share and invite links",
  },
  {
    name: "TRUST_PROXY",
    what: "Set to 1 only when a trusted proxy overwrites X-Forwarded-For",
  },
  {
    name: "INNGEST_EVENT_KEY · INNGEST_SIGNING_KEY",
    what: "Optional — background jobs: trash purge, snapshot prune, invite mail",
  },
  {
    name: "RESEND_API_KEY · EMAIL_FROM",
    what: "Optional — invite email delivery (logged instead when unset)",
  },
  {
    name: "SENTRY_DSN",
    what: "Optional — server and browser error reporting",
  },
];

/** The self-hosting half of the walkthrough: commands first, config after. */
export function SelfHostQuickstart() {
  return (
    <div className="space-y-10">
      <div className="grid gap-8 md:grid-cols-2 md:gap-10">
        <div>
          <h3 className="text-xl font-medium tracking-tight text-foreground">
            Run it locally
          </h3>
          <p className="landing-body mt-3">
            Two processes, one database, one Redis. Postgres can come from
            Docker Compose or any local install; everything else is in the
            repository.
          </p>
          <div className="mt-5">
            <CommandBlock label="terminal" value={LOCAL_COMMANDS}>
              {LOCAL_COMMANDS}
            </CommandBlock>
          </div>
        </div>

        <div>
          <h3 className="text-xl font-medium tracking-tight text-foreground">
            Or the whole stack at once
          </h3>
          <p className="landing-body mt-3">
            The Compose profile builds the web image and starts two sync
            instances, so the cross-instance Redis relay is exercised locally
            rather than only in production.
          </p>
          <div className="mt-5">
            <CommandBlock label="docker" value={COMPOSE_COMMAND}>
              {COMPOSE_COMMAND}
            </CommandBlock>
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            {SERVICES.map((service) => (
              <div key={service.port} className="flex items-baseline gap-3">
                <dt className="font-mono text-xs text-foreground">
                  {service.port}
                </dt>
                <dd className="text-landing-muted">{service.what}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-landing-muted">
            In production, run the sync service as an always-on process (not
            serverless) with at least two instances behind a load balancer — the
            relay keeps their rooms converged, and a Redis lock keeps exactly one
            of them writing to Postgres.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-medium tracking-tight text-foreground">
          Environment variables
        </h3>
        <p className="landing-body mt-3">
          Everything the app reads is listed in{" "}
          <code className="font-mono text-sm text-foreground">
            .env.example
          </code>
          . Four keys are enough to boot it; the rest switch on background jobs,
          invite mail and error reporting.
        </p>
        <dl className="mockup-card mt-5 grid gap-px overflow-hidden rounded-2xl sm:grid-cols-2">
          {ENV_VARS.map((variable) => (
            <div key={variable.name} className="px-5 py-4">
              <dt className="font-mono text-xs text-foreground">
                {variable.name}
              </dt>
              <dd className="mt-1 text-sm text-landing-muted">
                {variable.what}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
