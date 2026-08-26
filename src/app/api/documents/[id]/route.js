import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';

const METADATA_SELECT = {
  id: true,
  title: true,
  ownerId: true,
  folderId: true,
  deletedAt: true,
  shareEnabled: true,
  shareRole: true,
  createdAt: true,
  updatedAt: true,
};

export async function GET(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user, role } = await requireDocument(request, id, 'VIEWER');

    const full = await prisma.document.findUnique({
      where: { id },
      select: {
        ...METADATA_SELECT,
        owner: { select: { name: true, email: true } },
      },
    });

    return json({
      document: { ...full, role },
      viewer: user ? { id: user.id, name: user.name ?? user.email } : null,
    });
  });
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'EDITOR');
    const body = await request.json().catch(() => ({}));

    const data = {};
    if (typeof body.title === 'string' && body.title.trim()) {
      data.title = body.title.trim().slice(0, 300);
    }
    if ('folderId' in body) {
      // Only the owner may move documents between folders.
      const doc = await prisma.document.findUnique({ where: { id }, select: { ownerId: true } });
      if (doc.ownerId !== user.id) {
        return apiError(403, 'Only the owner can move this document');
      }
      if (body.folderId === null) {
        data.folderId = null;
        data.originalFolderId = null;
      } else if (typeof body.folderId === 'string') {
        const folder = await prisma.folder.findFirst({
          where: { id: body.folderId, ownerId: user.id },
          select: { id: true },
        });
        if (!folder) return apiError(404, 'Folder not found');
        data.folderId = folder.id;
        data.originalFolderId = folder.id;
        track(EVENTS.DOC_MOVED_TO_FOLDER, { document_id: id, folder_id: folder.id });
      }
    }
    if (Object.keys(data).length === 0) return apiError(400, 'Nothing to update');

    const updated = await prisma.document.update({
      where: { id },
      data,
      select: { id: true, title: true, folderId: true, updatedAt: true },
    });

    if ('title' in data) track(EVENTS.DOC_RENAMED, { document_id: id });
    return json({ document: updated });
  });
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'OWNER');

    await prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    track(EVENTS.DOC_MOVED_TO_TRASH, { document_id: id, actor_id: user.id });
    return json({ ok: true });
  });
}
