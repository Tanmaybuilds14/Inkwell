import { RAGProviderError } from './provider.js';

/**
 * SSE helpers for the chat route (PLAN §7.6).
 *
 * The contract the client relies on:
 *   event: sources → delta… → done | error
 * `sources` is emitted before the first delta so citation chips can render
 * while the answer types.
 */

export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseResponse(stream) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Splits an SSE body into `data:` payloads, tolerating chunk boundaries. */
async function* readSsePayloads(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const payload = trimmed.slice(5).trim();
            if (payload && payload !== '[DONE]') yield payload;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function textFromGeminiFrame(frame) {
  const parts = frame?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  // The final frame carries a thoughtSignature with empty text — harmless.
  return parts.map((part) => part?.text ?? '').join('');
}

async function streamGemini({ model, system, contents, config, signal, onDelta }) {
  const url = `${config.llm.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: config.llm.temperature,
      topP: config.llm.topP,
      maxOutputTokens: config.llm.maxOutputTokens,
      thinkingConfig: { thinkingBudget: config.llm.thinkingBudget },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.llm.apiKey,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(config.llm.timeoutMs)]) : AbortSignal.timeout(config.llm.timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const status = response.status;
    throw new RAGProviderError(`Gemini ${status}: ${text.slice(0, 200)}`, {
      status,
      code: status === 404 ? 'model_unavailable' : status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'provider_error',
    });
  }

  let text = '';
  let usage = { promptTokens: 0, outputTokens: 0 };

  for await (const payload of readSsePayloads(response)) {
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = textFromGeminiFrame(frame);
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    const meta = frame?.usageMetadata;
    if (meta) {
      usage = {
        promptTokens: meta.promptTokenCount ?? usage.promptTokens,
        outputTokens: meta.candidatesTokenCount ?? usage.outputTokens,
      };
    }
  }

  return { text, usage, model };
}

async function streamOpenAICompatible({ model, system, contents, config, signal, onDelta }) {
  const url = `${config.llm.baseUrl.replace(/\/v1beta$/, '/v1')}/chat/completions`;
  const messages = [
    { role: 'system', content: system },
    ...contents.map((turn) => ({
      role: turn.role === 'model' ? 'assistant' : turn.role,
      content: turn.parts.map((part) => part.text).join(''),
    })),
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: config.llm.temperature,
      max_tokens: config.llm.maxOutputTokens,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(config.llm.timeoutMs)]) : AbortSignal.timeout(config.llm.timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const status = response.status;
    throw new RAGProviderError(`LLM ${status}: ${text.slice(0, 200)}`, {
      status,
      code: status === 404 ? 'model_unavailable' : status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'provider_error',
    });
  }

  let text = '';
  let usage = { promptTokens: 0, outputTokens: 0 };

  for await (const payload of readSsePayloads(response)) {
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = frame?.choices?.[0]?.delta?.content ?? '';
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    if (frame?.usage) {
      usage = { promptTokens: frame.usage.prompt_tokens ?? 0, outputTokens: frame.usage.completion_tokens ?? 0 };
    }
  }

  return { text, usage, model };
}

/**
 * Stream an answer, walking the configured fallback chain.
 *
 * A retired model (404) or an unavailable one (503) moves to the next id;
 * anything else propagates. `onDelta` is called for each token as it arrives.
 */
export async function streamAnswer({ system, contents, config, signal, onDelta }) {
  const models = [config.llm.model, ...config.llm.fallbackModels].filter(Boolean);
  let lastError = null;

  for (const model of models) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const stream = config.llm.provider === 'gemini' ? streamGemini : streamOpenAICompatible;
      return await stream({ model, system, contents, config, signal, onDelta });
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      lastError = err;
      const retryable = err instanceof RAGProviderError && (err.code === 'model_unavailable' || err.code === 'provider_unavailable' || err.code === 'rate_limited');
      if (!retryable) throw err;
    }
  }

  throw lastError ?? new RAGProviderError('No answer model available', { code: 'provider_unavailable' });
}
