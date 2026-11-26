import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for POST /api/rag/chat — the route that carries the whole
 * isolation contract (PLAN §8.3):
 *
 *   - identity comes from the session, never the body;
 *   - a requested scope narrows but never widens (owner filter still applied);
 *   - a foreign thread is a 404, not a 403;
 *   - the SSE order is sources → delta… → done;
 *   - RAG rate limits apply independently of PERF_TEST.
 */

const state = vi.hoisted(() => ({
  user: { id: 'user-a' },
  threadFindFirst: vi.fn(),
  threadCreate: vi.fn(),
  threadUpdate: vi.fn(),
  messageCreate: vi.fn(),
  messageFindMany: vi.fn(),
  documentFindMany: vi.fn(),
  retrieve: vi.fn(),
  streamAnswer: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => state.user }));
// No Redis: the limiter/budget code falls back to its in-process path.
vi.mock('@/lib/redis', () => ({ getPublisher: () => null }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatThread: {
      findFirst: state.threadFindFirst,
      create: state.threadCreate,
      update: state.threadUpdate,
    },
    chatMessage: { create: state.messageCreate, findMany: state.messageFindMany },
    document: { findMany: state.documentFindMany },
  },
}));
vi.mock('@/lib/rag/retrieve.js', () => ({ retrieve: state.retrieve }));
vi.mock('@/lib/rag/stream.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, streamAnswer: state.streamAnswer };
});

const { POST } = await import('@/app/api/rag/chat/route.js');

const RETRIEVED = {
  candidateCount: 1,
  sources: [
    {
      index: 1,
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      title: 'Handbook',
      headingPath: 'Chapter 1',
      content: 'Permissions are decided by the owner.',
      snippet: 'Permissions are decided by the owner.',
      score: 0.9,
    },
  ],
};

const post = (body) =>
  POST(
    new Request('http://localhost/api/rag/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'user-a' };
  delete process.env.RAG_CHAT_RATE_LIMIT;

  state.threadCreate.mockResolvedValue({ id: 'thread-new', title: null });
  state.threadFindFirst.mockResolvedValue({ id: 'thread-1', title: 'Existing' });
  state.threadUpdate.mockResolvedValue({});
  state.messageCreate.mockResolvedValue({ id: 'msg-assistant' });
  state.messageFindMany.mockResolvedValue([]);
  state.documentFindMany.mockResolvedValue([{ id: 'doc-1' }]);
  state.retrieve.mockResolvedValue(RETRIEVED);
  state.streamAnswer.mockImplementation(async ({ onDelta }) => {
    onDelta('The owner ');
    onDelta('decides.');
    return { text: 'The owner decides.', usage: { promptTokens: 40, outputTokens: 4 }, model: 'gemini-test' };
  });
});

describe('authentication and input', () => {
  it('returns 401 when signed out and never touches the database', async () => {
    state.user = null;
    const response = await post({ message: 'hello' });

    expect(response.status).toBe(401);
    expect(state.threadCreate).not.toHaveBeenCalled();
    expect(state.documentFindMany).not.toHaveBeenCalled();
  });

  it('rejects an empty question', async () => {
    const response = await post({ message: '   ' });
    expect(response.status).toBe(400);
  });
});

describe('thread ownership', () => {
  it('looks a thread up by id AND owner', async () => {
    await post({ message: 'q', threadId: 'thread-other' });

    expect(state.threadFindFirst).toHaveBeenCalledWith({
      where: { id: 'thread-other', userId: 'user-a' },
      select: { id: true, title: true },
    });
  });

  it('returns 404 for a thread the user does not own', async () => {
    state.threadFindFirst.mockResolvedValue(null);
    const response = await post({ message: 'q', threadId: 'thread-other' });

    expect(response.status).toBe(404);
    expect(state.messageCreate).not.toHaveBeenCalled();
  });
});

describe('scope narrowing', () => {
  it('keeps the owner filter when a document id is requested', async () => {
    await post({ message: 'q', scope: { type: 'document', documentId: 'foreign-doc' } });

    const { where } = state.documentFindMany.mock.calls[0][0];
    expect(where).toEqual({ ownerId: 'user-a', deletedAt: null, id: 'foreign-doc' });
  });

  it('keeps the owner filter when a folder id is requested', async () => {
    await post({ message: 'q', scope: { type: 'folder', folderId: 'folder-x' } });

    const { where } = state.documentFindMany.mock.calls[0][0];
    expect(where).toEqual({ ownerId: 'user-a', deletedAt: null, folderId: 'folder-x' });
  });

  it('an empty intersection answers with no_sources instead of falling back to everything', async () => {
    state.documentFindMany.mockResolvedValue([]);

    const response = await post({ message: 'q', scope: { type: 'document', documentId: 'foreign-doc' } });
    const body = await response.text();

    expect(body).toContain('event: error');
    expect(body).toContain('no_sources');
    expect(body).toContain('thread-new');
    expect(state.retrieve).not.toHaveBeenCalled();
  });
});

describe('streaming contract', () => {
  it('emits sources before deltas, then done with the persisted message id', async () => {
    const response = await post({ message: 'Who decides permissions?' });
    const body = await response.text();

    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform');

    const sourcesAt = body.indexOf('event: sources');
    const deltaAt = body.indexOf('event: delta');
    const doneAt = body.indexOf('event: done');

    expect(sourcesAt).toBeGreaterThanOrEqual(0);
    expect(deltaAt).toBeGreaterThan(sourcesAt);
    expect(doneAt).toBeGreaterThan(deltaAt);
    expect(body).toContain('"text":"The owner "');
    expect(body).toContain('"messageId":"msg-assistant"');
    expect(body).toContain('"model":"gemini-test"');
  });

  it('shows the model exactly the numbered sources, then persists citations from them', async () => {
    await post({ message: 'Who decides permissions?' });

    const promptInput = state.streamAnswer.mock.calls[0][0];
    expect(promptInput.contents.at(-1).parts[0].text).toContain('[1] Handbook — Chapter 1');

    // First write is the question, second is the answer with citations.
    expect(state.messageCreate).toHaveBeenCalledTimes(2);
    const assistant = state.messageCreate.mock.calls[1][0].data;
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('The owner decides.');
    expect(assistant.citations).toEqual([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        title: 'Handbook',
        headingPath: 'Chapter 1',
        snippet: 'Permissions are decided by the owner.',
      },
    ]);
  });

  it('persists the question even when retrieval fails', async () => {
    state.retrieve.mockRejectedValue(new Error('embedding down'));

    const response = await post({ message: 'q' });
    const body = await response.text();

    expect(body).toContain('event: error');
    expect(body).toContain('provider_unavailable');
    expect(state.messageCreate).toHaveBeenCalledTimes(1);
    expect(state.messageCreate.mock.calls[0][0].data.role).toBe('user');
  });
});

describe('rate limiting', () => {
  it('429s past RAG_CHAT_RATE_LIMIT independently of PERF_TEST', async () => {
    process.env.PERF_TEST = '1';
    process.env.RAG_CHAT_RATE_LIMIT = '1';
    state.user = { id: `limited-${Math.random().toString(36).slice(2)}` };

    try {
      await post({ message: 'first' });
      const second = await post({ message: 'second' });

      expect(second.status).toBe(429);
      expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
    } finally {
      delete process.env.RAG_CHAT_RATE_LIMIT;
      delete process.env.PERF_TEST;
    }
  });
});
