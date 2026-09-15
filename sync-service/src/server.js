import './env.js';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { authenticateHandshake } from './auth.js';
import { getOrCreateRoom, roomStats, listRooms } from './rooms.js';

/**
 * Parse the port defensively. `Number('')` is 0 (not NaN), and some shells
 * export PORT=0 — binding an ephemeral port makes the service unreachable
 * while looking perfectly healthy. Fall back to the documented default.
 */
const RAW_PORT = process.env.SYNC_PORT ?? process.env.PORT;
const PARSED_PORT = Number(RAW_PORT);
const PORT = RAW_PORT !== undefined && RAW_PORT !== '' && Number.isFinite(PARSED_PORT) && PARSED_PORT > 0
  ? PARSED_PORT
  : 1234;

/**
 * One-shot startup probe so a missing Redis is reported as ONE actionable
 * message instead of an endless stream of connect errors from the lazy
 * subscriber/publisher/lock clients (which only connect once a room opens).
 */
function probeRedis() {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`[sync] invalid REDIS_URL "${raw}" — expected e.g. redis://localhost:6379`);
    return;
  }
  const port = Number(url.port) || 6379;
  const socket = net.createConnection({ host: url.hostname, port });
  socket.setTimeout(2000);
  socket.once('connect', () => {
    socket.destroy();
    console.log(`[sync] redis reachable at ${url.hostname}:${port}`);
  });
  const fail = (what) => {
    socket.destroy();
    console.error(
      `[sync] redis NOT reachable at ${url.hostname}:${port} (${what}).\n` +
      '       The service still starts, but cross-instance sync, broadcast relay\n' +
      '       and the persistence lock need Redis. Start the bundled one with:\n' +
      '         docker compose up -d redis\n' +
      '       (or set REDIS_URL to a reachable instance).'
    );
  };
  socket.once('timeout', () => fail('timeout'));
  socket.once('error', (err) => fail(err.code ?? err.message));
}
probeRedis();

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
