import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handle, apiError, json } from '@/lib/api-helpers';
import { normalizeScope } from '@/lib/rag/owner-docs.js';

/**
 * /api/rag/threads/[id] — one thread, always scoped to its owner.
 *
 * A missing thread and a foreign thread both return 404: 403 would confirm
 * that an id exists, which is exactly what an attacker probing ids wants.
 */

async function ownedThread(userId, threadId) {
  return prisma.chatThread.findFirst({ where: { id: threadId, userId }, select: { id: true } });
}

export async function GET(request, { params }) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const { id } = await params;
    const thread = await prisma.chatThread.findFirst({
      where: { id, userId: user.id },
      select: { id: true, title: true, scope: true, createdAt: true, updatedAt: true },
    });
    if (!thread) return apiError(404, 'Thread not found');

    const messages = await prisma.chatMessage.findMany({
      where: { threadId: id },
      select: { id: true, role: true, content: true, citations: true, model: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return json({ thread, messages });
  });
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const { id } = await params;
    if (!(await ownedThread(user.id, id))) return apiError(404, 'Thread not found');

    const body = await request.json().catch(() => ({}));
    const data = {};
    if (typeof body?.title === 'string') data.title = body.title.trim().slice(0, 120) || null;
    if (body?.scope) data.scope = normalizeScope(body.scope);
    if (Object.keys(data).length === 0) return apiError(400, 'Nothing to update');

    const thread = await prisma.chatThread.update({
      where: { id },
      data,
      select: { id: true, title: true, scope: true, updatedAt: true },
    });
    return json({ thread });
  });
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const { id } = await params;
    if (!(await ownedThread(user.id, id))) return apiError(404, 'Thread not found');

    // Messages cascade with the thread.
    await prisma.chatThread.delete({ where: { id } });
    return json({ deleted: true });
  });
}
