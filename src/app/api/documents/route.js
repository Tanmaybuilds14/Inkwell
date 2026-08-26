import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';

export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId: user.id },
        select: { id: true },
      });
      if (!folder) return apiError(404, 'Folder not found');
    }

    const doc = await prisma.document.create({
      data: {
        title: 'Untitled',
        ownerId: user.id,
        folderId,
        originalFolderId: folderId,
      },
      select: { id: true, title: true, createdAt: true },
    });

    track(EVENTS.DOC_CREATED, { document_id: doc.id, owner_id: user.id });
    return json({ document: doc }, { status: 201 });
  });
}

export async function GET(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const url = new URL(request.url);
    const folderId = url.searchParams.get('folderId'); // null = root only
    const q = url.searchParams.get('q')?.trim();
    const scope = url.searchParams.get('scope') ?? 'owned'; // owned | shared

    if (q) {
      // Title search across everything the user can see.
      const docs = await prisma.document.findMany({
        where: {
          deletedAt: null,
          OR: [
            { ownerId: user.id },
            { permissions: { some: { userId: user.id } } },
          ],
          ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        },
        select: DOCUMENT_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      return json({ documents: docs });
    }

    if (scope === 'shared') {
      const docs = await prisma.document.findMany({
        where: {
          deletedAt: null,
          ownerId: { not: user.id },
          permissions: { some: { userId: user.id } },
        },
        select: DOCUMENT_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      return json({ documents: docs });
    }

    const docs = await prisma.document.findMany({
      where: {
        ownerId: user.id,
        deletedAt: null,
        folderId: folderId ?? null,
      },
      select: DOCUMENT_LIST_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return json({ documents: docs });
  });
}

const DOCUMENT_LIST_SELECT = {
  id: true,
  title: true,
  folderId: true,
  updatedAt: true,
  createdAt: true,
  shareEnabled: true,
} ;
