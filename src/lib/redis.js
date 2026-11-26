import Redis from 'ioredis';
import { docChannel } from '../../shared/protocol.js';

// Channel naming and message kinds are shared verbatim with the sync service
// so a version restore published here is recognised there. See shared/protocol.js.
export { MESSAGE_KINDS, docChannel } from '../../shared/protocol.js';

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
    publisher.on('close', () => { publisher = null; });
  }
  return publisher;
}

/**
 * Publisher connection used by Next.js API routes to reach live sync-service
 * rooms (e.g. version restores). Channels are namespaced per document ID so
 * messages can never leak across documents.
 */
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
