import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { apiError, handle, json } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';
import { logActivity, ACTIVITY_TYPES } from '@/lib/activity';
import { throttleWrite, RATE_LIMITS } from '@/lib/rate-limit';
import { buildImportedDocument } from '@/lib/import/document.js';
import { ImportError } from '@/lib/import/errors.js';
import { IMPORT_LIMITS } from '../../../../../shared/import-limits.js';

/**
 * POST /api/documents/import — turn local files into editable documents.
 *
 * The upload is a normal multipart form (`files` repeated). Each file is
 * converted to a Yjs snapshot and stored as a regular `Document`, so it opens
 * in the existing editor and is picked up by the RAG re-index cron like any
 * other document.
 *
 * One bad file never aborts the batch: the response carries `imported` and
 * `failed` lists so the dialog can show exactly which files made it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isFileLike(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  );
}

export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    // A batch is one user action, so it counts once against the import bucket;
    // the per-file ceiling and the 20 MB limit bound the work inside it.
    const limited = await throttleWrite(user.id, RATE_LIMITS.DOC_IMPORT, 'doc-import');
    if (limited) return limited;

    let form;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, 'Could not read the upload. Choose the files again.');
    }

    const folderIdValue = form.get('folderId');
    const folderId = typeof folderIdValue === 'string' && folderIdValue ? folderIdValue : null;

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId: user.id },
        select: { id: true },
      });
      if (!folder) return apiError(404, 'Folder not found');
    }

    const files = form.getAll('files').filter(isFileLike);
    if (files.length === 0) return apiError(400, 'Choose at least one file to import.');
    if (files.length > IMPORT_LIMITS.maxFiles) {
      return apiError(400, `Import at most ${IMPORT_LIMITS.maxFiles} files at once.`);
    }

    const imported = [];
    const failed = [];

    for (const file of files) {
      const displayName = file.name || 'Untitled';
      try {
        if (file.size === 0) throw new ImportError('This file is empty.', 400);
        if (file.size > IMPORT_LIMITS.maxFileBytes) {
          throw new ImportError(
            `This file is too large. The limit is ${Math.round(IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
            413
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const converted = await buildImportedDocument({ filename: displayName, buffer });

        const created = await prisma.document.create({
          data: {
            title: converted.title,
            ownerId: user.id,
            folderId,
            originalFolderId: folderId,
            snapshot: converted.snapshot,
            stateVector: converted.stateVector,
          },
          select: { id: true, title: true },
        });

        track(EVENTS.DOC_CREATED, {
          document_id: created.id,
          owner_id: user.id,
          imported: true,
          format: converted.format,
        });
        logActivity(ACTIVITY_TYPES.DOC_CREATED, {
          userId: user.id,
          documentId: created.id,
          docTitle: created.title,
          meta: { imported: true, format: converted.format },
        });

        imported.push({
          id: created.id,
          title: created.title,
          format: converted.format,
          charCount: converted.charCount,
        });
      } catch (error) {
        const message =
          error instanceof ImportError
            ? error.message
            : 'This file could not be imported. It may be damaged or use an unsupported format.';
        if (!(error instanceof ImportError)) {
          // Content-free: a filename and parser failure, never the document text.
          console.error('[import] conversion failed:', error?.message ?? error);
        }
        failed.push({ name: displayName, error: message });
      }
    }

    // 200 even when every file failed: the request itself was valid, and the
    // dialog needs the per-file reasons to be useful.
    return json({ imported, failed });
  });
}
