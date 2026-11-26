import { docFromSnapshot } from '../ydoc-utils.js';

/**
 * Yjs snapshot → ordered text blocks, each tagged with its heading path.
 *
 * JSON, not HTML: headings give both chunk boundaries and citation context,
 * and an HTML round-trip loses list nesting, code fences and table cells.
 * The node set mirrors `documentExtensions()` in ydoc-utils — anything the
 * editor can store has to produce text here or it silently disappears from
 * retrieval.
 */

/** Headings deeper than this are flattened (Tiptap only offers 1–6). */
const MAX_HEADING_LEVEL = 6;

function isList(node) {
  return node?.type === 'bulletList' || node?.type === 'orderedList' || node?.type === 'taskList';
}

/** Inline content of a node: text, atoms (mention/image) and line breaks. */
export function inlineText(node) {
  if (!node) return '';
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'mention': {
      const label = node.attrs?.label ?? node.attrs?.name ?? node.attrs?.id;
      return label ? `@${label}` : '';
    }
    case 'image': {
      const alt = node.attrs?.alt ?? node.attrs?.title ?? '';
      return alt ? `[image: ${alt}]` : '';
    }
    case 'hardBreak':
      return '\n';
    case 'emoji':
      return node.attrs?.name ?? '';
    default:
      return Array.isArray(node.content) ? node.content.map(inlineText).join('') : '';
  }
}

function listLines(list, depth = 0) {
  const lines = [];
  const items = Array.isArray(list.content) ? list.content : [];

  items.forEach((item, index) => {
    if (item.type === 'listItem' || item.type === 'taskItem') {
      let prefix;
      if (list.type === 'taskList') prefix = `- [${item.attrs?.checked ? 'x' : ' '}] `;
      else if (list.type === 'orderedList') prefix = `${(list.attrs?.start ?? 1) + index}. `;
      else prefix = '- ';

      const inline = (item.content ?? [])
        .filter((child) => child.type !== 'bulletList' && child.type !== 'orderedList' && child.type !== 'taskList')
        .map(inlineText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      lines.push(`${'  '.repeat(depth)}${prefix}${inline}`.trimEnd());

      for (const child of item.content ?? []) {
        if (isList(child)) lines.push(...listLines(child, depth + 1));
      }
    } else if (isList(item)) {
      lines.push(...listLines(item, depth + 1));
    }
  });

  return lines;
}

function tableRows(table) {
  return (table.content ?? [])
    .filter((row) => row.type === 'tableRow')
    .map((row) =>
      (row.content ?? [])
        .map((cell) => inlineText(cell).replace(/\s+/g, ' ').trim())
        .join(' | ')
    )
    .filter((line) => line.trim().length > 0);
}

function emptyBlock() {
  return { text: '', headingPath: null, blockIndex: 0, atomic: false, type: 'text' };
}

/**
 * Walk a ProseMirror JSON document into blocks.
 *
 * Exported separately from the Yjs entry point so it can be unit-tested with
 * plain JSON (no CRDT round-trip needed).
 */
export function blocksFromJson(json) {
  const blocks = [];
  const headingStack = [];
  let blockIndex = 0;

  const headingPath = () => headingStack.filter(Boolean).join(' > ') || null;

  const pushBlock = (text, extra = {}) => {
    const clean = (text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    if (!clean) return;
    blocks.push({
      ...emptyBlock(),
      text: clean,
      headingPath: headingPath(),
      blockIndex: blockIndex++,
      atomic: Boolean(extra.atomic),
      type: extra.type ?? 'text',
      ...(extra.rows ? { rows: extra.rows } : {}),
    });
  };

  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      switch (node?.type) {
        case 'heading': {
          const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), MAX_HEADING_LEVEL);
          headingStack.length = Math.min(headingStack.length, level - 1);
          headingStack[level - 1] = inlineText(node).replace(/\s+/g, ' ').trim();
          // The heading line itself is kept: a chunk that starts mid-section
          // then still carries the words the user searched for.
          pushBlock(inlineText(node));
          break;
        }
        case 'paragraph':
          pushBlock(inlineText(node));
          break;
        case 'codeBlock':
          // Atomic: splitting a snippet destroys the thing that made it useful.
          pushBlock(inlineText(node), { atomic: true, type: 'code' });
          break;
        case 'blockquote':
          pushBlock(inlineText(node));
          break;
        case 'image':
          pushBlock(inlineText(node));
          break;
        case 'horizontalRule':
          break;
        case 'table': {
          const rows = tableRows(node);
          if (rows.length > 0) pushBlock(rows.join('\n'), { type: 'table', rows });
          break;
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
          pushBlock(listLines(node).join('\n'));
          break;
        default: {
          // Unknown container (e.g. a Tiptap extension added later): descend
          // into block children rather than dropping the content silently.
          const children = Array.isArray(node?.content) ? node.content : [];
          if (children.some((child) => Array.isArray(child?.content))) walk(children);
          else pushBlock(inlineText(node));
        }
      }
    }
  };

  walk(json?.content);
  return blocks;
}

/** Extract blocks from a stored Yjs update. */
export async function extractBlocks(snapshotBytes) {
  if (!snapshotBytes || snapshotBytes.length === 0) return [];

  // Lazy: the editor's schema is only needed when something is actually
  // indexed, so importing this module in a route costs nothing.
  const { yXmlFragmentToProsemirrorJSON } = await import('@tiptap/y-tiptap');
  const doc = docFromSnapshot(snapshotBytes);
  try {
    const fragment = doc.getXmlFragment('default');
    if (fragment.length === 0) return [];
    return blocksFromJson(yXmlFragmentToProsemirrorJSON(fragment));
  } finally {
    doc.destroy();
  }
}
