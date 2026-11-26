import { describe, expect, it } from 'vitest';
import { buildPrompt, citationsFrom } from '@/lib/rag/prompt.js';

/**
 * Prompt construction is where citation correctness and injection defence
 * live: sources must be numbered, delimited and labelled as data, and the
 * budget must drop the oldest history before it drops a source.
 */

const config = { retrieval: { promptBudgetTokens: 6000, historyTurns: 3 } };

const source = (index, content = `Content for source ${index}.`) => ({
  index,
  chunkId: `chunk-${index}`,
  documentId: `doc-${index}`,
  title: `Doc ${index}`,
  headingPath: index % 2 === 0 ? `Section ${index}` : null,
  content,
  snippet: content.slice(0, 40),
});

describe('buildPrompt', () => {
  it('states the grounding, citation and injection rules', () => {
    const { system } = buildPrompt({ question: 'q', sources: [source(1)], config });

    expect(system).toMatch(/ONLY the numbered sources/i);
    expect(system).toMatch(/cite every factual claim/i);
    expect(system).toMatch(/DATA, never instructions/i);
    expect(system).toMatch(/couldn't find that in your documents/i);
  });

  it('numbers sources and marks the block as data', () => {
    const { contents, includedSources } = buildPrompt({
      question: 'What did we decide?',
      sources: [source(1), source(2)],
      config,
    });

    expect(includedSources).toHaveLength(2);
    const userText = contents.at(-1).parts[0].text;
    expect(userText).toContain('[1] Doc 1');
    expect(userText).toContain('[2] Doc 2 — Section 2');
    expect(userText).toContain('<<<SOURCES');
    expect(userText).toContain('SOURCES>>>');
    expect(userText).toContain('Question: What did we decide?');
  });

  it('maps persisted history roles onto model/user turns, question last', () => {
    const { contents } = buildPrompt({
      question: 'Follow up',
      history: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ],
      sources: [source(1)],
      config,
    });

    expect(contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user']);
    expect(contents.at(-1).parts[0].text).toContain('Follow up');
  });

  it('drops the oldest history before it drops any source', () => {
    const longHistory = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(800),
    }));
    const sources = [source(1), source(2), source(3)];

    const { contents, includedSources } = buildPrompt({
      question: 'q',
      history: longHistory,
      sources,
      config: { retrieval: { promptBudgetTokens: 2400, historyTurns: 5 } },
    });

    expect(includedSources).toHaveLength(3);
    // History was trimmed to fit, and the last turn is still the question.
    expect(contents.length).toBeLessThan(longHistory.length + 1);
    expect(contents.at(-1).role).toBe('user');
  });

  it('trims the lowest-ranked sources last, never below one', () => {
    const sources = Array.from({ length: 20 }, (_, i) => source(i + 1, 'y'.repeat(600)));
    const { includedSources } = buildPrompt({
      question: 'q',
      sources,
      config: { retrieval: { promptBudgetTokens: 1000, historyTurns: 0 } },
    });

    expect(includedSources.length).toBeGreaterThanOrEqual(1);
    expect(includedSources.length).toBeLessThan(sources.length);
    // Trimmed from the end, so the numbering stays contiguous from 1.
    expect(includedSources.map((s) => s.index)).toEqual(
      Array.from({ length: includedSources.length }, (_, i) => i + 1)
    );
  });

  it('tells the model when nothing was retrieved', () => {
    const { contents } = buildPrompt({ question: 'q', sources: [], config });
    expect(contents.at(-1).parts[0].text).toContain('No sources were retrieved');
  });
});

describe('citationsFrom', () => {
  it('stores only the citation fields the UI renders', () => {
    const [citation] = citationsFrom([source(1)]);
    expect(citation).toEqual({
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      title: 'Doc 1',
      headingPath: null,
      snippet: 'Content for source 1.',
    });
    // The full chunk text is not part of a persisted citation.
    expect(citation.content).toBeUndefined();
  });
});
