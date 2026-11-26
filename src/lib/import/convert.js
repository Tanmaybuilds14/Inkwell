import * as Y from 'yjs';
import { documentExtensions } from '../ydoc-utils.js';

/**
 * HTML → Yjs snapshot.
 *
 * The editor and the sync service both speak Yjs, and a new document is just a
 * stored `Document.snapshot` the room loads on first connection. Building that
 * snapshot here — rather than inserting text after the editor mounts — means
 * an imported document behaves exactly like a hand-written one: it is
 * editable, collaborative, versioned, offline-cacheable and visible to the RAG
 * indexer with no special cases.
 */

/**
 * The editor's image node is allowed, but the importer deliberately drops
 * images (see extract.js). Walking the JSON rather than regexing HTML also
 * covers images produced by a future converter.
 */
function stripImages(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'image') return null;
  if (Array.isArray(node.content)) {
    node.content = node.content.map(stripImages).filter(Boolean);
  }
  return node;
}

/** Tiptap expects a doc node; an empty doc still needs one paragraph. */
function normalizeDoc(json) {
  const doc = stripImages(json);
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content) || doc.content.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return doc;
}

/** Visible character count, used for import result metadata. */
export function documentTextLength(json) {
  if (!json) return 0;
  if (json.type === 'text') return String(json.text ?? '').length;
  return (json.content ?? []).reduce((sum, node) => sum + documentTextLength(node), 0);
}

/**
 * Parse HTML with the same extension list the editor renders with, then write
 * the result into a Y.Doc and encode it as a full-state update.
 *
 * `documentExtensions()` is the stored-document contract (see ydoc-utils): it
 * includes StarterKit, tables, task lists, images, highlighted code and
 * mentions, so every node the editor can store is also a node the importer can
 * produce.
 */
export async function htmlToYjsSnapshot(html) {
  const [{ generateJSON }, { getSchema }, { prosemirrorJSONToYXmlFragment }, extensions] =
    await Promise.all([
      import('@tiptap/html'),
      import('@tiptap/core'),
      import('@tiptap/y-tiptap'),
      documentExtensions(),
    ]);

  const parsed = generateJSON(html, extensions);
  const json = normalizeDoc(parsed);

  const schema = getSchema(extensions);
  const doc = new Y.Doc();
  try {
    prosemirrorJSONToYXmlFragment(schema, json, doc.getXmlFragment('default'));
    return {
      json,
      snapshot: Buffer.from(Y.encodeStateAsUpdate(doc)),
      stateVector: Buffer.from(Y.encodeStateVector(doc)),
    };
  } finally {
    doc.destroy();
  }
}
