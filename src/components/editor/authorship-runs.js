import * as Y from "yjs";

/**
 * Authorship scanning (pure Yjs, no DOM) — used by the AuthorshipUnderlines
 * tiptap extension and unit-tested in tests/authorship.test.js.
 *
 * Every Yjs item (a contiguous typed run) carries `item.id.client`, the
 * clientID of the client that created it. That clientID is stable per
 * session and equals the awareness clientID, so it maps to the peer's
 * assigned presence color. Offline merges never rewrite item origins, so
 * authorship survives merges.
 *
 * Document shape produced by y-tiptap: the bound YXmlFragment's children are
 * YXmlElements (paragraph, heading, …), whose text lives in an inner
 * YXmlText holding ContentString items. Walks are recursive, so nested
 * blocks (blockquote > paragraph, listItem > paragraph) are covered, and
 * elements that hold strings directly are handled too.
 *
 * An authorship "run" is { parent, offset, len, client } where `parent` is
 * the Y type directly holding the text and `offset`/`len` are indices in
 * that type's index space. Positions are later converted to ProseMirror
 * positions via Y relative positions (created against `parent`), which
 * survive concurrent edits between scan and render.
 */

const MAX_SCAN_ITEMS = 20000; // safety valve for very large documents

export function collectAuthorRuns(yxmlFragment, { maxItems = MAX_SCAN_ITEMS } = {}) {
  const runs = [];
  let scanned = 0;
  let truncated = false;

  const walk = (type) => {
    let offset = 0; // running index inside `type`
    let n = type._first;
    while (n !== null) {
      if (scanned >= maxItems) {
        truncated = true;
        return;
      }
      if (!n.deleted && n.content) {
        const C = n.content.constructor;
        if (C === Y.ContentString || C === Y.ContentAny) {
          runs.push({ parent: type, offset, len: n.length, client: n.id.client });
          scanned += 1;
        } else if (C === Y.ContentType) {
          walk(n.content.type);
          if (truncated) return;
        }
        // ContentFormat (marks) / ContentEmbed / ContentJSON / ContentBinary:
        // no authorship meaning.
      }
      offset += n.length; // every item advances the index space, deleted or not
      n = n.right;
    }
  };

  walk(yxmlFragment);

  if (truncated) {
    console.warn(
      `[authorship] scan limit (${maxItems} items) reached; underlines may be incomplete.`
    );
  }

  // Merge adjacent same-client runs to keep the decoration count low.
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.client === run.client &&
      last.parent === run.parent &&
      last.offset + last.len === run.offset
    ) {
      last.len += run.len;
    } else {
      merged.push(run);
    }
  }
  return { runs: merged, truncated };
}
