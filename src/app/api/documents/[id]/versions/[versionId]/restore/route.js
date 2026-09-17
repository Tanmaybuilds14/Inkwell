import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { publishToDocument, MESSAGE_KINDS } from '@/lib/redis';
import { buildRestoreUpdate, applyUpdateToSnapshot } from '@/lib/ydoc-utils';
import { track, EVENTS } from '@/lib/telemetry';
import { logActivity, ACTIVITY_TYPES } from '@/lib/activity';

/**
 * POST — restore a prior version as the current document state.
 *
 * Order of operations:
 *  1. Save the pre-restore current state as a new snapshot first, so the
 *     restore itself is always undoable (via version history).
 *  2. Compute a REVERT DELTA: the CRDT update that transforms the current
 *     state back into the version's content (delete newer ops + re-insert
 *     old content). This is what makes restore work on live documents —
 *     pushing the old full-state snapshot would just merge and change
 *     nothing (CRDT updates are additive).
 *  3. Point documents.snapshot at the merged result.
 *  4. Broadcast the revert delta to any live sync-service rooms so
 *     connected editors converge immediately; fresh joins load the stored
 *     snapshot anyway.
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
    if (!doc) return apiError(404, 'Document not found');

    // 2. Revert delta from current -> version.
    const revertUpdate = await buildRestoreUpdate(doc.snapshot, version.snapshot);

    // 1 + 3. Pre-restore backup, then store the merged (restored) state.
    const restoredSnapshot = applyUpdateToSnapshot(doc.snapshot, revertUpdate);
    await prisma.$transaction(async (tx) => {
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
      await tx.document.update({
        where: { id },
        data: { snapshot: restoredSnapshot },
      });
    });

    // 4. Live rooms apply the same delta. If no room is open this is a
    //    harmless no-op publish; fresh joins load documents.snapshot.
    if (revertUpdate.length > 0) {
      await publishToDocument(id, {
        kind: MESSAGE_KINDS.UPDATE,
        update: Buffer.from(revertUpdate).toString('base64'),
      });
    }

    track(EVENTS.VERSION_RESTORED, {
      document_id: id,
      version_id: versionId,
      actor_id: user.id,
    });
    logActivity(ACTIVITY_TYPES.VERSION_RESTORED, { userId: user.id, documentId: id, meta: { versionId } });
    return json({ ok: true });
  });
}
