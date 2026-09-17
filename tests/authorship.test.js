import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { collectAuthorRuns } from "@/components/editor/authorship-runs";

// Mirror the y-tiptap document shape: fragment > YXmlElement(paragraph) >
// inner YXmlText > ContentString items.
function buildDoc() {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment("default");
  const paragraph = () => {
    const p = new Y.XmlElement("paragraph");
    frag.insert(frag.length, [p]);
    return p;
  };
  const type = (p, clientID) => {
    ydoc.clientID = clientID;
    // Insert into the paragraph's YXmlText content child (y-tiptap shape).
    let text = null;
    let n = p._first;
    while (n) {
      if (n.content && n.content.constructor === Y.ContentType) {
        text = n.content.type;
        break;
      }
      n = n.right;
    }
    if (!text) {
      text = new Y.XmlText();
      p.insert(0, [text]);
    }
    return text;
  };
  return { ydoc, frag, paragraph, type };
}

describe("collectAuthorRuns", () => {
  it("attributes runs to the typing client", () => {
    const { ydoc, frag, paragraph, type } = buildDoc();
    const p = paragraph();
    const text = type(p, 111);
    text.insert(0, "hello");
    ydoc.clientID = 111; // scanner reads items, but keep it consistent

    const { runs } = collectAuthorRuns(frag);
    expect(runs).toEqual([
      { parent: text, offset: 0, len: 5, client: 111 },
    ]);
  });

  it("merges adjacent same-client runs but splits across clients", () => {
    const { ydoc, frag, paragraph, type } = buildDoc();
    const p = paragraph();
    const text = type(p, 111);
    ydoc.clientID = 111;
    text.insert(0, "ab");
    text.insert(2, "cd"); // same client → merges
    ydoc.clientID = 222;
    text.insert(4, "ef"); // other client → new run

    const { runs } = collectAuthorRuns(frag);
    expect(runs.map((r) => [r.client, r.offset, r.len])).toEqual([
      [111, 0, 4],
      [222, 4, 2],
    ]);
  });

  it("skips deleted text and keeps index space intact", () => {
    const { ydoc, frag, paragraph, type } = buildDoc();
    const p = paragraph();
    const text = type(p, 111);
    ydoc.clientID = 111;
    text.insert(0, "abcd");
    text.delete(1, 2); // "bc" deleted; "a" and "d" remain

    const { runs } = collectAuthorRuns(frag);
    expect(runs.map((r) => [r.offset, r.len])).toEqual([
      [0, 1],
      [3, 1],
    ]);
  });

  it("covers nested blocks (blockquote > paragraph)", () => {
    const { ydoc, frag, paragraph, type } = buildDoc();
    const bq = new Y.XmlElement("blockquote");
    frag.insert(frag.length, [bq]);
    const p = new Y.XmlElement("paragraph");
    bq.insert(0, [p]);
    const text = type(p, 333); // type() inserts the YXmlText content child
    ydoc.clientID = 333;
    text.insert(0, "nested");

    const { runs } = collectAuthorRuns(frag);
    expect(runs.map((r) => r.client)).toEqual([333]);
  });

  it("spans multiple paragraphs and marks truncation when limited", () => {
    const { ydoc, frag, paragraph, type } = buildDoc();
    const p1 = paragraph();
    const p2 = paragraph();
    const t1 = type(p1, 111);
    const t2 = type(p2, 222);
    ydoc.clientID = 111;
    t1.insert(0, "one");
    ydoc.clientID = 222;
    t2.insert(0, "two");

    const all = collectAuthorRuns(frag);
    expect(all.runs.map((r) => r.client)).toEqual([111, 222]);
    expect(all.truncated).toBe(false);

    const limited = collectAuthorRuns(frag, { maxItems: 1 });
    expect(limited.truncated).toBe(true);
  });
});
