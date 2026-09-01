import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docFromSnapshot, yUpdateToHtml } from '@/lib/ydoc-utils';

/** Builds a Y.Doc holding Tiptap-shaped content: <doc><paragraph>…</paragraph></doc> */
function buildDoc(paragraphs) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('default');
  for (const text of paragraphs) {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, text);
    p.insert(0, [t]);
    fragment.insert(fragment.length, [p]);
  }
  return doc;
}

describe('ydoc-utils', () => {
  it('round-trips a snapshot into renderable HTML', async () => {
    const doc = buildDoc(['hello world', 'second paragraph']);
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));

    const html = await yUpdateToHtml(snapshot);
    expect(html).toContain('hello world');
    expect(html).toContain('second paragraph');
    expect(html).toContain('<p>');
    doc.destroy();
  });

  it('returns empty HTML for null/empty snapshots', async () => {
    expect(await yUpdateToHtml(null)).toBe('');
    expect(await yUpdateToHtml(Buffer.alloc(0))).toBe('');
  });

  it('renders an empty document without throwing', async () => {
    const doc = new Y.Doc();
    // Fragment exists but has no children.
    doc.getXmlFragment('default');
    const html = await yUpdateToHtml(Buffer.from(Y.encodeStateAsUpdate(doc)));
    expect(html).toBe('');
    doc.destroy();
  });

  it('docFromSnapshot restores content from stored bytes', () => {
    const original = buildDoc(['restore me']);
    const bytes = Y.encodeStateAsUpdate(original);
    original.destroy();

    const restored = docFromSnapshot(bytes);
    const fragment = restored.getXmlFragment('default');
    expect(fragment.length).toBe(1);
    expect(fragment.toString()).toContain('restore me');
    restored.destroy();
  });

  it('merges concurrent edits without data loss (CRDT guarantee)', () => {
    const doc1 = buildDoc(['shared base. ']);
    const update = Y.encodeStateAsUpdate(doc1);

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, update);

    // Concurrent inserts at the same position on both replicas.
    const frag1 = doc1.getXmlFragment('default');
    const p1 = frag1.get(0);
    p1.get(0).insert(13, 'from-one');

    const frag2 = doc2.getXmlFragment('default');
    const p2 = frag2.get(0);
    p2.get(0).insert(13, 'from-two');

    // Sync both ways.
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    expect(frag1.toString()).toBe(frag2.toString());
    expect(frag1.toString()).toContain('from-one');
    expect(frag1.toString()).toContain('from-two');
    doc1.destroy();
    doc2.destroy();
  });
});
