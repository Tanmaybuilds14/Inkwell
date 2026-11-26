import pg from 'pg';
import * as Y from 'yjs';

/**
 * Database fixtures for the end-to-end suite.
 *
 * The other e2e specs get by without a database — they assert fail-closed auth
 * and the share-link throttle, both of which answer before any query runs. The
 * share page and the mention API cannot: their contract is "what a stored
 * document looks like over real HTTP", so they need real rows. CI's e2e job
 * already provides a migrated Postgres, and this is how a spec writes into it
 * (there is no signed-in session available, so the app's own API cannot seed).
 *
 * Raw SQL over `pg` rather than the generated Prisma client, for two reasons:
 * the sync service already talks to these same tables this way (see
 * sync-service/src/db.js) so there is one convention for "Postgres outside the
 * Next.js app", and the generated client is TypeScript-only — Playwright's
 * loader transpiles it as CommonJS, where its `import.meta` is a syntax error,
 * so importing it from a spec cannot work.
 *
 * Every row is created under a freshly-minted owner, and `cleanup()` deletes
 * that owner: the schema cascades, so the documents (and their permissions and
 * inbox items) go with it.
 */

let pool = null;

function db() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the e2e fixtures cannot seed documents.');
    }
    pool = new pg.Pool({ connectionString, max: 4 });
  }
  return pool;
}

/**
 * True when the suite can seed: a database is configured, reachable, AND
 * migrated. The probe reads a real table on purpose — an empty but migrated
 * database is ready, while a database without the schema is not, and the
 * difference would otherwise surface later as a confusing failure mid-spec.
 *
 * Specs gate on this instead of failing, so `npm run test:e2e` stays useful on
 * a machine with no Postgres (or one pointing at a cloud database that has not
 * been migrated): the database-dependent specs report as skipped, the rest run.
 */
export async function databaseReady() {
  if (!process.env.DATABASE_URL) return false;
  try {
    await db().query('SELECT 1 FROM "Document" LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

/** Close the pool so a Playwright worker can exit promptly. */
export async function closeDatabase() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

/** Per-run unique value, so parallel specs never collide on a unique column. */
export function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A share token shaped exactly like the ones the share route mints (32 chars). */
export function shareToken() {
  return `${uniqueSuffix().replace(/-/g, '')}${Math.random().toString(36).slice(2, 10)}`.slice(0, 32);
}

function paragraph(children) {
  const node = new Y.XmlElement('paragraph');
  if (children.length > 0) node.insert(0, children);
  return node;
}

function textNode(value) {
  const text = new Y.XmlText();
  text.insert(0, value);
  return text;
}

const BLOCK_BUILDERS = {
  heading: ({ level = 1, text }) => {
    const node = new Y.XmlElement('heading');
    node.setAttribute('level', String(level));
    node.insert(0, [textNode(text)]);
    return node;
  },
  paragraph: ({ text }) => paragraph([textNode(text)]),
  /**
   * A paragraph that is just a mention, written the way the editor writes one:
   * an atom node followed by a space, with no surrounding text.
   */
  mention: ({ id, label }) => {
    const node = new Y.XmlElement('mention');
    node.setAttribute('id', id);
    node.setAttribute('label', label);
    return paragraph([node, textNode(' ')]);
  },
  taskList: ({ items }) => {
    const list = new Y.XmlElement('taskList');
    for (const item of items) {
      const taskItem = new Y.XmlElement('taskItem');
      taskItem.insert(0, [paragraph([textNode(item)])]);
      list.insert(list.length, [taskItem]);
    }
    return list;
  },
  codeBlock: ({ text, language = null }) => {
    const node = new Y.XmlElement('codeBlock');
    if (language) node.setAttribute('language', language);
    node.insert(0, [textNode(text)]);
    return node;
  },
};

/**
 * Build a stored Yjs snapshot from a small block DSL.
 *
 * The blocks go through the same XML shape the editor's Tiptap schema produces
 * (`<heading level="1">`, `<mention id label>`, `<taskList><taskItem>`), which
 * is what makes these fixtures meaningful: a spec that renders one exercises
 * the real server-side schema, not a simplified stand-in.
 */
export function snapshotFromBlocks(blocks) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('default');
  for (const block of blocks) {
    const build = BLOCK_BUILDERS[block.type];
    if (!build) throw new Error(`Unknown fixture block type: ${block.type}`);
    fragment.insert(fragment.length, [build(block)]);
  }
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}

/**
 * Create a document (and the owner it needs) ready to be reached over HTTP.
 *
 * Column names are the schema's own (quoted camelCase). `id`, `updatedAt` and
 * the enum cast are spelled out because Prisma fills them client-side and there
 * is no database default for them here.
 */
export async function createDocumentFixture({
  title = 'Shared document',
  blocks = [{ type: 'paragraph', text: 'Fixture body' }],
  shareEnabled = true,
  shareRole = 'VIEWER',
  deletedAt = null,
  withToken = true,
} = {}) {
  const suffix = uniqueSuffix();
  const ownerId = `e2e-owner-${suffix}`;
  const documentId = `e2e-doc-${suffix}`;
  const token = withToken ? shareToken() : null;

  await db().query(
    `INSERT INTO "User" ("id", "clerkId", "email", "name", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [ownerId, `e2e_clerk_${suffix}`, `e2e_owner_${suffix}@inkwell.test`, 'E2E Owner']
  );

  await db().query(
    `INSERT INTO "Document"
       ("id", "title", "ownerId", "snapshot", "shareToken", "shareEnabled", "shareRole", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"Role", $8, NOW())`,
    [documentId, title, ownerId, snapshotFromBlocks(blocks), token, shareEnabled, shareRole, deletedAt]
  );

  return {
    id: documentId,
    shareToken: token,
    ownerId,
    async cleanup() {
      // Cascades to documents, permissions and inbox items.
      await db().query('DELETE FROM "User" WHERE "id" = $1', [ownerId]).catch(() => {});
    },
  };
}

/** Count a user's inbox rows — used to prove a refused action wrote nothing. */
export async function inboxCount(userId) {
  const { rows } = await db().query(
    'SELECT COUNT(*)::int AS count FROM "InboxItem" WHERE "userId" = $1',
    [userId]
  );
  return rows[0]?.count ?? 0;
}
