/**
 * Shared HTTP client for every RAG provider call.
 *
 * Free tiers answer with 429s and 503s routinely (PLAN §3.4, §15), so retry
 * and error mapping live here rather than in each adapter — and the mapped
 * codes are what the chat route turns into user-facing SSE errors. A raw
 * provider body never reaches the browser.
 */

export class RAGProviderError extends Error {
  constructor(message, { code = 'provider_error', status = 0, retryAfterSeconds = 0 } = {}) {
    super(message);
    this.name = 'RAGProviderError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maps an HTTP status onto the stable error codes the API speaks. */
function codeForStatus(status) {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_error';
}

function retryAfterSeconds(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds : 0;
}

/**
 * POST JSON with a timeout, bounded retries and backoff.
 *
 * Only 429 and 5xx are retried: a 400/404 is our bug or a retired model, and
 * repeating it just spends the free tier's quota. `signal` is the request's
 * cancellation signal — a user who pressed stop must not keep a provider
 * request alive.
 */
export async function postJson(url, { headers = {}, body, timeoutMs = 30_000, retries = 2, signal } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: combined,
        cache: 'no-store',
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const wait = retryAfterSeconds(response.headers);
        const error = new RAGProviderError(
          `Provider responded ${response.status}: ${text.slice(0, 200)}`,
          { code: codeForStatus(response.status), status: response.status, retryAfterSeconds: wait }
        );
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === retries) throw error;

        lastError = error;
        await sleep(wait > 0 ? Math.min(wait, 10) * 1000 : 300 * 2 ** attempt);
        continue;
      }

      return await response.json();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof RAGProviderError) throw err;
      // Network failure or timeout.
      const wrapped = new RAGProviderError(
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? 'Provider request timed out'
          : `Provider request failed: ${err?.message ?? 'unknown error'}`,
        { code: 'provider_unavailable' }
      );
      if (attempt === retries) throw wrapped;
      lastError = wrapped;
      await sleep(300 * 2 ** attempt);
    }
  }

  throw lastError ?? new RAGProviderError('Provider request failed', { code: 'provider_unavailable' });
}
