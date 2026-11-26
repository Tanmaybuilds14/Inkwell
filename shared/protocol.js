/**
 * The wire contract between Inkwell's two deployables.
 *
 * The Next.js app and the sync service ship separately (two Dockerfiles, two
 * package.json files, no bundler in common), so they used to keep duplicate
 * copies of these values with "cross-reference: keep in sync" comments. They
 * now import this one module by relative path instead. See the build-context
 * notes in sync-service/Dockerfile for how the sync image gets this file.
 *
 * Imports nothing and runs no side effects, so it is safe to pull into the
 * browser bundle (the editor needs the close codes too).
 */

/**
 * Kinds carried inside a Redis pub/sub envelope `{ origin, docId, kind, ... }`.
 *   update         → base64 Yjs update, applied to every instance's room copy
 *   awareness      → base64 awareness update (cursor/presence)
 *   apply-snapshot → version restore hot-swap
 */
export const MESSAGE_KINDS = {
  UPDATE: 'update',
  AWARENESS: 'awareness',
  APPLY_SNAPSHOT: 'apply-snapshot',
};

/**
 * Redis channel namespace for the cross-instance relay. One channel per
 * document, so an envelope can never be applied to the wrong document even
 * with two instances subscribed to many channels at once.
 */
export const CHANNEL_PREFIX = 'inkwell:doc:';
export const docChannel = (documentId) => `${CHANNEL_PREFIX}${documentId}`;

/**
 * Internal handshake verdicts returned by sync-service/src/auth.js. These are
 * NOT WebSocket close codes — they stay in the 4xxx range below 4400 so a
 * verdict can never be confused with a value on the wire.
 */
export const AUTH_CODES = {
  INVALID: 4001,
  NO_ACCESS: 4003,
  NOT_FOUND: 4004,
  TOKEN_EXPIRED: 4010,
  RATE_LIMITED: 4029,
};

/**
 * Close codes the sync service sends when it denies a session. It completes the
 * WebSocket handshake and closes immediately, because a bare HTTP 403 on the
 * upgrade never reaches the browser as a close event — the client would then
 * be unable to tell "refresh your token and retry" from "stop trying".
 *
 * y-websocket's own reconnect loop treats 4400-4499 as non-reconnectable, so
 * the editor decides what to do per code (see RETRYABLE_CLOSE_CODES).
 */
export const WS_CLOSE_CODES = {
  TOKEN_EXPIRED: 4400,
  INVALID_TOKEN: 4401,
  NO_ACCESS: 4403,
  NOT_FOUND: 4404,
  RATE_LIMITED: 4408,
};

const AUTH_TO_CLOSE = {
  [AUTH_CODES.INVALID]: WS_CLOSE_CODES.INVALID_TOKEN,
  [AUTH_CODES.TOKEN_EXPIRED]: WS_CLOSE_CODES.TOKEN_EXPIRED,
  [AUTH_CODES.NO_ACCESS]: WS_CLOSE_CODES.NO_ACCESS,
  [AUTH_CODES.NOT_FOUND]: WS_CLOSE_CODES.NOT_FOUND,
  [AUTH_CODES.RATE_LIMITED]: WS_CLOSE_CODES.RATE_LIMITED,
};

/**
 * Map an auth verdict to the close code the client receives. Unknown verdicts
 * fall back to "invalid token": denials are fail-closed, so an unmapped code
 * must never look retryable by accident.
 */
export const closeCodeForAuthCode = (authCode) =>
  AUTH_TO_CLOSE[authCode] ?? WS_CLOSE_CODES.INVALID_TOKEN;

/**
 * The only close codes the client may recover from, and how:
 *   TOKEN_EXPIRED → refresh the Clerk token, then reconnect immediately
 *   RATE_LIMITED  → back off, then reconnect (the client had to be told this
 *                   one is worth retrying, since 44xx is otherwise terminal)
 * Every other code is terminal and surfaces an explanation to the user.
 */
export const RETRYABLE_CLOSE_CODES = [WS_CLOSE_CODES.TOKEN_EXPIRED, WS_CLOSE_CODES.RATE_LIMITED];
