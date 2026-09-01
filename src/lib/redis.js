import Redis from 'ioredis';

/**
 * Message-kind constants shared (by value) with sync-service/src/broadcast.js.
 * Both deployables cannot share a literal module, so the string values must
 * stay identical — cross-reference: sync-service/src/broadcast.js
 */
export const MESSAGE_KINDS = {
  UPDATE: 'update',
  AWARENESS: 'awareness',
  APPLY_SNAPSHOT: 'apply-snapshot',
};

/**
 * Publisher connection used by Next.js API routes to reach live sync-service
 * rooms (e.g. version restores). Channels are namespaced per document ID so
 * messages can never leak across documents.
 */
export const docChannel = (documentId) => `inkwell:doc:${documentId}`;

let publisher = null;

export function getPublisher() {
  if (!process.env.REDIS_URL) return null;
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    });
    publisher.on('error', (err) => {
      console.error('[redis] publisher error:', err.message);
    });
  }
  return publisher;
}

export async function publishToDocument(documentId, message) {
  const pub = getPublisher();
  if (!pub) return false;
  try {
    await pub.publish(docChannel(documentId), JSON.stringify(message));
    return true;
  } catch (err) {
    console.error('[redis] publish failed:', err.message);
    return false;
  }
}
