import { getCurrentUser } from '@/lib/auth';
import { ensureSchema } from '@/lib/migrations';
import { handle, apiError, json } from '@/lib/api-helpers';
import { listActivity, activityStats } from '@/lib/activity';

/**
 * GET /api/activity — the signed-in user's own audit trail.
 * Query: ?cursor=<id>&limit=<n> for pagination; ?stats=1 to include totals.
 */
export async function GET(request) {
  return handle(async () => {
    await ensureSchema();
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = url.searchParams.get('limit');

    const [{ events, nextCursor }, stats] = await Promise.all([
      listActivity(user.id, { cursor, limit }),
      activityStats(user.id),
    ]);

    return json({ events, nextCursor, stats });
  });
}
