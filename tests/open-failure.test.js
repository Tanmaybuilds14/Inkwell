/**
 * The editor's "can't open this document" decision table.
 *
 * Worth pinning because every branch has a failure mode that is invisible in
 * the UI: a 404 shown as an error leaks nothing but reports noise, a 404 shown
 * as "no access" leaks which documents exist, and a 500 shown as a 404 tells a
 * user their document is gone when it is merely broken. The API deliberately
 * answers 404 for both "missing" and "not shared with you", so the client has
 * no way to tell them apart — and must not invent a distinction.
 */
import { describe, it, expect } from 'vitest';

import { OPEN_FAILURE, classifyOpenFailure } from '../src/lib/open-failure.js';

describe('classifyOpenFailure', () => {
  it('sends a signed-out visitor to sign-in, even on 404 (invite links)', () => {
    expect(classifyOpenFailure({ isSignedIn: false, status: 404 })).toBe(OPEN_FAILURE.SIGN_IN);
    expect(classifyOpenFailure({ isSignedIn: false, status: 500 })).toBe(OPEN_FAILURE.SIGN_IN);
  });

  it('treats a signed-in 404 as not-found rather than an error', () => {
    expect(classifyOpenFailure({ isSignedIn: true, status: 404 })).toBe(OPEN_FAILURE.NOT_FOUND);
  });

  it('treats other statuses as real failures', () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      expect(classifyOpenFailure({ isSignedIn: true, status }), `status ${status}`).toBe(
        OPEN_FAILURE.ERROR
      );
    }
  });

  it('does NOT read a transport failure as a missing document', () => {
    // fetch rejects with a TypeError before any response exists, so `status` is
    // undefined. Treating that as 404 would tell the user their document is
    // gone whenever the network hiccups.
    expect(classifyOpenFailure({ isSignedIn: true, status: undefined })).toBe(OPEN_FAILURE.ERROR);
    expect(classifyOpenFailure({ isSignedIn: true, status: null })).toBe(OPEN_FAILURE.ERROR);
  });

  it('fails closed when the inputs are missing entirely', () => {
    expect(classifyOpenFailure({})).toBe(OPEN_FAILURE.SIGN_IN);
  });
});
