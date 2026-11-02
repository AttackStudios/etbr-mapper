// Chunked-storage test against the live server.
//   node tools/bigmaptest.mjs upload          -> uploads a ~3 MB map, prints CODE + hash (and saves them)
//   node tools/bigmaptest.mjs verify          -> after a restart: downloads it and compares
import crypto from 'crypto';
import fs from 'fs';
const BASE = 'https://etbr-collab.onrender.com';
const STATE = process.env.BIGMAP_STATE || '/tmp/etbr_bigmap.json';
const canon = (m) => crypto.createHash('sha1').update(JSON.stringify({ o: m.objects, c: m.customAssets })).digest('hex');
if (process.argv[2] === 'upload') {
  const objects = [];
  for (let i = 0; i < 9000; i++) objects.push({ id: 'o' + i, asset: '/Game/Backrooms/Meshes/SM_Wall_2m.SM_Wall_2m', kind: 'mesh', pos: [i, i * 2, 0], rot: [0, i % 360, 0], scale: [1, 1, 1], layer: 'Default' });
  const blob = crypto.randomBytes(1100000).toString('base64'); // an embedded custom asset with a big texture
  const map = { format: 'etbrmap', version: 1, meta: { name: 'BigTest' }, settings: {}, objects, logic: [], customAssets: { bigasset01: { id: 'bigasset01', format: 'etbr-asset', kind: 'object', textures: { t: blob } } } };
  const body = JSON.stringify(map);
  const r = await fetch(BASE + '/api/share', { method: 'POST', body });
  const j = await r.json();
  console.log('uploaded', (body.length / 1048576).toFixed(2), 'MB ->', r.status, j);
  fs.writeFileSync(STATE, JSON.stringify({ code: j.code, hash: canon(map) }));
} else {
  const { code, hash } = JSON.parse(fs.readFileSync(STATE));
  const r = await fetch(`${BASE}/api/room/${code}/map`);
  if (!r.ok) { console.log('FAILED', r.status); process.exit(1); }
  const m = await r.json();
  console.log('room', code, 'objects', m.objects.length, 'identical to upload:', canon(m) === hash);
}
process.exit(0);
