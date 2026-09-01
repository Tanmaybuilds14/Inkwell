import { resolveDocumentRole, hasRole } from '@/lib/permissions';

export function json(data, init = {}) {
  return Response.json(data, init);
}

export function apiError(status, message) {
  return Response.json({ error: message }, { status });
}

/**
 * Loads a document and enforces `required` role for the requesting user.
 * Fail-closed: missing auth, missing doc, or insufficient role all deny.
 * Returns { user, doc, role } or throws a Response to bubble up.
 */
export async function requireDocument(request, documentId, requiredRole, { allowShareToken = true, allowTrashed = false } = {}) {
  const { getCurrentUser } = await import('@/lib/auth');
  const user = await getCurrentUser();

  const url = new URL(request.url);
  const shareToken = allowShareToken ? url.searchParams.get('share') : null;

  const { role, document } = await resolveDocumentRole(documentId, user?.id ?? null, { shareToken, allowTrashed });

  if (!document || !role) {
    // Distinguish existence vs access only for owners; everyone else gets 404.
    throw apiError(404, 'Document not found');
  }
  if (!hasRole(role, requiredRole)) {
    throw apiError(403, `Requires ${requiredRole.toLowerCase()} access`);
  }
  return { user, document, role };
}

/** Wraps a route handler so thrown Responses (from requireDocument) propagate. */
export async function handle(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[api] unhandled error:', err);
    return apiError(500, 'Internal server error');
  }
}
