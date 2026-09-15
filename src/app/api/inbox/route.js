import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';
import { listInbox, markInboxRead, deleteInboxItems } from '@/lib/inbox';

/**
 * GET /api/inbox — the signed-in user's inbox page with unread count.
 * Query: ?cursor=<id>&limit=<n> for pagination.
 */
export async function GET(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = url.searchParams.get('limit') ?? undefined;

    const data = await listInbox(user.id, { cursor, limit });
    return json(data);
  });
}

/**
 * PATCH /api/inbox — mark items as read.
 * Body: { ids: string[] } for specific items, or { all: true } for everything.
 */
export async function PATCH(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));

    if (body.all === true) {
      const updated = await markInboxRead(user.id, null);
      return json({ updated });
    }

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((id) => typeof id === 'string').slice(0, 100);
      if (ids.length === 0) return apiError(400, 'No valid item ids');
      const updated = await markInboxRead(user.id, ids);
      return json({ updated });
    }

    return apiError(400, 'Provide ids or all:true');
  });
}

/**
 * DELETE /api/inbox — remove items from the inbox.
 * Body: { ids: string[] } (required; no blanket wipe).
 */
export async function DELETE(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return apiError(400, 'ids is required');
    }

    const ids = body.ids.filter((id) => typeof id === 'string').slice(0, 100);
    if (ids.length === 0) return apiError(400, 'No valid item ids');

    const deleted = await deleteInboxItems(user.id, ids);
    return json({ deleted });
  });
}
