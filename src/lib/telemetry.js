import { addTelemetryBreadcrumb } from '@/lib/error-reporting';

/**
 * Telemetry event names from the PRD.
 *
 * Events always go to stdout as structured lines. When Sentry is configured
 * they are ALSO attached to the current request as breadcrumbs, so a failure
 * report shows the user's path to it instead of just the final throw.
 */
export const EVENTS = {
  DOC_CREATED: 'doc_created',
  DOC_RENAMED: 'doc_renamed',
  DOC_MOVED_TO_FOLDER: 'doc_moved_to_folder',
  DOC_SHARED: 'doc_shared',
  DOC_PERMISSION_CHANGED: 'doc_permission_changed',
  DOC_LINK_REVOKED: 'doc_link_revoked',
  DOC_MENTIONED: 'doc_mentioned',
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
  // No-ops (and skips loading the SDK) when no DSN is configured.
  addTelemetryBreadcrumb(event, payload);
}
