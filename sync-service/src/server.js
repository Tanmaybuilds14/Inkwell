import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { authenticateHandshake } from './auth.js';
import { getOrCreateRoom, roomStats, listRooms } from './rooms.js';

const PORT = Number(process.env.SYNC_PORT ?? process.env.PORT ?? 1234);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...roomStats(), rooms: listRooms() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

/**
 * Handshake happens during the HTTP upgrade, before any document bytes flow:
 *   /ws?docId=<id>&token=<clerk-jwt>        (signed-in)
 *   /ws?docId=<id>&share=<share-token>      (guest via share link)
 */
server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const docId = url.searchParams.get('docId');
  const token = url.searchParams.get('token');
  const shareToken = url.searchParams.get('share');

  let auth;
  try {
    auth = await authenticateHandshake({ docId, token, shareToken });
  } catch (err) {
    console.error('[upgrade] auth error:', err.message);
    auth = { ok: false, code: 4001, reason: 'Authentication failed' };
  }

  if (!auth.ok) {
    // Deny before accepting the socket — fail closed.
    socket.write(`HTTP/1.1 403 Forbidden\r\nx-reason: ${auth.reason}\r\n\r\n`);
    socket.destroy();
    return;
  }

  try {
    const room = await getOrCreateRoom(docId);
    wss.handleUpgrade(request, socket, head, (ws) => {
      room.join(ws, { role: auth.role, identity: auth.identity });
      console.log(
        `[sync] ${auth.identity.name} joined ${docId} as ${auth.role} (${room.conns.size} connected)`
      );
    });
  } catch (err) {
    console.error('[upgrade] room error:', err.message);
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[sync] Inkwell sync service listening on :${PORT}`);
});
