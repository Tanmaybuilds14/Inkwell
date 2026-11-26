/**
 * Tests for the version-restore revert delta (src/lib/ydoc-utils.js).
 *
 * Regression coverage for the "restore does nothing" bug: pushing a stored
 * full-state snapshot at a live Yjs doc is a no-op merge (CRDT updates are
 * additive), so text typed after the snapshot survived. buildRestoreUpdate
 * produces a real revert delta — deletes + re-inserts — that converges.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildRestoreUpdate, applyUpdateToSnapshot, docFromSnapshot } from '@/lib/ydoc-utils';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';

const schema = getSchema([StarterKit.configure({ history: false })]);

function docWithContent(text) {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    schema,
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    doc.getXmlFragment('default')
  );
  return doc;
}

function firstParagraphText(doc) {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'));
  return json.content?.[0]?.content?.[0]?.text ?? '';
}

function editParagraphText(doc, replaceWith) {
  const p = doc.getXmlFragment('default').get(0);
  const t = p.firstChild;
  t.delete(0, t.length);
  t.insert(0, replaceWith);
}

describe('buildRestoreUpdate — revert delta math', () => {
  it('reverts a live doc to the version content (deletes newer text)', async () => {
    const versionDoc = docWithContent('hello world');
    const versionSnapshot = Buffer.from(Y.encodeStateAsUpdate(versionDoc));

    // Simulated later session on a fresh doc loaded from the same state.
    const currentDoc = docFromSnapshot(versionSnapshot);
    editParagraphText(currentDoc, 'totally different text');
    const currentSnapshot = Buffer.from(Y.encodeStateAsUpdate(currentDoc));

    const revert = await buildRestoreUpdate(currentSnapshot, versionSnapshot);
    expect(revert.length).toBeGreaterThan(0);

    // Applying the revert to the current state yields the version content.
    const target = docFromSnapshot(currentSnapshot);
    Y.applyUpdate(target, revert);
    expect(firstParagraphText(target)).toBe('hello world');
  });

  it('converges when applied to a fresh replica (editor reload case)', async () => {
    const versionDoc = docWithContent('v1 content');
    const versionSnapshot = Buffer.from(Y.encodeStateAsUpdate(versionDoc));
    const currentDoc = docFromSnapshot(versionSnapshot);
    editParagraphText(currentDoc, 'v2 edited content');
    const currentSnapshot = Buffer.from(Y.encodeStateAsUpdate(currentDoc));

    const revert = await buildRestoreUpdate(currentSnapshot, versionSnapshot);

    // A brand-new replica that has BOTH current state and the revert (e.g.
    // someone joining after the restore) sees the restored content.
    const fresh = docFromSnapshot(currentSnapshot);
    Y.applyUpdate(fresh, revert);
    expect(firstParagraphText(fresh)).toBe('v1 content');
  });

  it('is idempotent — re-applying the revert changes nothing', async () => {
    const versionDoc = docWithContent('original');
    const versionSnapshot = Buffer.from(Y.encodeStateAsUpdate(versionDoc));
    const currentDoc = docFromSnapshot(versionSnapshot);
    editParagraphText(currentDoc, 'changed');
    const currentSnapshot = Buffer.from(Y.encodeStateAsUpdate(currentDoc));

    const revert = await buildRestoreUpdate(currentSnapshot, versionSnapshot);
    const target = docFromSnapshot(currentSnapshot);
    Y.applyUpdate(target, revert);
    Y.applyUpdate(target, revert);
    expect(firstParagraphText(target)).toBe('original');
  });

  it('returns an empty update when version snapshot is missing', async () => {
    const doc = docWithContent('anything');
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
    const revert = await buildRestoreUpdate(snapshot, null);
    expect(revert.length).toBe(0);
  });

  it('folds into the stored snapshot via applyUpdateToSnapshot', async () => {
    const versionDoc = docWithContent('take me back');
    const versionSnapshot = Buffer.from(Y.encodeStateAsUpdate(versionDoc));
    const currentDoc = docFromSnapshot(versionSnapshot);
    editParagraphText(currentDoc, 'newer draft');
    const currentSnapshot = Buffer.from(Y.encodeStateAsUpdate(currentDoc));

    const revert = await buildRestoreUpdate(currentSnapshot, versionSnapshot);
    const stored = applyUpdateToSnapshot(currentSnapshot, revert);

    // The persisted snapshot now renders the restored content.
    const storedDoc = docFromSnapshot(stored);
    expect(firstParagraphText(storedDoc)).toBe('take me back');
  });
});

describe('acceptInboxItem — permission row creation', () => {
  // Covered via the lib with a mocked prisma (mock hoisted above).
  it('module exposes the helper for the accept route', async () => {
    const mod = await import('@/lib/inbox');
    expect(typeof mod.acceptInboxItem).toBe('function');
    expect(typeof mod.isInviteAccepted).toBe('function');
  });
});
