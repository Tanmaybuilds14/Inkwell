/**
 * Telemetry events from the PRD, logged as structured lines. Swap the console
 * sink for Axiom/Sentry/etc. without touching call sites.
 */
export const EVENTS = {
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
