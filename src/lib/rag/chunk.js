/**
 * Heading-aware chunker (PLAN §6.2).
 *
 * Break order is heading → paragraph → sentence, with code blocks kept whole
 * and large tables split by rows (header repeated). The stored `content` stays
 * clean for citation display; the string we embed is `embeddedTextFor(...)`,
 * prefixed with the document title and heading path so a chunk under
 * "Chapter 3" is retrievable by chapter name.
 */

/** Roughly the ratio the plan's sizing assumes (~500 tokens ≈ 1,800 chars). */
const CHARS_PER_TOKEN = 3.6;

export const estimateTokens = (text) => Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);

/** Split prose on sentence boundaries, hard-splitting any oversized sentence. */
function splitLongText(text, maxChars) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const pieces = [];
  let buffer = '';

  const pushBuffer = () => {
    if (buffer.trim()) pieces.push(buffer.trim());
    buffer = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      pushBuffer();
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (buffer.length + sentence.length + 1 > maxChars) pushBuffer();
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  pushBuffer();
  return pieces.filter(Boolean);
}

/** Split a code block by lines — a hard character split would cut identifiers. */
function splitCode(text, maxChars) {
  const lines = text.split('\n');
  const pieces = [];
  let buffer = '';
  for (const line of lines) {
    if (line.length > maxChars) {
      if (buffer) pieces.push(buffer) && (buffer = '');
      for (let i = 0; i < line.length; i += maxChars) pieces.push(line.slice(i, i + maxChars));
      continue;
    }
    if (buffer.length + line.length + 1 > maxChars) {
      if (buffer) pieces.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer}\n${line}` : line;
  }
  if (buffer) pieces.push(buffer);
  return pieces.filter(Boolean);
}

/** Split a table by rows, repeating the header row in every piece. */
function splitTable(rows, maxChars) {
  if (rows.length <= 1) return [rows.join('\n')];
  const header = rows[0];
  const pieces = [];
  let buffer = [header];
  let size = header.length;

  for (const row of rows.slice(1)) {
    if (size + row.length + 1 > maxChars && buffer.length > 1) {
      pieces.push(buffer.join('\n'));
      buffer = [header];
      size = header.length;
    }
    buffer.push(row);
    size += row.length + 1;
  }
  if (buffer.length > 1) pieces.push(buffer.join('\n'));
  return pieces;
}

function piecesForBlock(block, maxChars) {
  if (block.type === 'table' && Array.isArray(block.rows) && block.text.length > maxChars) {
    return splitTable(block.rows, maxChars).map((text) => ({ text, headingPath: block.headingPath }));
  }
  if (block.text.length <= maxChars) {
    return [{ text: block.text, headingPath: block.headingPath }];
  }
  if (block.atomic) {
    return splitCode(block.text, maxChars).map((text) => ({ text, headingPath: block.headingPath }));
  }
  return splitLongText(block.text, maxChars).map((text) => ({ text, headingPath: block.headingPath }));
}

/** Last `size` characters of `content`, advanced to a sentence boundary. */
function overlapTail(content, size) {
  if (size <= 0 || content.length <= size) return '';
  const tail = content.slice(content.length - size);
  const boundary = tail.search(/[.!?]\s/);
  if (boundary > -1 && boundary + 2 < tail.length) return tail.slice(boundary + 2).trim();
  const newline = tail.indexOf('\n');
  return (newline > -1 ? tail.slice(newline + 1) : tail).trim();
}

/**
 * Chunk extracted blocks.
 *
 * Returns `[{ content, headingPath, chunkIndex, charStart, charEnd, tokenCount }]`.
 * `truncated` is true when the 2,000-chunk guardrail dropped content.
 */
export function chunkBlocks(blocks, options = {}) {
  const {
    targetTokens = 500,
    maxTokens = 800,
    overlap = 0.15,
    maxChunks = 2000,
  } = options;

  const targetChars = Math.max(200, Math.round(targetTokens * CHARS_PER_TOKEN));
  const maxChars = Math.max(targetChars, Math.round(maxTokens * CHARS_PER_TOKEN));
  const overlapChars = Math.round(targetChars * Math.min(Math.max(overlap, 0), 0.5));

  const pieces = [];
  for (const block of blocks ?? []) pieces.push(...piecesForBlock(block, maxChars));

  const chunks = [];
  let current = null;
  let position = 0;

  function flush() {
    if (!current) return null;
    const content = current.parts.join('\n\n').trim();
    const finished = content
      ? {
          content,
          headingPath: current.headingPath,
          charStart: current.start,
          charEnd: current.end,
          tokenCount: estimateTokens(content),
        }
      : null;
    current = null;
    if (finished) chunks.push(finished);
    return finished;
  }

  for (const piece of pieces) {
    const start = position;
    position += piece.text.length + 1;

    const needsNew =
      !current ||
      current.headingPath !== piece.headingPath ||
      current.chars + piece.text.length + 2 > targetChars;

    if (needsNew) {
      const finished = flush();
      current = { headingPath: piece.headingPath, parts: [], chars: 0, start, end: position };

      // Overlap only within the same section: carrying text across a heading
      // boundary would attribute one section's prose to another.
      if (finished && finished.headingPath === piece.headingPath && overlapChars > 0) {
        const tail = overlapTail(finished.content, overlapChars);
        if (tail) {
          current.parts.push(tail);
          current.chars += tail.length + 2;
        }
      }
    }

    current.parts.push(piece.text);
    current.chars += piece.text.length + 2;
    current.end = position;
  }
  flush();

  const truncated = chunks.length > maxChunks;
  return {
    chunks: (truncated ? chunks.slice(0, maxChunks) : chunks).map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
    })),
    truncated,
  };
}

/** The exact string embedded for a chunk (title + heading path + body). */
export function embeddedTextFor({ title, headingPath, content }) {
  return [title?.trim(), headingPath?.trim(), content].filter(Boolean).join('\n');
}
