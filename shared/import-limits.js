/**
 * Limits and filename rules for importing local files.
 *
 * Lives in `shared/` because the dashboard's file picker and the upload route
 * must agree on what is accepted: a picker that offers `.docx` while the API
 * rejects it is a confusing dead end, and a client-only size check is not a
 * security control. The server re-validates everything here.
 */

/** Formats the importer understands, keyed by the value stored in the API. */
export const IMPORT_FORMATS = Object.freeze({
  pdf: { label: 'PDF', extensions: ['pdf'] },
  docx: { label: 'Word document', extensions: ['docx'] },
  markdown: { label: 'Markdown', extensions: ['md', 'markdown'] },
  text: { label: 'Text file', extensions: ['txt'] },
});

/** Every extension accepted by the picker, without the leading dot. */
export const IMPORT_EXTENSIONS = Object.freeze(
  Object.values(IMPORT_FORMATS).flatMap((format) => format.extensions)
);

/** Value for an `<input type="file" accept>` attribute. */
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(',');

/**
 * Hard limits. The per-file ceiling is deliberately generous enough for a
 * normal report or paper while keeping a single extraction in memory bounded.
 * Vercel's 4.5 MB request limit is lower; self-hosted deployments can use the
 * full value.
 */
export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxFiles: 10,
});

/**
 * Map a filename to an import format. Returns null for anything unsupported,
 * including legacy `.doc` (which is a different binary format entirely).
 */
export function importFormatForFilename(filename) {
  const match = String(filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  const extension = match[1];
  for (const [format, definition] of Object.entries(IMPORT_FORMATS)) {
    if (definition.extensions.includes(extension)) return format;
  }
  return null;
}

/**
 * A safe display title from the uploaded filename. The path is stripped so a
 * caller cannot smuggle directory separators into a title, and control
 * characters are collapsed rather than stored.
 */
export function importTitleFromFilename(filename) {
  const base = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  const withoutExtension = base.replace(/\.[a-z0-9]+$/i, '');
  const title = withoutExtension
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 300);
  return title || 'Imported document';
}

/** Human-readable byte size for the import dialog. */
export function formatImportBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
