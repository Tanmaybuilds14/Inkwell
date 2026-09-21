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
 * The node-producing extensions a stored document is rendered with.
 *
 * This MUST mirror the editor's list (see collab-editor): static HTML
 * generation throws on any node the schema doesn't know, and the editor can
 * put task lists, tables, images, highlighted code blocks and mentions into
 * the ydoc. Runtime-only extensions — collaboration, carets, authorship,
 * slash commands and mention suggestions — contribute no stored content and
 * are deliberately absent.
 *
 * Everything is imported lazily, so merely importing this module (which the
 * sync service is allowed to do) costs nothing until something renders.
 */
export async function documentExtensions() {
  const [
    { StarterKit },
    { TaskList, TaskItem },
    { Table, TableRow, TableHeader, TableCell },
    { default: Image },
    { CodeBlockLowlight },
    { common, createLowlight },
    { MentionNode },
  ] = await Promise.all([
    import('@tiptap/starter-kit'),
    import('@tiptap/extension-list'),
    import('@tiptap/extension-table'),
    import('@tiptap/extension-image'),
    import('@tiptap/extension-code-block-lowlight'),
    import('lowlight'),
    // The mention node lives with the editor extensions, but its schema is
    // half of the stored-document contract — the editor writes these nodes,
    // so every renderer of a stored document has to understand them.
    import('../components/editor/mention.js'),
  ]);

  return [
    // The lowlight variant replaces the plain code block (both register the
    // "codeBlock" node name — registering both would throw). A static render
    // has no history and never runs plugins.
    StarterKit.configure({ codeBlock: false, undoRedo: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: true }),
    CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
    MentionNode,
  ];
}

/**
 * Renders a stored Yjs update to HTML for version previews and the public
 * share page. Runs Tiptap's static HTML generator against a headless doc —
 * no browser required — over the full node set the editor can produce.
 */
export async function yUpdateToHtml(snapshotBytes) {
  if (!snapshotBytes || snapshotBytes.length === 0) return '';

  const [{ yXmlFragmentToProsemirrorJSON }, { generateHTML }, extensions] =
    await Promise.all([
      import('@tiptap/y-tiptap'),
      import('@tiptap/html'),
      documentExtensions(),
    ]);

  const doc = docFromSnapshot(snapshotBytes);
  try {
    const fragment = doc.getXmlFragment('default');
    if (fragment.length === 0) return '';
    const json = yXmlFragmentToProsemirrorJSON(fragment);
    return generateHTML(json, extensions);
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
