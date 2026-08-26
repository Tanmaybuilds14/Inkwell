import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { yUpdateToHtml } from '@/lib/ydoc-utils';

/** GET — preview a single version's content as HTML. */
export async function GET(request, { params }) {
  return handle(async () => {
    const { id, versionId } = await params;
    await requireDocument(request, id, 'VIEWER');

    const version = await prisma.versionSnapshot.findFirst({
      where: { id: versionId, documentId: id },
      select: { id: true, snapshot: true, title: true, createdAt: true },
    });
    if (!version) return apiError(404, 'Version not found');

    const html = await yUpdateToHtml(version.snapshot);
    return json({
      version: {
        id: version.id,
        title: version.title,
        createdAt: version.createdAt,
        html,
      },
    });
  });
}
