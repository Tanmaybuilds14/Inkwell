import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { publishToDocument } from '@/lib/redis';
import { track, EVENTS } from '@/lib/telemetry';

/**
 * POST — restore a prior version as the current document state.
 *
 * Order of operations (per architecture doc):
 *  1. Save the pre-restore current state as a new snapshot first, so the
 *     restore itself is always undoable.
 *  2. Point documents.snapshot at the restored version.
 *  3. Notify any live sync-service rooms via Redis to hot-swap their in-memory
 *     Y.Doc and rebroadcast — connected clients converge without reloading.
 */
export async function POST(request, { params }) {
  return handle(async () => {
    const { id, versionId } = await params;
    const { user } = await requireDocument(request, id, 'EDITOR');

    const [version, doc] = await Promise.all([
      prisma.versionSnapshot.findFirst({
        where: { id: versionId, documentId: id },
        select: { id: true, snapshot: true },
      }),
      prisma.document.findUnique({
        where: { id },
        select: { snapshot: true, title: true },
      }),
    ]);
    if (!version) return apiError(404, 'Version not found');

    await prisma.$transaction(async (tx) => {
      // 1. Pre-restore backup of current state.
      if (doc.snapshot && doc.snapshot.length > 0) {
        await tx.versionSnapshot.create({
          data: {
            documentId: id,
            snapshot: doc.snapshot,
            title: doc.title,
            createdBy: user.id,
          },
        });
      }
      // 2. Restore.
      await tx.document.update({
        where: { id },
        data: { snapshot: version.snapshot },
      });
    });

    // 3. Live rooms swap + rebroadcast. If no room is open this is a no-op;
    //    fresh joins load documents.snapshot anyway.
    await publishToDocument(id, {
      type: 'apply-snapshot',
      update: Buffer.from(version.snapshot).toString('base64'),
    });

    track(EVENTS.VERSION_RESTORED, {
      document_id: id,
      version_id: versionId,
      actor_id: user.id,
    });
    return json({ ok: true });
  });
}
