// TowerStrike server: static file host + WebSocket game rooms. Designed for a single Render web service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { randomCode } from '../shared/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three', 'build')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const fileCache = new Map();

function resolveFile(urlPath) {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    let rel = decodeURIComponent(urlPath.slice(prefix.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep) && full !== dir) return null;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    if (prefix !== '/') return null;
  }
  return null;
}

function serveStatic(req, res, urlPath) {
  const file = resolveFile(urlPath);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  let entry = fileCache.get(file);
  if (!entry || entry.mtime !== stat.mtimeMs) {
    const raw = fs.readFileSync(file);
    const compressible = /text|javascript|json|svg|csv/.test(MIME[ext] || '');
    entry = { mtime: stat.mtimeMs, raw, gz: compressible && raw.length > 1024 ? zlib.gzipSync(raw, { level: 8 }) : null, etag: `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"` };
    fileCache.set(file, entry);
  }
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: entry.etag,
    'Cache-Control': urlPath.startsWith('/vendor/') ? 'public, max-age=604800, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
  const gzipOk = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzipOk) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
  const body = gzipOk ? entry.gz : entry.raw;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const rooms = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.connectedHumans().length, 0), uptime: Math.round(process.uptime()) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  try { serveStatic(req, res, url.pathname); } catch (e) { res.writeHead(500); res.end('Server error'); }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

function newCode() {
  for (let i = 0; i < 1000; i++) { const c = randomCode(4); if (!rooms.has(c)) return c; }
  return randomCode(6);
}

wss.on('connection', (ws) => {
  const conn = { room: null, player: null, alive: true, bucket: 150, last: Date.now() };
  ws.on('pong', () => { conn.alive = true; });
  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

  ws.on('message', (data) => {
    // token bucket: ~100 msgs/s sustained, bursts to 150
    const now = Date.now();
    conn.bucket = Math.min(150, conn.bucket + ((now - conn.last) / 1000) * 100);
    conn.last = now;
    if (conn.bucket < 1) return;
    conn.bucket -= 1;
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;

    if (!conn.player) {
      if (m.t === 'create') {
        const code = newCode();
        const room = new Room(code);
        rooms.set(code, room);
        const r = room.addPlayer(m.name, ws);
        conn.room = room; conn.player = r.player;
        room.welcome(r.player);
        room.announceJoin(r.player);
        room.broadcastLobby();
      } else if (m.t === 'join') {
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) return send({ t: 'error', msg: 'Room not found. Check the code.', fatal: true });
        const r = room.addPlayer(m.name, ws);
        if (r.error) return send({ t: 'error', msg: r.error, fatal: true });
        conn.room = room; conn.player = r.player;
        room.welcome(r.player);
        room.announceJoin(r.player);
        room.broadcastLobby();
      } else if (m.t === 'resume') {
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        const p = room && room.reconnect(String(m.token || ''), ws);
        if (!p) return send({ t: 'resumeFailed' });
        conn.room = room; conn.player = p;
        room.welcome(p);
        room.broadcastLobby();
      } else if (m.t === 'ping') send({ t: 'pong', ts: m.ts });
      return;
    }
    if (m.t === 'ping') return send({ t: 'pong', ts: m.ts });
    if (m.t === 'leave') { conn.room.removePlayer(conn.player.id, 'left'); conn.player = null; conn.room = null; return; }
    try { conn.room.handle(conn.player, m); } catch (e) { console.error('handle error', e); }
  });

  ws.on('close', () => {
    if (conn.room && conn.player && conn.player.ws === ws) conn.room.disconnect(conn.player);
  });
  ws.on('error', () => {});
  ws._conn = conn;
});

// Heartbeats keep Render's proxy from idling sockets out and detect dead clients.
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    const c = ws._conn;
    if (!c) continue;
    if (!c.alive) { ws.terminate(); continue; }
    c.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
  // Reap rooms with no connected humans for 2 minutes
  for (const [code, room] of rooms) {
    if (room.emptySince && Date.now() - room.emptySince > 120000 && !room.connectedHumans().length) { room.destroy(); rooms.delete(code); }
  }
}, 20000);
wss.on('close', () => clearInterval(hb));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`TowerStrike listening on http://localhost:${server.address().port}`));

export { server, rooms };
