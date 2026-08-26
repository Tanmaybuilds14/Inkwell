import * as Y from 'yjs';

/**
 * Shared helpers for working with stored Yjs state. Used by the Next.js app
 * (version preview/restore) and importable by the sync service.
 */

/** Apply a stored Yjs update (Buffer/Uint8Array) to a fresh doc. */
export function docFromSnapshot(snapshotBytes) {
  const doc = new Y.Doc();
  if (snapshotBytes && snapshotBytes.length > 0) {
    Y.applyUpdate(doc, toUint8(snapshotBytes));
  }
  return doc;
}

export function toUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export function encodeState(doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/**
 * Renders a stored Yjs update to HTML for version previews. Runs Tiptap's
 * static HTML generator against a headless doc — no browser required.
 */
export async function yUpdateToHtml(snapshotBytes) {
  if (!snapshotBytes || snapshotBytes.length === 0) return '';

  const [{ yXmlFragmentToProsemirrorJSON }, { generateHTML }, { StarterKit }] =
    await Promise.all([
      import('@tiptap/y-tiptap'),
      import('@tiptap/html'),
      import('@tiptap/starter-kit'),
    ]);

  const doc = docFromSnapshot(snapshotBytes);
  try {
    const fragment = doc.getXmlFragment('default');
    if (fragment.length === 0) return '';
    const json = yXmlFragmentToProsemirrorJSON(fragment);
    return generateHTML(json, [StarterKit.configure({ history: false })]);
  } finally {
    doc.destroy();
  }
}
