// ETBR Mapper collab server — real-time rooms for the level editor.
// Hosted on Render; room snapshots persist to Upstash Redis (REST) so a
// sleeping/redeployed free instance loses nothing.
//
// WS  /ws                      editor collab protocol (see PROTOCOL below)
// GET /health                  ok
// GET /api/room/:code          room info {name, users, objects}
// GET /api/room/:code/map      current map as .etbrmap JSON (used by the in-game loader / co-op share)
// POST /api/share              body = .etbrmap JSON → {code}  (one-shot share code, no live room needed)
//
// PROTOCOL (JSON messages)
//  c→s {t:'create', name, color, map?}         → s→c welcome
//  c→s {t:'join', room, name, color}           → s→c welcome {you, room, map, users, rev}
//  c→s {t:'op', ops:[...]}                     → broadcast {t:'op', from, ops, rev}
//        op = {o:'add', c:'objects'|'logic', item}
//           | {o:'set', c, id, patch}
//           | {o:'del', c, id}
//           | {o:'cfg', k:'meta'|'settings', patch}
//           | {o:'replace', map}                (host "open file" → everyone gets it)
//  c→s {t:'cursor', p:[x,y,z]}  {t:'select', ids:[...]}  {t:'chat', text}
//  s→c {t:'user+', user} {t:'user-', id} {t:'cursor', id, p} {t:'select', id, ids}
//      {t:'chat', id, name, text, at} {t:'reject', ops, reason} {t:'error', msg}
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8790;
const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ROOM_TTL = 60 * 60 * 24 * 60; // 60 days
const MAX_OBJECTS = 20000;
const MAX_MSG = 4 * 1024 * 1024;

// ---------- persistence ----------
async function redis(cmd) {
  if (!REST_URL) return null;
  try {
    const r = await fetch(REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    return j.result ?? null;
  } catch (e) { console.error('redis', e.message); return null; }
}
const memStore = new Map(); // fallback when no Upstash (local dev)
async function saveMap(code, map) {
  const s = JSON.stringify(map);
  if (!REST_URL) { memStore.set(code, s); return; }
  await redis(['SET', `etbr:room:${code}`, s, 'EX', String(ROOM_TTL)]);
}
async function loadMap(code) {
  if (!REST_URL) { const s = memStore.get(code); return s ? JSON.parse(s) : null; }
  const s = await redis(['GET', `etbr:room:${code}`]);
  return s ? JSON.parse(s) : null;
}

// ---------- maps ----------
function blankMap(name) {
  const now = new Date().toISOString();
  return {
    format: 'etbrmap', version: 1,
    meta: { name: name || 'Untitled Level', author: '', description: '', created: now, modified: now, collaborators: [], editor: 'ETBR Mapper' },
    settings: { spawn: { pos: [0, 0, 100], yaw: 0 }, offset: [0, 0, 200000], fog: { density: 0.02, color: '#c9b77a' }, light: { intensity: 3, color: '#fff3c4' }, killZ: -3000 },
    objects: [], logic: [],
  };
}
function sanitizeMap(m) {
  if (!m || typeof m !== 'object' || m.format !== 'etbrmap') throw new Error('not an etbrmap');
  m.objects = Array.isArray(m.objects) ? m.objects.slice(0, MAX_OBJECTS) : [];
  m.logic = Array.isArray(m.logic) ? m.logic : [];
  m.meta = m.meta || {}; m.settings = m.settings || {};
  return m;
}

// ---------- rooms ----------
const rooms = new Map(); // code -> room
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 6; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
}
function makeRoom(code, map) {
  const room = { code, map, rev: 0, users: new Map(), dirty: false, index: { objects: new Map(), logic: new Map() } };
  reindex(room);
  rooms.set(code, room);
  return room;
}
function reindex(room) {
  for (const c of ['objects', 'logic']) {
    room.index[c] = new Map();
    room.map[c].forEach((it, i) => room.index[c].set(it.id, i));
  }
}
async function getRoom(code) {
  code = String(code || '').toUpperCase().trim();
  if (rooms.has(code)) return rooms.get(code);
  const map = await loadMap(code);
  if (!map) return null;
  if (rooms.has(code)) return rooms.get(code); // raced
  return makeRoom(code, sanitizeMap(map));
}
function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const u of room.users.values()) if (u.ws !== except && u.ws.readyState === 1) u.ws.send(s);
}
function publicUser(u) { return { id: u.id, name: u.name, color: u.color, sel: u.sel }; }

// who has an item selected (soft lock)
function lockedBy(room, id, me) {
  for (const u of room.users.values()) if (u.id !== me && u.sel.includes(id)) return u;
  return null;
}

function applyOp(room, op, user) {
  const m = room.map;
  switch (op.o) {
    case 'add': {
      const c = op.c === 'logic' ? 'logic' : 'objects';
      const it = op.item;
      if (!it || typeof it.id !== 'string') return 'bad item';
      if (room.index[c].has(it.id)) return 'duplicate id';
      if (c === 'objects' && m.objects.length >= MAX_OBJECTS) return 'object limit reached';
      room.index[c].set(it.id, m[c].length); m[c].push(it);
      return null;
    }
    case 'set': {
      const c = op.c === 'logic' ? 'logic' : 'objects';
      const i = room.index[c].get(op.id);
      if (i === undefined) return 'missing';
      const lk = lockedBy(room, op.id, user.id); if (lk) return `locked by ${lk.name}`;
      Object.assign(m[c][i], op.patch || {}, { id: op.id });
      return null;
    }
    case 'del': {
      const c = op.c === 'logic' ? 'logic' : 'objects';
      const i = room.index[c].get(op.id);
      if (i === undefined) return null; // already gone, fine
      const lk = lockedBy(room, op.id, user.id); if (lk) return `locked by ${lk.name}`;
      m[c].splice(i, 1); reindex(room);
      return null;
    }
    case 'cfg': {
      const k = op.k === 'meta' ? 'meta' : 'settings';
      m[k] = Object.assign(m[k] || {}, op.patch || {});
      return null;
    }
    case 'replace': {
      room.map = sanitizeMap(op.map); reindex(room);
      return null;
    }
  }
  return 'unknown op';
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' });
  res.end(JSON.stringify(body));
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (url.pathname === '/health' || url.pathname === '/') return json(res, 200, { ok: true, service: 'etbr-collab', rooms: rooms.size, persist: !!REST_URL });
  let m;
  if ((m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{6})(\/map)?$/)) && req.method === 'GET') {
    const room = await getRoom(m[1]);
    if (!room) return json(res, 404, { error: 'no such room' });
    if (m[2]) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${room.code}.etbrmap"`, 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(room.map));
    }
    return json(res, 200, { code: room.code, name: room.map.meta.name, users: [...room.users.values()].map((u) => u.name), objects: room.map.objects.length });
  }
  if (url.pathname === '/api/share' && req.method === 'POST') {
    let body = '';
    for await (const ch of req) { body += ch; if (body.length > MAX_MSG) return json(res, 413, { error: 'too big' }); }
    try {
      const map = sanitizeMap(JSON.parse(body));
      const code = newCode(); makeRoom(code, map); await saveMap(code, map);
      return json(res, 200, { code });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  json(res, 404, { error: 'not found' });
});

// ---------- WS ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
let nextId = 1;
wss.on('connection', (ws) => {
  let user = null, room = null;
  ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
  const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!room) {
      if (msg.t !== 'create' && msg.t !== 'join') return send({ t: 'error', msg: 'join first' });
      const name = String(msg.name || 'Builder').slice(0, 24);
      const color = /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#ffcc33';
      if (msg.t === 'create') {
        let map; try { map = msg.map ? sanitizeMap(msg.map) : blankMap(msg.mapName); } catch (e) { return send({ t: 'error', msg: e.message }); }
        room = makeRoom(newCode(), map); room.dirty = true;
      } else {
        room = await getRoom(msg.room);
        if (!room) return send({ t: 'error', msg: 'Room not found — check the code.' });
      }
      user = { id: 'u' + nextId++, name, color, sel: [], ws };
      room.users.set(user.id, user);
      if (!room.map.meta.collaborators) room.map.meta.collaborators = [];
      if (!room.map.meta.collaborators.includes(name)) room.map.meta.collaborators.push(name);
      send({ t: 'welcome', you: user.id, room: room.code, map: room.map, rev: room.rev, users: [...room.users.values()].map(publicUser) });
      broadcast(room, { t: 'user+', user: publicUser(user) }, ws);
      return;
    }
    switch (msg.t) {
      case 'op': {
        const ok = [], bad = [];
        for (const op of (msg.ops || []).slice(0, 5000)) {
          const err = applyOp(room, op, user);
          (err ? bad : ok).push(err ? { op, err } : op);
        }
        if (ok.length) {
          room.rev++; room.dirty = true; room.map.meta.modified = new Date().toISOString();
          broadcast(room, { t: 'op', from: user.id, ops: ok, rev: room.rev }, ws);
          send({ t: 'ack', rev: room.rev, n: ok.length });
        }
        if (bad.length) send({ t: 'reject', ops: bad.map((b) => b.op), reason: bad[0].err });
        break;
      }
      case 'cursor':
        if (Array.isArray(msg.p)) broadcast(room, { t: 'cursor', id: user.id, p: msg.p.slice(0, 3) }, ws);
        break;
      case 'select':
        user.sel = Array.isArray(msg.ids) ? msg.ids.slice(0, 2000).map(String) : [];
        broadcast(room, { t: 'select', id: user.id, ids: user.sel }, ws);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 400).trim();
        if (text) broadcast(room, { t: 'chat', id: user.id, name: user.name, text, at: Date.now() });
        break;
      }
      case 'ping': send({ t: 'pong' }); break;
    }
  });
  ws.on('close', () => {
    if (!room || !user) return;
    room.users.delete(user.id);
    broadcast(room, { t: 'user-', id: user.id });
    if (room.users.size === 0) flush(room).then(() => { if (room.users.size === 0) rooms.delete(room.code); });
  });
});

// heartbeat + periodic flush
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
async function flush(room) { if (room.dirty) { room.dirty = false; await saveMap(room.code, room.map); } }
setInterval(() => rooms.forEach(flush), 5000);
async function shutdown() { await Promise.all([...rooms.values()].map(flush)); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`etbr-collab on :${PORT} persist=${!!REST_URL}`));
