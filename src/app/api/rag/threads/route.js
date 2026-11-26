import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handle, apiError, json } from '@/lib/api-helpers';
import { normalizeScope } from '@/lib/rag/owner-docs.js';

/**
 * /api/rag/threads — the signed-in user's chat threads.
 *
 * `userId` is in the WHERE clause of every read and write; a thread id alone
 * is never authority enough to read or mutate a thread.
 */

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const threads = await prisma.chatThread.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, scope: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return json({ threads });
  });
}

export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 120) : null;
    const scope = normalizeScope(body?.scope);

    const thread = await prisma.chatThread.create({
      data: { userId: user.id, title: title || null, scope },
      select: { id: true, title: true, scope: true, createdAt: true, updatedAt: true },
    });
    return json({ thread }, { status: 201 });
  });
}
