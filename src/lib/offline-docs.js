/**
 * IndexedDB database name for a document's local (offline) copy.
 *
 * The key includes the *viewer's* identity, not just the document id: two
 * people sharing a browser must not see each other's cached documents, and a
 * user who lost access must not be shown stale content from their own cache
 * after access is revoked. Guests on a share link are identified by the
 * signed, revocable token rather than an account.
 *
 * Returns null when there is no identity to cache under — caching nothing is
 * correct there, because an unidentifiable viewer can neither be shown their
 * own stale copy later nor be securely excluded from someone else's.
 *
 * Pure and dependency-free so the editor's persistence wiring can be unit
 * tested without a browser.
 */
export function offlineDbName(documentId, { userId, shareToken } = {}) {
  if (!documentId) return null;
  if (userId) return `inkwell-doc-${documentId}-${userId}`;
  if (shareToken) return `inkwell-doc-${documentId}-share-${shareToken}`;
  return null;
}
