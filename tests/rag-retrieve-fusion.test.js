import { describe, expect, it } from 'vitest';
import { fuse } from '@/lib/rag/retrieve.js';

/**
 * RRF is the seam between the two retrievers. Merging must (a) reward a chunk
 * found by both, (b) preserve order within a single list, and (c) never invent
 * a chunk — the isolation guarantee comes from the SQL, so fusion must not add
 * anything the owner-filtered queries did not return.
 */

const row = (id) => ({ id, documentId: `doc-${id}`, content: `text ${id}`, headingPath: null, title: 'Doc' });

describe('fuse — reciprocal rank fusion', () => {
  it('ranks a chunk found by both listers above one found by either', () => {
    const fused = fuse([[row('a'), row('b')], [row('b'), row('c')]], { rrfK: 60 });
    expect(fused.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('preserves the dense order when there is no lexical overlap', () => {
    const fused = fuse([[row('x'), row('y'), row('z')], []], { rrfK: 60 });
    expect(fused.map((entry) => entry.id)).toEqual(['x', 'y', 'z']);
  });

  it('never returns a chunk that neither list contained', () => {
    const fused = fuse([[row('a')], [row('b')]], { rrfK: 60 });
    expect(new Set(fused.map((entry) => entry.id))).toEqual(new Set(['a', 'b']));
  });

  it('respects the limit and keeps everything it returns', () => {
    const dense = Array.from({ length: 40 }, (_, i) => row(`d${i}`));
    const fused = fuse([dense, []], { rrfK: 60, limit: 30 });
    expect(fused).toHaveLength(30);
    expect(fused[0].id).toBe('d0');
  });

  it('merges metadata from the first list that saw the chunk', () => {
    const fused = fuse([[{ ...row('a'), title: 'From dense' }], [{ ...row('a'), title: 'From lexical' }]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].title).toBe('From dense');
  });

  it('handles empty input', () => {
    expect(fuse([[], []])).toEqual([]);
  });
});
