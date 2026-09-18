import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';
import { logActivity, ACTIVITY_TYPES } from '@/lib/activity';
import { throttleWrite, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    // Creating documents is cheap for a client and expensive for the database;
    // cap it per user over a long window. Nothing else in this route needs a
    // limiter — GET is idempotent and already scoped to the caller's own docs.
    const limited = await throttleWrite(user.id, RATE_LIMITS.DOC_CREATE, 'doc-create');
    if (limited) return limited;

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
    logActivity(ACTIVITY_TYPES.DOC_CREATED, { userId: user.id, documentId: doc.id, docTitle: doc.title });
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
      // Title search, scoped to the selected tab. Without the scope filter the
      // 'shared' tab's search silently returns the user's own docs as well.
      const docs = await prisma.document.findMany({
        where: {
          deletedAt: null,
          ...(scope === 'shared'
            ? {
                ownerId: { not: user.id },
                permissions: { some: { userId: user.id } },
              }
            : {
                OR: [
                  { ownerId: user.id },
                  { permissions: { some: { userId: user.id } } },
                ],
              }),
          title: { contains: q, mode: 'insensitive' },
        },
        select: DOCUMENT_LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      return json({ documents: docs.map(withOwnership(user.id)) });
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
      return json({ documents: docs.map(withOwnership(user.id)) });
    }

    // Default view. Root lists the user's own root-level documents PLUS
    // everything shared with them — received documents must be visible
    // without hunting for the "Shared with me" tab (they are saved on the
    // receiver's side via Permission rows, but this is where they show up).
    // A specific folder lists only that folder's owned documents.
    const docs = await prisma.document.findMany({
      where: {
        deletedAt: null,
        ...(folderId
          ? { ownerId: user.id, folderId }
          : {
              OR: [
                { ownerId: user.id, folderId: null },
                { permissions: { some: { userId: user.id } } },
              ],
            }),
      },
      select: DOCUMENT_LIST_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return json({ documents: docs.map(withOwnership(user.id)) });
  });
}

const DOCUMENT_LIST_SELECT = {
  id: true,
  title: true,
  ownerId: true,
  folderId: true,
  updatedAt: true,
  createdAt: true,
  shareEnabled: true,
} ;

/** Attach isOwner so the UI can hide move/delete controls on received docs. */
function withOwnership(userId) {
  return (doc) => ({ ...doc, isOwner: doc.ownerId === userId });
}
