/**
 * A user-facing import failure.
 *
 * The message is safe to show in the import dialog: it names the problem
 * ("encrypted PDF", "no selectable text") without leaking a parser stack trace
 * or a filesystem path. The status mirrors the HTTP meaning so the route can
 * distinguish a bad request from an unreadable document.
 */
export class ImportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

/** True for errors the UI is allowed to display verbatim. */
export function isImportError(error) {
  return error instanceof ImportError;
}
