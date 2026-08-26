import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';

export async function POST(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'OWNER');

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { deletedAt: true, originalFolderId: true },
    });
    if (!doc?.deletedAt) return apiError(400, 'Document is not in trash');

    const restored = await prisma.document.update({
      where: { id },
      data: {
        deletedAt: null,
        folderId: doc.originalFolderId,
      },
      select: { id: true, title: true, folderId: true },
    });

    track(EVENTS.DOC_RESTORED, { document_id: id, actor_id: user.id });
    return json({ document: restored });
  });
}
