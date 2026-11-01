// Scripted second collaborator: node tools/collabpeer.mjs <ROOM> [baseUrl]
// joins, adds a Level 0 wall, moves its cursor, chats, then waits for the editor's next op.
import { createRequire } from 'module';
const require = createRequire(new URL('../server/index.js', import.meta.url));
const WebSocket = require('ws');
const [room, base = 'https://etbr-collab.onrender.com'] = process.argv.slice(2);
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
const q = [];
ws.on('message', (m) => q.push(JSON.parse(m)));
const next = async (t, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = q.findIndex((x) => x.t === t); if (i >= 0) return q.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout ' + t); };
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ t: 'join', room, name: 'TestFriend', color: '#4ade80' }));
const w = await next('welcome'); console.log('joined', w.room, 'users', w.users.map((u) => u.name).join(','));
ws.send(JSON.stringify({ t: 'op', ops: [{ o: 'add', c: 'objects', item: { id: 'peer_wall_1', asset: '/Game/Backrooms/Meshes/SM_Wall_2m.SM_Wall_2m', kind: 'mesh', pos: [300, 0, 0], rot: [0, 90, 0], scale: [1, 1, 1], layer: 'Default' } }] }));
ws.send(JSON.stringify({ t: 'cursor', p: [3, 1, 0] }));
ws.send(JSON.stringify({ t: 'select', ids: ['peer_wall_1'] }));
ws.send(JSON.stringify({ t: 'chat', text: 'hello from the test friend' }));
console.log('sent add+cursor+select+chat; waiting for an op from the editor…');
const op = await next('op', 60000);
console.log('editor op:', JSON.stringify(op.ops).slice(0, 200));
ws.close(); process.exit(0);
