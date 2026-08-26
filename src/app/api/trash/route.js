import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';

const TRASH_RETENTION_DAYS = 30;

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const docs = await prisma.document.findMany({
      where: {
        ownerId: user.id,
        deletedAt: { not: null },
      },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        originalFolderId: true,
      },
      orderBy: { deletedAt: 'desc' },
      take: 200,
    });

    const purgeBefore = new Date(
      Date.now() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    return json({ documents: docs, purgeBefore });
  });
}

// Permanently empty the trash (owner only). Individual permanent deletes are
// handled by DELETE /api/trash with ?docId=...
export async function DELETE(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const url = new URL(request.url);
    const docId = url.searchParams.get('docId');

    if (docId) {
      // Scoped by owner so permission checks can't be bypassed by ID guessing.
      await prisma.document.deleteMany({
        where: { id: docId, ownerId: user.id, deletedAt: { not: null } },
      });
    } else {
      await prisma.document.deleteMany({
        where: { ownerId: user.id, deletedAt: { not: null } },
      });
    }
    return json({ ok: true });
  });
}
