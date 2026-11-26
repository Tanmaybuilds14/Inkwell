import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sseEvent, streamAnswer } from '@/lib/rag/stream.js';
import { RAGProviderError } from '@/lib/rag/provider.js';

/**
 * Streaming regressions: the SSE frame shape the client parses, token
 * aggregation, usage reporting, and the fallback chain when a model is
 * retired (404) or unavailable (503). An auth/config error must NOT be
 * retried against every fallback — that just spends the free tier's quota.
 */

function sseResponse(frames) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const geminiFrame = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

const baseConfig = {
  llm: {
    provider: 'gemini',
    model: 'primary-model',
    fallbackModels: ['fallback-model'],
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1beta',
    maxOutputTokens: 128,
    thinkingBudget: 0,
    temperature: 0.2,
    topP: 0.95,
    timeoutMs: 5000,
  },
};

const contents = [{ role: 'user', parts: [{ text: 'question' }] }];
const system = 'rules';

describe('sseEvent', () => {
  it('writes the event name and JSON payload on separate lines', () => {
    expect(sseEvent('delta', { text: 'hi' })).toBe('event: delta\ndata: {"text":"hi"}\n\n');
  });
});

describe('streamAnswer', () => {
  let deltas;

  beforeEach(() => {
    deltas = [];
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aggregates deltas in order and reports usage and the model used', async () => {
    fetch.mockResolvedValueOnce(
      sseResponse([
        geminiFrame('Hel'),
        geminiFrame('lo'),
        {
          candidates: [{ content: { parts: [{ text: '' }] } }], // thoughtSignature frame
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 },
        },
      ])
    );

    const result = await streamAnswer({
      system,
      contents,
      config: baseConfig,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result.text).toBe('Hello');
    expect(result.model).toBe('primary-model');
    expect(result.usage).toEqual({ promptTokens: 12, outputTokens: 2 });
  });

  it('sends the system instruction, contents and thinking config', async () => {
    fetch.mockResolvedValueOnce(sseResponse([geminiFrame('ok')]));

    await streamAnswer({ system, contents, config: baseConfig, onDelta: () => {} });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('primary-model:streamGenerateContent?alt=sse');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe(system);
    expect(body.contents).toEqual(contents);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('falls back to the next model when one is retired (404)', async () => {
    fetch
      .mockResolvedValueOnce(new Response('retired', { status: 404 }))
      .mockResolvedValueOnce(sseResponse([geminiFrame('recovered')]));

    const result = await streamAnswer({
      system,
      contents,
      config: baseConfig,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('fallback-model');
    expect(result.model).toBe('fallback-model');
    expect(result.text).toBe('recovered');
    expect(deltas).toEqual(['recovered']);
  });

  it('falls back on a 503 too', async () => {
    fetch
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(sseResponse([geminiFrame('fine')]));

    const result = await streamAnswer({ system, contents, config: baseConfig, onDelta: () => {} });
    expect(result.text).toBe('fine');
  });

  it('does not burn the fallback chain on a non-retryable error', async () => {
    fetch.mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    await expect(
      streamAnswer({ system, contents, config: baseConfig, onDelta: () => {} })
    ).rejects.toBeInstanceOf(RAGProviderError);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting the chain and reports the last mapped code', async () => {
    fetch
      .mockResolvedValueOnce(new Response('retired', { status: 404 }))
      .mockResolvedValueOnce(new Response('retired', { status: 404 }));

    await expect(
      streamAnswer({ system, contents, config: baseConfig, onDelta: () => {} })
    ).rejects.toMatchObject({ code: 'model_unavailable', status: 404 });
  });

  it('does not call the provider once the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      streamAnswer({ system, contents, config: baseConfig, signal: controller.signal, onDelta: () => {} })
    ).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips malformed frames instead of failing the answer', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: not-json\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(geminiFrame('still here'))}\n\n`));
        controller.close();
      },
    });
    fetch.mockResolvedValueOnce(new Response(body, { status: 200 }));

    const result = await streamAnswer({ system, contents, config: baseConfig, onDelta: (delta) => deltas.push(delta) });
    expect(result.text).toBe('still here');
  });
});
