import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

/**
 * The slash-command items. Kept as data (not inline JSX) so the menu is a
 * pure renderer and this list can be unit tested without mounting an editor.
 *
 * `command` receives { editor, range } from the Suggestion utility and must
 * delete the "/query" text before applying the change — chain().focus()
 * deleteRange(range) is the canonical way.
 */
export const SLASH_ITEMS = [
  {
    group: "Basic blocks",
    title: "Heading 1",
    description: "Big section heading",
    aliases: ["h1", "title"],
    icon: "h1",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    group: "Basic blocks",
    title: "Heading 2",
    description: "Medium section heading",
    aliases: ["h2"],
    icon: "h2",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    group: "Basic blocks",
    title: "Heading 3",
    description: "Small section heading",
    aliases: ["h3"],
    icon: "h3",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    group: "Basic blocks",
    title: "Bullet list",
    description: "Simple bulleted list",
    aliases: ["ul", "bullet"],
    icon: "list",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    group: "Basic blocks",
    title: "Numbered list",
    description: "List with ordered items",
    aliases: ["ol", "number"],
    icon: "list-ordered",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    group: "Basic blocks",
    title: "To-do list",
    description: "Track tasks with checkboxes",
    aliases: ["task", "todo", "check", "checkbox"],
    icon: "check-square",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    group: "Basic blocks",
    title: "Quote",
    description: "Capture a quotation",
    aliases: ["blockquote", "q"],
    icon: "quote",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    group: "Code",
    title: "Code block",
    description: "Syntax-highlighted code with a language label",
    aliases: ["code", "codeblock", "snippet"],
    icon: "code",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    group: "Code",
    title: "Inline code",
    description: "Render a short snippet inline",
    aliases: ["inline"],
    icon: "code",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCode().run(),
  },
  {
    group: "Structure",
    title: "Table",
    description: "3×3 table with a header row",
    aliases: ["grid"],
    icon: "table",
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    group: "Structure",
    title: "Divider",
    description: "Horizontal rule to separate sections",
    aliases: ["hr", "line", "rule"],
    icon: "minus",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    group: "Media",
    title: "Image",
    description: "Embed an image from a URL",
    aliases: ["img", "picture", "photo"],
    icon: "image",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Prompted rather than uploaded: no storage bucket exists in this
      // project yet, and a broken upload path would be worse than an honest
      // prompt. Swap for a file picker when object storage lands.
      const url = typeof window !== "undefined" ? window.prompt("Image URL") : null;
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
  },
];

/**
 * Subsequence match (like editor fuzzy filters): "tbl" matches "TaBle",
 * "h1" matches its alias. Returns a score (higher = earlier match) or -1.
 */
export function slashMatch(item, query) {
  if (!query) return 0;
  const haystacks = [item.title.toLowerCase(), ...(item.aliases ?? [])];
  let best = -1;
  for (const hay of haystacks) {
    let i = 0;
    for (const ch of hay) {
      if (ch === query[i]) i++;
      if (i === query.length) break;
    }
    if (i === query.length) {
      // Exact prefix beats subsequence so "h" ranks "Heading…" first.
      const score = hay.startsWith(query) ? 100 - hay.length : 50 - hay.length;
      if (score > best) best = score;
    }
  }
  return best;
}

export function filterSlashItems(query) {
  return SLASH_ITEMS.map((item) => ({ item, score: slashMatch(item, query) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

/**
 * The Tiptap extension. It only *detects* the "/" trigger and forwards state
 * changes to React via callbacks — the menu itself lives in collab-editor,
 * because rendering belongs with the rest of the editor chrome.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        items: ({ query }) => filterSlashItems(query.toLowerCase()),
        command: ({ editor, range, props }) => props.command({ editor, range }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
