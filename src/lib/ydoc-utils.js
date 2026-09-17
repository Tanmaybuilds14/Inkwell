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

/**
 * Build the Yjs update that transforms `currentSnapshot` back into
 * `versionSnapshot` — a regular CRDT delta (deletes + re-inserts), NOT a
 * full-state snapshot.
 *
 * Why this matters: applying a stored full-state update to a live doc is a
 * no-op merge — CRDT updates only ever ADD operations, so text typed after
 * the snapshot survives and "restore" appears to do nothing. A revert delta
 * genuinely deletes the newer ops and re-inserts the old content, so it
 * converges on every replica (live rooms and fresh loads alike).
 *
 * Returns a Uint8Array update (empty when there is nothing to do).
 */
export async function buildRestoreUpdate(currentSnapshot, versionSnapshot) {
  if (!versionSnapshot || versionSnapshot.length === 0) return new Uint8Array();

  const [{ getSchema }, { StarterKit }, { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON }] =
    await Promise.all([
      import('@tiptap/core'),
      import('@tiptap/starter-kit'),
      import('@tiptap/y-tiptap'),
    ]);

  const schema = getSchema([StarterKit.configure({ history: false })]);

  // The version's content, read from just its own update.
  const versionDoc = docFromSnapshot(versionSnapshot);
  const versionJson = yXmlFragmentToProsemirrorJSON(
    versionDoc.getXmlFragment('default')
  );
  versionDoc.destroy();

  // A throwaway doc holding the current state; the revert edits (clear
  // everything, re-insert the version JSON) are captured as a plain update.
  const merged = docFromSnapshot(currentSnapshot);
  const updates = [];
  merged.on('update', (u) => updates.push(u));
  try {
    const fragment = merged.getXmlFragment('default');
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    prosemirrorJSONToYXmlFragment(schema, versionJson, fragment);
  } finally {
    merged.destroy();
  }
  return updates.length > 0 ? Y.mergeUpdates(updates) : new Uint8Array();
}

/**
 * Apply an update to a snapshot and return the resulting full state.
 * Used to fold a revert delta into the stored document snapshot.
 */
export function applyUpdateToSnapshot(snapshotBytes, updateBytes) {
  const doc = docFromSnapshot(snapshotBytes);
  try {
    if (updateBytes && updateBytes.length > 0) {
      Y.applyUpdate(doc, toUint8(updateBytes));
    }
    return encodeState(doc);
  } finally {
    doc.destroy();
  }
}
