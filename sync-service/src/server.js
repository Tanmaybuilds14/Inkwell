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
 * Map internal auth codes to WebSocket close codes in the 4400-4499 range.
 * y-websocket's client treats 4400-4499 as "reconnecting can't fix this" and
 * stops its own reconnect loop, which lets the app react deliberately:
 *   4400 — token expired: client refreshes the token and reconnects
 *   4401 — invalid token: terminal
 *   4403 — no access to the document: terminal
 *   4404 — document not found: terminal
 */
const CLOSE_CODES = { 4001: 4401, 4010: 4400, 4003: 4403, 4004: 4404 };
const closeCodeFor = (code) => CLOSE_CODES[code] ?? 4401;

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
    // Complete the WebSocket handshake and immediately close with an
    // application close code. A plain HTTP 403 on the raw socket never
    // reaches the browser's WebSocket API as a close event, so the client
    // cannot tell "expired token, refresh and retry" from "access denied,
    // stop trying" — it would reconnect forever.
    wss.handleUpgrade(request, socket, head, (ws) => {
      const code = closeCodeFor(auth.code);
      console.log(`[sync] denied ${docId}: ${auth.reason} (close ${code})`);
      ws.close(code, auth.reason);
    });
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
