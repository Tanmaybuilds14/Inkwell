import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';

export async function POST(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'OWNER', { allowTrashed: true });

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { deletedAt: true, originalFolderId: true },
    });
    if (!doc?.deletedAt) return apiError(400, 'Document is not in trash');

    // originalFolderId has no FK constraint, so it can dangle after the folder
    // was deleted. Re-pointing folderId at a missing folder would violate the
    // folderId foreign key (500) — fall back to the root instead.
    let folderId = doc.originalFolderId;
    if (folderId) {
      const folder = await prisma.folder.findUnique({
        where: { id: folderId },
        select: { id: true },
      });
      if (!folder) folderId = null;
    }

    const restored = await prisma.document.update({
      where: { id },
      data: {
        deletedAt: null,
        folderId,
      },
      select: { id: true, title: true, folderId: true },
    });

    track(EVENTS.DOC_RESTORED, { document_id: id, actor_id: user.id });
    return json({ document: restored });
  });
}
