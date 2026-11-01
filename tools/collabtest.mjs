// Two-client smoke test for the collab server: node tools/collabtest.mjs [baseUrl]
import { createRequire } from 'module';
const require = createRequire(new URL('../server/index.js', import.meta.url));
const WebSocket = require('ws');
const BASE = process.argv[2] || 'http://localhost:8799';
const U = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = () => new Promise((r) => {
  const w = new WebSocket(U); const q = [];
  w.on('message', (m) => q.push(JSON.parse(m)));
  w.on('open', () => r({
    w, send: (o) => w.send(JSON.stringify(o)),
    next: async (t) => { for (let i = 0; i < 300; i++) { const k = q.findIndex((x) => x.t === t); if (k >= 0) return q.splice(k, 1)[0]; await sleep(20); } throw new Error('timeout ' + t); },
  }));
});
const a = await open(); a.send({ t: 'create', name: 'Jack', color: '#ff0000', mapName: 'Test' });
const wa = await a.next('welcome'); console.log('room', wa.room);
const b = await open(); b.send({ t: 'join', room: wa.room.toLowerCase(), name: 'Friend' });
const wb = await b.next('welcome'); console.log('b sees users', wb.users.length);
await a.next('user+');
a.send({ t: 'op', ops: [{ o: 'add', c: 'objects', item: { id: 'o1', asset: '/Game/X', kind: 'mesh', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }] });
const ob = await b.next('op'); console.log('b got op', ob.ops[0].o, 'rev', ob.rev);
a.send({ t: 'select', ids: ['o1'] }); await b.next('select');
b.send({ t: 'op', ops: [{ o: 'set', c: 'objects', id: 'o1', patch: { pos: [5, 5, 5] } }] });
console.log('lock reject:', (await b.next('reject')).reason);
a.send({ t: 'chat', text: 'hi' }); console.log('chat', (await b.next('chat')).text);
const map = await (await fetch(`${BASE}/api/room/${wa.room}/map`)).json();
console.log('map objects', map.objects.length, 'collaborators', map.meta.collaborators);
const sh = await (await fetch(`${BASE}/api/share`, { method: 'POST', body: JSON.stringify(map) })).json();
console.log('share', sh);
a.w.close(); b.w.close(); process.exit(0);
