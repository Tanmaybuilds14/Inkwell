/**
 * Telemetry event names from the PRD. In dev these log to stdout; wire a real
 * sink (Axiom, PostHog, Sentry breadcrumbs) behind this single function later.
 */
export const EVENTS = {
  DOC_CREATED: 'doc_created',
  DOC_RENAMED: 'doc_renamed',
  DOC_MOVED_TO_FOLDER: 'doc_moved_to_folder',
  DOC_SHARED: 'doc_shared',
  DOC_PERMISSION_CHANGED: 'doc_permission_changed',
  DOC_LINK_REVOKED: 'doc_link_revoked',
  DOC_MOVED_TO_TRASH: 'doc_moved_to_trash',
  DOC_RESTORED: 'doc_restored',
  DOC_PURGED: 'doc_purged',
  VERSION_SNAPSHOT_CREATED: 'version_snapshot_created',
  VERSION_RESTORED: 'version_restored',
  EDIT_SUBMITTED: 'edit_submitted',
  EDIT_BROADCAST_RECEIVED: 'edit_broadcast_received',
  CLIENT_DISCONNECTED: 'client_disconnected',
  CLIENT_RECONNECTED: 'client_reconnected',
  PRESENCE_UPDATED: 'presence_updated',
};

export function track(event, payload = {}) {
  const line = JSON.stringify({ event, ...payload, at: new Date().toISOString() });
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[telemetry] ${line}`);
  }
}
