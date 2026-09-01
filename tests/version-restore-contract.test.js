/**
 * Regression test for Issue 1: version restore hot-swap contract.
 *
 * The bug was a field-name mismatch: the publish side used `{ type: 'apply-snapshot' }`
 * but rooms.js checked `msg.kind === 'apply-snapshot'`. This test ensures the
 * publish-side payload shape is recognized by the consume-side handler logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import message kind constants from both sides of the wire.
// In production these live in separate deployables, but in tests we can
// import both to verify they stay in sync.
import { MESSAGE_KINDS as PUBLISH_KINDS } from '../src/lib/redis.js';
import { MESSAGE_KINDS as CONSUME_KINDS } from '../sync-service/src/broadcast.js';

describe('Issue 1 — version restore hot-swap contract', () => {
  it('MESSAGE_KINDS constants match across publish and consume sides', () => {
    expect(PUBLISH_KINDS).toEqual(CONSUME_KINDS);
  });

  it('publish-side payload shape is recognized by the consume-side handler', () => {
    // Simulate the exact payload that src/lib/redis.js publishToDocument()
    // would send for a version restore:
    const snapshotB64 = Buffer.from(new Uint8Array([1, 2, 3])).toString('base64');
    const publishPayload = {
      kind: PUBLISH_KINDS.APPLY_SNAPSHOT,
      update: snapshotB64,
    };

    // Simulate what rooms.js's subscribeToDocument callback does:
    let hotSwapCalled = false;
    let receivedSnapshot = null;

    function simulateRoomMessageHandler(msg) {
      if (msg.kind === CONSUME_KINDS.UPDATE) {
        // handle update
      } else if (msg.kind === CONSUME_KINDS.AWARENESS) {
        // handle awareness
      } else if (msg.kind === CONSUME_KINDS.APPLY_SNAPSHOT) {
        hotSwapCalled = true;
        receivedSnapshot = Buffer.from(msg.update, 'base64');
      }
    }

    simulateRoomMessageHandler(publishPayload);

    expect(hotSwapCalled).toBe(true);
    expect([...receivedSnapshot]).toEqual([1, 2, 3]);
  });

  it('old broken payload shape (type instead of kind) would NOT trigger hot-swap', () => {
    // This is what the old code produced — it should NOT match:
    const brokenPayload = {
      type: 'apply-snapshot', // wrong field name
      update: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
    };

    let hotSwapCalled = false;
    function simulateRoomMessageHandler(msg) {
      if (msg.kind === CONSUME_KINDS.APPLY_SNAPSHOT) {
        hotSwapCalled = true;
      }
    }

    simulateRoomMessageHandler(brokenPayload);

    // With the old field name, kind is undefined → handler not reached
    expect(hotSwapCalled).toBe(false);
  });
});
