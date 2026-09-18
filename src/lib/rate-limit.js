import { getPublisher } from '@/lib/redis';
import {
  RATE_LIMITS,
  fixedWindow,
  createMemoryCounter,
  rateLimitKey,
} from '../../shared/rate-limit.js';

// Re-exported so route modules configure limits from one place.
export { RATE_LIMITS };

/**
 * Per-process fallback, used when REDIS_URL is unset (local dev) and when a
 * Redis call fails. Sharing one instance keeps counts consistent across the
 * two paths for the lifetime of the process.
 */
const memory = createMemoryCounter();

/**
 * Count one attempt against `bucket`/`id` and return the limiter's decision.
 *
 * On a Redis error this falls back to the in-process counter rather than
 * allowing everything: the deployment loses cross-instance accuracy, but a
 * single instance still can't be hammered. Availability wins over strictness
 * (a Redis blip must not take down the API) and auth is enforced regardless.
 */
export async function consume(bucket, id, spec) {
  const key = rateLimitKey(bucket, id);
  const client = getPublisher();
  if (!client) return memory.consume(key, spec);
  try {
    return await fixedWindow(client, key, spec);
  } catch (err) {
    console.error('[rate-limit] redis counter failed, using in-process fallback:', err.message);
    return memory.consume(key, spec);
  }
}

/**
 * The client IP, or null when it cannot be trusted.
 *
 * Next.js route handlers expose no socket address, so the only source is a
 * proxy header — and `x-forwarded-for` is attacker-controlled if no proxy
 * overwrites it. It is therefore honoured only when TRUST_PROXY=1 says a
 * proxy is actually in front (set it on Vercel/Fly/Railway; leave it unset
 * when the app is reached directly). Callers that get null key their bucket
 * by document instead, which is the granularity that actually protects a
 * per-document secret.
 */
export function clientIp(request) {
  if (process.env.TRUST_PROXY !== '1') return null;
  const forwarded = request.headers.get('x-forwarded-for');
  // Left-most entry is the original client as recorded by the first proxy.
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip') ?? null;
}

/** 429 with the retry hint both the browser and the client code can use. */
export function rateLimited(result, message = 'Too many requests — slow down and try again shortly.') {
  return Response.json(
    { error: message, retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * Guard a `?share=` attempt. Share tokens are bearer credentials, so both the
 * per-document bucket (protects the secret itself) and — when the deployment
 * can name a client — the per-IP bucket (protects the database from one
 * source sweeping many documents) apply.
 *
 * Returns a 429 Response to throw, or null to continue.
 */
export async function throttleShareLinkAttempt(request, documentId) {
  const perDocument = await consume('share-link-doc', documentId, RATE_LIMITS.SHARE_LINK_DOC);
  if (!perDocument.allowed) {
    return rateLimited(perDocument, 'Too many share-link attempts for this document.');
  }
  const ip = clientIp(request);
  if (ip) {
    const perIp = await consume('share-link-ip', ip, RATE_LIMITS.SHARE_LINK_IP);
    if (!perIp.allowed) {
      return rateLimited(perIp, 'Too many share-link attempts. Try again shortly.');
    }
  }
  return null;
}

/**
 * Guard a mutating API call for a signed-in user. Returns a 429 Response to
 * throw, or null to continue.
 */
export async function throttleWrite(userId, spec = RATE_LIMITS.WRITE, bucket = 'write') {
  const result = await consume(bucket, userId, spec);
  return result.allowed ? null : rateLimited(result);
}
