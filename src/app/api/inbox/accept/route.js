import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';
import { acceptInboxItem } from '@/lib/inbox';

/**
 * POST /api/inbox/accept — accept an invite or link_opened item.
 * Marks meta.acceptedAt and ensures a Permission row so the document lands
 * in the receiver's dashboard under "Shared with me".
 */
export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    if (typeof body.id !== 'string' || !body.id) {
      return apiError(400, 'id is required');
    }

    const item = await acceptInboxItem(user.id, body.id);
    if (!item) return apiError(404, 'Item not found or cannot be accepted');

    return json({ item });
  });
}
