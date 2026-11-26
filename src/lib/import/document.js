import { ImportError } from './errors.js';
import { extractImport } from './extract.js';
import { htmlToYjsSnapshot, documentTextLength } from './convert.js';
import {
  importTitleFromFilename,
  IMPORT_LIMITS,
} from '../../../shared/import-limits.js';

/**
 * One uploaded file → everything needed to create an Inkwell document.
 *
 * The route owns persistence and authorization; this module owns the
 * conversion and can be unit-tested without a database, Clerk session, or HTTP
 * request.
 */

/** A 2M-character text document encodes to a few MB; this catches runaway input. */
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;

export async function buildImportedDocument({ filename, buffer }) {
  if (!buffer || buffer.length === 0) {
    throw new ImportError('This file is empty.', 400);
  }
  if (buffer.length > IMPORT_LIMITS.maxFileBytes) {
    throw new ImportError(
      `This file is too large. The limit is ${Math.round(IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
      413
    );
  }

  const { format, html, warnings } = await extractImport({ filename, buffer });

  let snapshot;
  let stateVector;
  let json;
  try {
    ({ snapshot, stateVector, json } = await htmlToYjsSnapshot(html));
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(
      'This document could not be converted into an editable document. It may use unsupported formatting.',
      422
    );
  }

  if (snapshot.length > MAX_SNAPSHOT_BYTES) {
    throw new ImportError(
      `This document is too large to import (${Math.round(snapshot.length / (1024 * 1024))} MB after conversion).`,
      413
    );
  }

  return {
    title: importTitleFromFilename(filename),
    format,
    snapshot,
    stateVector,
    charCount: documentTextLength(json),
    warnings,
  };
}
