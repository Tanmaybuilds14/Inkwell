/**
 * Invariants for the shared wire contract.
 *
 * shared/protocol.js is imported by the sync service (server), the Next.js
 * app (Redis publisher) and the browser bundle (editor close-code handling),
 * so a careless edit there is a three-runtime outage. These assertions pin the
 * properties that make the handshake legible: auth verdicts must stay outside
 * the close-code range, close codes must stay in the band the browser treats
 * as non-reconnectable-by-default, and every retryable code must be a real
 * code.
 */
import { describe, it, expect } from 'vitest';

import {
  MESSAGE_KINDS,
  AUTH_CODES,
  WS_CLOSE_CODES,
  RETRYABLE_CLOSE_CODES,
  CHANNEL_PREFIX,
  docChannel,
  closeCodeForAuthCode,
} from '../shared/protocol.js';

describe('shared/protocol.js', () => {
  it('auth verdicts stay below the WebSocket close range', () => {
    for (const [name, code] of Object.entries(AUTH_CODES)) {
      expect(code, `${name} must not look like a close code`).toBeLessThan(4400);
      expect(code).toBeGreaterThanOrEqual(4000);
    }
  });

  it('close codes stay in the 44xx band y-websocket will not auto-retry', () => {
    const codes = Object.values(WS_CLOSE_CODES);
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4400);
      expect(code).toBeLessThan(4500);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every auth verdict maps to a distinct close code and unknown ones are not retryable', () => {
    const mapped = Object.values(AUTH_CODES).map(closeCodeForAuthCode);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(RETRYABLE_CLOSE_CODES).not.toContain(closeCodeForAuthCode(AUTH_CODES.NO_ACCESS));
    expect(closeCodeForAuthCode(9999)).toBe(WS_CLOSE_CODES.INVALID_TOKEN);
  });

  it('only "refresh your token" and "you were throttled" are retryable', () => {
    expect([...RETRYABLE_CLOSE_CODES].sort()).toEqual(
      [WS_CLOSE_CODES.TOKEN_EXPIRED, WS_CLOSE_CODES.RATE_LIMITED].sort()
    );
    for (const code of RETRYABLE_CLOSE_CODES) {
      expect(Object.values(WS_CLOSE_CODES)).toContain(code);
    }
  });

  it('channels are namespaced per document and cannot collide', () => {
    expect(docChannel('a')).toBe(`${CHANNEL_PREFIX}a`);
    expect(docChannel('a')).not.toBe(docChannel('ab'));
    // The restore publisher and the room subscriber must agree on this.
    expect(Object.values(MESSAGE_KINDS)).toContain('apply-snapshot');
  });
});
