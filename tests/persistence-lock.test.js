/**
 * Test for Issue 5: Redis-based leader lock for snapshot persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Issue 5 — persistence leader lock', () => {
  let mockSet, mockGet, mockEval;

  beforeEach(async () => {
    vi.resetModules();
    mockSet = vi.fn().mockResolvedValue('OK');
    mockGet = vi.fn().mockResolvedValue(null);
    mockEval = vi.fn().mockResolvedValue(1);

    vi.doMock('ioredis', () => {
      function MockRedis() {
        this.set = mockSet;
        this.get = mockGet;
        this.eval = mockEval;
        this.on = vi.fn();
      }
      MockRedis.default = MockRedis;
      return { default: MockRedis };
    });

    vi.doMock('../sync-service/src/broadcast.js', () => ({
      subscribeToDocument: vi.fn().mockReturnValue(vi.fn()),
      publishMessage: vi.fn(),
      MESSAGE_KINDS: { UPDATE: 'update', AWARENESS: 'awareness', APPLY_SNAPSHOT: 'apply-snapshot' },
    }));

    vi.doMock('../sync-service/src/db.js', () => ({
      getDocumentSnapshot: vi.fn().mockResolvedValue(null),
      getDocumentTitle: vi.fn().mockResolvedValue('Test Doc'),
      persistSnapshot: vi.fn(),
      createVersionSnapshot: vi.fn(),
    }));
  });

  it('acquires lock when no lock exists (NX succeeds)', async () => {
    mockSet.mockResolvedValue('OK');
    const { acquireLock } = await import('../sync-service/src/rooms.js');
    const result = await acquireLock('doc-1');
    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      'inkwell:lock:doc:doc-1',
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX'
    );
  });

  it('renews lock when this instance already owns it', async () => {
    const { acquireLock } = await import('../sync-service/src/rooms.js');

    // First acquire succeeds
    mockSet.mockResolvedValue('OK');
    await acquireLock('doc-1');

    // Now mock GET to return whatever was set as the lock value.
    // Since INSTANCE_ID is random, we capture it from the first set() call.
    const setId = mockSet.mock.calls[0][1]; // second arg is the instance ID
    mockSet.mockResolvedValue(null); // NX fails (key exists)
    mockGet.mockResolvedValue(setId); // we own the lock

    const result = await acquireLock('doc-1');
    expect(result).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('inkwell:lock:doc:doc-1');
  });

  it('fails to acquire when another instance holds the lock', async () => {
    mockSet.mockResolvedValue(null);
    mockGet.mockResolvedValue('inst-other');
    const { acquireLock } = await import('../sync-service/src/rooms.js');
    const result = await acquireLock('doc-1');
    expect(result).toBe(false);
  });

  it('releases lock atomically (only deletes if owned)', async () => {
    const { releaseLock } = await import('../sync-service/src/rooms.js');
    await releaseLock('doc-1');
    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      1,
      'inkwell:lock:doc:doc-1',
      expect.any(String)
    );
  });
});
