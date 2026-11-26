import { describe, expect, it } from 'vitest';
import { blocksFromJson } from '@/lib/rag/extract.js';
import { chunkBlocks, embeddedTextFor, estimateTokens } from '@/lib/rag/chunk.js';

/**
 * These cover the parts of the indexing pipeline that can go wrong silently:
 * structure loss during extraction, and chunk boundaries that split a table or
 * drop the heading context a citation needs. No database involved.
 */

const doc = (content) => ({ type: 'doc', content });

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const heading = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

describe('blocksFromJson', () => {
  it('tracks the heading path for nested sections', () => {
    const blocks = blocksFromJson(
      doc([
        heading(1, 'Chapter 1'),
        paragraph('Intro text.'),
        heading(2, 'Methods'),
        paragraph('Method text.'),
        heading(1, 'Chapter 2'),
        paragraph('Second chapter.'),
      ])
    );

    const byText = (text) => blocks.find((block) => block.text === text);
    expect(byText('Intro text.').headingPath).toBe('Chapter 1');
    expect(byText('Methods').headingPath).toBe('Chapter 1 > Methods');
    expect(byText('Method text.').headingPath).toBe('Chapter 1 > Methods');
    // A new H1 truncates the stack instead of nesting under Methods.
    expect(byText('Second chapter.').headingPath).toBe('Chapter 2');
  });

  it('renders mentions, image alt text and task items as searchable text', () => {
    const blocks = blocksFromJson(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ping ' },
            { type: 'mention', attrs: { id: 'u1', label: 'Ada' } },
            { type: 'image', attrs: { alt: 'Architecture diagram' } },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [paragraph('Ship the release')],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [paragraph('Write docs')],
            },
          ],
        },
      ])
    );

    expect(blocks[0].text).toContain('@Ada');
    expect(blocks[0].text).toContain('[image: Architecture diagram]');
    expect(blocks[1].text).toContain('- [x] Ship the release');
    expect(blocks[1].text).toContain('- [ ] Write docs');
  });

  it('keeps code blocks atomic and tables as rows', () => {
    const blocks = blocksFromJson(
      doc([
        { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;\nconst b = 2;' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [paragraph('Name')] },
                { type: 'tableHeader', content: [paragraph('Role')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [paragraph('Ada')] },
                { type: 'tableCell', content: [paragraph('Owner')] },
              ],
            },
          ],
        },
      ])
    );

    expect(blocks[0].atomic).toBe(true);
    expect(blocks[1].rows).toEqual(['Name | Role', 'Ada | Owner']);
  });

  it('returns nothing for an empty document', () => {
    expect(blocksFromJson(doc([]))).toEqual([]);
    expect(blocksFromJson(doc([paragraph('   ')]))).toEqual([]);
  });
});

describe('chunkBlocks', () => {
  it('starts a new chunk at a heading boundary and carries headingPath', () => {
    const blocks = blocksFromJson(
      doc([heading(1, 'One'), paragraph('A. '.repeat(700)), heading(1, 'Two'), paragraph('B. '.repeat(700))])
    );
    const { chunks } = chunkBlocks(blocks, { targetTokens: 100, maxTokens: 200, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0];
    const last = chunks[chunks.length - 1];
    expect(first.headingPath).toBe('One');
    expect(last.headingPath).toBe('Two');
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
  });

  it('never leaves a chunk above max size when it can split', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const blocks = [{ text, headingPath: null, blockIndex: 0, atomic: false, type: 'text' }];
    const { chunks } = chunkBlocks(blocks, { targetTokens: 50, maxTokens: 100, overlap: 0 });

    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(110);
    }
  });

  it('repeats the header row when splitting a large table', () => {
    const rows = ['Name | Role', ...Array.from({ length: 60 }, (_, i) => `Person ${i} | Editor`)];
    const blocks = [
      { text: rows.join('\n'), rows, headingPath: 'People', blockIndex: 0, atomic: false, type: 'table' },
    ];
    const { chunks } = chunkBlocks(blocks, { targetTokens: 100, maxTokens: 150, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.startsWith('Name | Role')).toBe(true);
      expect(chunk.headingPath).toBe('People');
    }
  });

  it('caps the number of chunks per document', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Row ${i} | Value`);
    const blocks = [{ text: rows.join('\n'), rows, headingPath: 'Big', blockIndex: 0, atomic: false, type: 'table' }];
    const result = chunkBlocks(blocks, { targetTokens: 10, maxTokens: 12, maxChunks: 3 });

    expect(result.chunks).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe('embeddedTextFor', () => {
  it('prefixes title and heading path without changing the stored content', () => {
    expect(
      embeddedTextFor({ title: 'Handbook', headingPath: 'Chapter 3', content: 'Body' })
    ).toBe('Handbook\nChapter 3\nBody');
  });
});
