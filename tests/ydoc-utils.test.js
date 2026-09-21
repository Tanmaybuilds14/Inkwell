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

  it('renders every node type the editor can store', async () => {
    // The failure this guards: generateHTML throws on a node the schema does
    // not know, so a document containing a table, a task list, a highlighted
    // code block or a mention used to make the version preview (and now the
    // public share page) return a 500 instead of the document.
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');

    const table = new Y.XmlElement('table');
    const row = new Y.XmlElement('tableRow');
    const cell = new Y.XmlElement('tableCell');
    const cellParagraph = new Y.XmlElement('paragraph');
    const cellText = new Y.XmlText();
    cellText.insert(0, 'cell');
    cellParagraph.insert(0, [cellText]);
    cell.insert(0, [cellParagraph]);
    row.insert(0, [cell]);
    table.insert(0, [row]);
    fragment.insert(fragment.length, [table]);

    const taskList = new Y.XmlElement('taskList');
    const taskItem = new Y.XmlElement('taskItem');
    const taskParagraph = new Y.XmlElement('paragraph');
    const taskText = new Y.XmlText();
    taskText.insert(0, 'todo');
    taskParagraph.insert(0, [taskText]);
    taskItem.insert(0, [taskParagraph]);
    taskList.insert(0, [taskItem]);
    fragment.insert(fragment.length, [taskList]);

    const codeBlock = new Y.XmlElement('codeBlock');
    const codeText = new Y.XmlText();
    codeText.insert(0, 'const x = 1;');
    codeBlock.insert(0, [codeText]);
    fragment.insert(fragment.length, [codeBlock]);

    const mentionParagraph = new Y.XmlElement('paragraph');
    const mention = new Y.XmlElement('mention');
    mention.setAttribute('id', 'user_1');
    mention.setAttribute('label', 'Ada Lovelace');
    mentionParagraph.insert(0, [mention]);
    fragment.insert(fragment.length, [mentionParagraph]);

    // A pasted URL arrives as a `link` mark; the renderer must understand it
    // too, or every document containing a link fails to render.
    const linkParagraph = new Y.XmlElement('paragraph');
    const linkText = new Y.XmlText();
    linkText.insert(0, 'docs');
    linkText.format(0, 4, { link: { href: 'https://example.dev/docs' } });
    linkParagraph.insert(0, [linkText]);
    fragment.insert(fragment.length, [linkParagraph]);

    const html = await yUpdateToHtml(Buffer.from(Y.encodeStateAsUpdate(doc)));
    expect(html).toContain('href="https://example.dev/docs"');
    expect(html).toContain('cell');
    expect(html).toContain('todo');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('data-mention-id="user_1"');
    expect(html).toContain('@Ada Lovelace');
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
