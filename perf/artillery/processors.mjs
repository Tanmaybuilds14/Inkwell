/**
 * Artillery processor functions for the Inkwell perf configs.
 *
 * Loads the document ids written by `perf/seed.mjs` and hands each virtual
 * user its own document + token, which is what keeps a connection storm from
 * hammering a single room (and, with a real Clerk deployment, from reusing one
 * identity).
 *
 * Overrides:
 *   PERF_DOCS_FILE  path to the seed output (default perf/.perf-docs.json)
 *   PERF_DOC_IDS    comma-separated ids, used instead of the file
 *   PERF_TOKEN      base token string (default "perf-token"). With
 *                   PERF_TEST_STUB_CLERK=1 any non-empty token is accepted and
 *                   becomes a distinct perf identity; with real Clerk auth,
 *                   this must be a valid JWT for the whole run.
 *   PERF_COOKIE     session cookie for the authed API scenario (optional)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const docIds = loadDocIds();
if (docIds.length === 0) {
  // Fail loudly at load time: a run with no documents would open sockets that
  // the service immediately closes with 4404 and "pass" with zero real work.
  throw new Error(
    'perf/artillery: no document ids — run `node perf/seed.mjs` first, or set PERF_DOC_IDS.'
  );
}

const baseToken = process.env.PERF_TOKEN ?? 'perf-token';

function loadDocIds() {
  if (process.env.PERF_DOC_IDS) {
    return process.env.PERF_DOC_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const file = process.env.PERF_DOCS_FILE ?? resolve(__dirname, '../.perf-docs.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

let counter = 0;

/** Attach `docId` (round-robin over the seeded documents) and a token. */
export function pickDoc(userContext, _events) {
  const i = counter++;
  userContext.vars.docId = docIds[i % docIds.length];
  userContext.vars.token = `${baseToken}-${i}`;
  userContext.vars.docIndex = i % docIds.length;
}

/** Same as pickDoc, plus the optional session cookie for authed HTTP paths. */
export function pickDocAuthed(userContext, events) {
  pickDoc(userContext, events);
  if (process.env.PERF_COOKIE) {
    userContext.vars.cookie = process.env.PERF_COOKIE;
  }
}

/** Report how many distinct rooms the run will touch (printed once per worker). */
export function describeTarget(userContext, _events) {
  console.log(
    `[perf] ${docIds.length} seeded document(s); first: ${docIds[0]}; token base: ${baseToken}`
  );
}
