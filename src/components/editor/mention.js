import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

/**
 * @mentions, in two deliberately separate pieces.
 *
 *   - `MentionNode` is pure schema: it is what makes a stored mention survive a
 *     round trip through Yjs, and it is the only half the server needs. The
 *     public share page renders snapshots to HTML with no browser and no
 *     plugins (see lib/ydoc-utils), so it imports this and nothing else.
 *   - `MentionSuggestions` is the interactive half: the "@" trigger, the
 *     filtered roster, and the insert. Client-only.
 *
 * The node is an atom, not markable text: a person reference is one unit, so
 * the caret steps over it and nobody can bold half a name.
 */

export const MENTION_CHAR = "@";

/**
 * Rank one person against the typed query. Higher is better; -1 is no match.
 *
 * Three tiers, because "al" should reach `Alex` before `Sally`:
 *   1. display name starts with the query
 *   2. the query appears inside the name
 *   3. the query is a subsequence of the name ("alx" → "Alex Lin")
 *
 * Shorter names win inside a tier — a prefix match on the whole list fits.
 */
export function mentionMatch(person, query) {
  const name = (person?.name ?? "").toString().toLowerCase();
  if (!name) return -1;
  if (!query) return 0;

  if (name.startsWith(query)) return 100 - name.length;
  const at = name.indexOf(query);
  if (at >= 0) return 60 - at - name.length * 0.1;

  let i = 0;
  for (const ch of name) {
    if (ch === query[i]) i += 1;
    if (i === query.length) break;
  }
  return i === query.length ? 20 - name.length * 0.1 : -1;
}

/**
 * The roster, filtered for the menu. `excludeId` keeps the author out of their
 * own mention list (self-mentions are never notified — see lib/inbox).
 *
 * Array#sort is stable, so equally-scored people keep the roster's order
 * (owner first, then collaborators) rather than shuffling on every keystroke.
 */
export function filterMentionItems(people, query = "", { excludeId = null } = {}) {
  const q = (query ?? "").trim().toLowerCase();
  return (people ?? [])
    .filter((person) => person?.id && person.id !== excludeId)
    .map((person) => ({ person, score: mentionMatch(person, q) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ person }) => person);
}

export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      // The mentioned user's local id — the notification target.
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-mention-id"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-mention-id": attributes.id } : {},
      },
      // The display name as it was at insertion time. Stored rather than
      // looked up so a mention keeps rendering (and the doc keeps converging)
      // when a person is removed from the document or deletes their account.
      label: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-mention-label") ??
          (element.textContent ?? "").replace(/^@/, ""),
        renderHTML: (attributes) =>
          attributes.label ? { "data-mention-label": attributes.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-mention-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ class: "inkwell-mention" }, HTMLAttributes),
      `@${node.attrs.label}`,
    ];
  },

  /** Plain-text projection: what copying a mention, or reading it aloud, gets. */
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

import { PluginKey } from "@tiptap/pm/state";

export const MentionSuggestions = Extension.create({
  name: "mentionSuggestions",

  addOptions() {
    return {
      /**
       * () => people. A function rather than the array itself so a roster that
       * arrives after the editor mounts (the fetch in collab-editor) is picked
       * up by the next keystroke instead of being frozen at configure() time.
       */
      items: () => [],
      /**
       * Suggestion's render lifecycle ({ onStart, onUpdate, onExit, onKeyDown }),
       * supplied by the editor because the menu itself is editor chrome.
       */
      render: null,
      /** Called after a mention is inserted, so the caller can notify them. */
      onMention: null,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion({
        pluginKey: new PluginKey("mentionSuggestions"),
        editor: this.editor,
        char: MENTION_CHAR,
        // Suggestion's default allowedPrefixes ([" "]) is exactly the guard
        // we want: an "@" mid-word — an email address, a handle — never opens
        // the menu. `allowSpaces: false` keeps a query to one word, so the
        // menu closes when you keep typing prose.
        ...(options.render ? { render: options.render } : {}),
        items: ({ query }) => options.items(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: props.id, label: props.label } },
              // Trailing space so the next word is plain text rather than
              // continuing an "@" query that would immediately reopen the menu.
              { type: "text", text: " " },
            ])
            .run();
          options.onMention?.(props);
        },
      }),
    ];
  },
});
