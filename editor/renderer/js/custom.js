// Custom content: .etbrObject / .etbrEntity / .etbrItem
// - converts imported 3D models (glb/gltf/obj/fbx) into Unreal-space mesh data the in-game loader builds
// - previews assets in the editor, keeps the CUSTOM library, and runs the create/edit wizard
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { quatToUeRot, ueRotToQuat } from './coords.js';
import { icon } from './icons.js';

export const KINDS = {
  object: { label: 'Object', ext: 'etbrObject', icon: 'meshes', hint: 'Scenery: walls, props, furniture. Solid unless you turn collision off.' },
  entity: { label: 'Entity', ext: 'etbrEntity', icon: 'entity', hint: 'A creature with behaviour: chases, wanders or stalks players.' },
  item:   { label: 'Item',   ext: 'etbrItem',   icon: 'item',   hint: 'A pick-up: lies on the ground, goes in your hand, does something when used.' },
};

// ---------- binary helpers ----------
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const f32b64 = (arr) => toB64(new Uint8Array(new Float32Array(arr).buffer));
const u32b64 = (arr) => toB64(new Uint8Array(new Uint32Array(arr).buffer));
const b64f32 = (b64) => new Float32Array(fromB64(b64).buffer);
const b64u32 = (b64) => new Uint32Array(fromB64(b64).buffer);
export function newAssetId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------- model loading ----------
export async function loadModelFile(file) {
  const buf = fromB64(file.b64).buffer;
  if (file.ext === 'glb') return gltfParse(buf);
  if (file.ext === 'gltf') {
    const json = JSON.parse(new TextDecoder().decode(buf));
    for (const list of [json.buffers || [], json.images || []]) for (const r of list) {
      if (r.uri && !r.uri.startsWith('data:')) { const b = await window.etbr.file.readSibling(file.dir, r.uri); if (b) r.uri = 'data:application/octet-stream;base64,' + b; }
    }
    return gltfParse(JSON.stringify(json));
  }
  if (file.ext === 'obj') {
    const text = new TextDecoder().decode(buf);
    const loader = new OBJLoader();
    const mtlName = (text.match(/^mtllib\s+(.+)$/m) || [])[1];
    if (mtlName) {
      const mtlB64 = await window.etbr.file.readSibling(file.dir, mtlName.trim());
      if (mtlB64) {
        const mtlText = new TextDecoder().decode(fromB64(mtlB64));
        const urls = {};
        for (const m of mtlText.matchAll(/^\s*map_Kd\s+(.+)$/gm)) { const n = m[1].trim(); const b = await window.etbr.file.readSibling(file.dir, n); if (b) urls[n] = 'data:image/png;base64,' + b; }
        const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => urls[u] || urls[decodeURIComponent(u)] || u);
        const mats = new MTLLoader(mgr).parse(mtlText, ''); mats.preload(); loader.setMaterials(mats);
        await new Promise((r) => setTimeout(r, 300)); // let data-URL textures decode
      }
    }
    const obj = loader.parse(text);
    obj.userData.flipV = true; // OBJ UVs start bottom-left; Unreal's start top-left
    return { scene: obj, animations: [] };
  }
  if (file.ext === 'fbx') { const o = new FBXLoader().parse(buf, ''); o.userData.flipV = true; return { scene: o, animations: o.animations || [] }; }
  throw new Error('Unsupported model type .' + file.ext + ' — use .glb, .gltf, .obj or .fbx');
}
async function gltfParse(data) { const g = await new GLTFLoader().parseAsync(data, ''); return { scene: g.scene, animations: g.animations || [] }; }

// ---------- textures ----------
function imageToPngB64(img, max = 1024) {
  if (!img) return null;
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) return null;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
}

// ---------- three -> Unreal mesh data ----------
// three (m, Y-up, RH) -> UE (cm, Z-up, LH): (x, z, y) * 100. Triangle order is kept: three's CCW fronts become
// UE's clockwise fronts after the axis swap (same rule the game-mesh extractor uses).
function geometryToSections(geom, materials, matrix, textures, flipV, scale) {
  const g = geom.index ? geom : geom.clone().setIndex([...Array(geom.attributes.position.count).keys()]);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const V = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3), U = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(matrix).multiplyScalar(100 * scale);
    V[i * 3] = p.x; V[i * 3 + 1] = p.z; V[i * 3 + 2] = p.y;
    if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = n.x; N[i * 3 + 1] = n.z; N[i * 3 + 2] = n.y; } else N[i * 3 + 2] = 1;
    if (uv) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = flipV ? 1 - uv.getY(i) : uv.getY(i); }
  }
  const idx = g.index.array;
  const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const mats = Array.isArray(materials) ? materials : [materials];
  const sections = [];
  for (const gr of groups) {
    const mat = mats[gr.materialIndex] || mats[0] || {};
    // compact this group's vertices
    const remap = new Map(), v = [], nn = [], uu = [], ii = [];
    for (let k = gr.start; k < gr.start + gr.count; k++) {
      const o = idx[k];
      let r = remap.get(o);
      if (r === undefined) { r = remap.size; remap.set(o, r); v.push(V[o * 3], V[o * 3 + 1], V[o * 3 + 2]); nn.push(N[o * 3], N[o * 3 + 1], N[o * 3 + 2]); uu.push(U[o * 2], U[o * 2 + 1]); }
      ii.push(r);
    }
    let tex = null;
    if (mat.map?.image) {
      const key = mat.map.uuid;
      if (!textures[key]) { const png = imageToPngB64(mat.map.image); if (png) textures[key] = { name: 't' + Object.keys(textures).length, png }; }
      tex = textures[key]?.name || null;
    }
    const color = mat.color ? '#' + mat.color.getHexString() : '#ffffff';
    const emissive = mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.3 ? 20 : 0;
    sections.push({ v: f32b64(v), n: f32b64(nn), uv: f32b64(uu), i: u32b64(ii), tex, color, emissive, _tris: ii.length / 3, _v: v });
  }
  return sections;
}
function boundsOf(sections) {
  const b = new THREE.Box3();
  for (const s of sections) for (let i = 0; i < s._v.length; i += 3) b.expandByPoint(new THREE.Vector3(s._v[i], s._v[i + 1], s._v[i + 2]));
  const c = b.getCenter(new THREE.Vector3()), e = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  return { o: [c.x, c.y, c.z].map(Math.round), e: [e.x, e.y, e.z].map(Math.round) };
}
const strip = (sections) => sections.map(({ _v, _tris, ...s }) => s);

// Model -> asset fields. Objects/items: one merged mesh. Entities: one rigid part per mesh node + sampled animations.
export function convertModel(model, { kind, scale = 1, textureOverride = null }) {
  const root = model.scene; root.updateMatrixWorld(true);
  const flipV = !!root.userData.flipV;
  const texMap = {}, meshes = {}, stats = { tris: 0 };
  if (kind !== 'entity') {
    const all = [];
    root.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) all.push(...geometryToSections(o.geometry, o.material, o.matrixWorld, texMap, flipV, scale)); });
    meshes.body = { sections: all, bounds: boundsOf(all) };
  } else {
    let k = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const name = (o.name || 'part').replace(/[^\w-]/g, '_') + '_' + (k++);
      const secs = geometryToSections(o.geometry, o.material, new THREE.Matrix4(), texMap, flipV, scale); // node-local geometry
      meshes[name] = { sections: secs, bounds: boundsOf(secs), _node: o };
    });
  }
  for (const m of Object.values(meshes)) for (const s of m.sections) stats.tris += s._tris;
  const textures = {};
  for (const t of Object.values(texMap)) textures[t.name] = t.png;
  if (textureOverride) {
    textures.override = textureOverride;
    for (const m of Object.values(meshes)) for (const s of m.sections) { s.tex = 'override'; s.color = '#ffffff'; }
  }
  const out = { meshes: {}, textures, stats };
  const parts = [];
  for (const [name, m] of Object.entries(meshes)) {
    out.meshes[name] = { sections: strip(m.sections), bounds: m.bounds };
    if (m._node) parts.push({ name, mesh: name, node: m._node });
  }
  if (kind === 'entity') {
    const toPart = (node) => {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      node.matrixWorld.decompose(p, q, s);
      return { pos: [p.x * 100 * scale, p.z * 100 * scale, p.y * 100 * scale].map((v) => Math.round(v * 10) / 10), rot: quatToUeRot(q), scale: [s.x, s.z, s.y].map((v) => Math.round(v * 1000) / 1000) };
    };
    out.parts = parts.map((p) => ({ name: p.name, mesh: p.mesh, parent: null, ...toPart(p.node) }));
    // sample every clip at 15 fps into rigid part keys
    out.anims = {}; out.clipNames = [];
    if (model.animations?.length) {
      const mixer = new THREE.AnimationMixer(root);
      for (const clip of model.animations) {
        const action = mixer.clipAction(clip); mixer.stopAllAction(); action.reset().play();
        const tracks = parts.map((p) => ({ part: p.name, keys: [] }));
        const step = 1 / 15, len = Math.max(clip.duration, step);
        for (let t = 0; t <= len + 1e-4; t += step) {
          mixer.setTime(t); root.updateMatrixWorld(true);
          parts.forEach((p, i) => { const tr = toPart(p.node); tracks[i].keys.push([Math.round(t * 1000) / 1000, tr.pos, tr.rot]); });
        }
        const nm = (clip.name || 'clip' + out.clipNames.length).replace(/[^\w-]/g, '_');
        out.anims[nm] = { length: len, loop: true, tracks };
        out.clipNames.push(nm);
      }
      mixer.stopAllAction(); mixer.setTime(0); root.updateMatrixWorld(true);
    }
  }
  return out;
}

// ---------- editor preview from asset data ----------
const texCache = new Map();
function previewTexture(asset, name) {
  if (!name || !asset.textures?.[name]) return null;
  const key = asset.id + '/' + name;
  if (texCache.has(key)) return texCache.get(key);
  const t = new THREE.TextureLoader().load('data:image/png;base64,' + asset.textures[name]);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t); return t;
}
function meshObject(asset, meshName) {
  const m = asset.meshes?.[meshName]; const grp = new THREE.Group();
  if (!m) return grp;
  for (const s of m.sections) {
    const v = b64f32(s.v), n = b64f32(s.n), uv = b64f32(s.uv), idx = b64u32(s.i);
    const P = new Float32Array(v.length), Nn = new Float32Array(n.length);
    for (let i = 0; i < v.length; i += 3) { P[i] = v[i] / 100; P[i + 1] = v[i + 2] / 100; P[i + 2] = v[i + 1] / 100; Nn[i] = n[i]; Nn[i + 1] = n[i + 2]; Nn[i + 2] = n[i + 1]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const map = previewTexture(asset, s.tex);
    const mat = new THREE.MeshStandardMaterial({ map, color: s.color || '#ffffff', roughness: 0.8, side: THREE.FrontSide });
    if (s.emissive) { mat.emissive.set('#ffffff'); mat.emissiveMap = map; mat.emissiveIntensity = 1.4; }
    grp.add(new THREE.Mesh(g, mat));
  }
  return grp;
}
export function assetPreview(asset) {
  const g = new THREE.Group();
  if (asset.kind === 'entity') {
    for (const p of asset.entity?.parts || []) {
      const node = meshObject(asset, p.mesh);
      node.position.set(p.pos[0] / 100, p.pos[2] / 100, p.pos[1] / 100);
      ueRotToQuat(p.rot || [0, 0, 0], node.quaternion);
      node.scale.set(p.scale?.[0] ?? 1, p.scale?.[2] ?? 1, p.scale?.[1] ?? 1);
      g.add(node);
    }
  } else if (asset.kind === 'item') g.add(meshObject(asset, asset.item?.ground?.mesh || 'body'));
  else g.add(meshObject(asset, asset.object?.mesh || 'body'));
  return g;
}

// ---------- defaults + script templates ----------
export const SCRIPT_TEMPLATES = {
  object: `-- Optional. Runs inside the game, sandboxed (no files, no programs).\n-- function onSpawn() etbr.log('spawned') end\n`,
  entity: `-- Optional extra behaviour on top of the settings above.\n-- function onSeePlayer(p) etbr.sound('growl') end\n-- function onTouch(p) etbr.kill(p) end\n`,
  item: `-- Called when the player uses the item (if Use = Script).\nfunction onUse(p)\n  etbr.message('It does nothing... yet.')\nend\n`,
};
export function defaultAsset(kind) {
  const a = { format: 'etbr-asset', version: 1, kind, id: newAssetId(), name: 'New ' + KINDS[kind].label, author: '', description: '', icon: '', meshes: {}, textures: {}, sounds: {}, scripts: { 'main.lua': SCRIPT_TEMPLATES[kind] } };
  if (kind === 'object') a.object = { mesh: 'body', collision: true };
  if (kind === 'entity') a.entity = { parts: [], anims: {}, map: { idle: '', walk: '', run: '', attack: '' }, behavior: { mode: 'chase', walkSpeed: 250, runSpeed: 520, sight: 2500, loseSight: 3500, kill: true, killRange: 130, capsule: [40, 90], sounds: { idle: '', chase: '', kill: '' } } };
  if (kind === 'item') a.item = { ground: { mesh: 'body' }, hand: { mesh: 'body', pos: [35, 18, -22], rot: [0, 0, 0], scale: [1, 1, 1] }, use: { type: 'none', light: { intensity: 3000, color: '#fff4d6', angle: 30, range: 1500 }, amount: 25, consume: false }, pickupText: '' };
  return a;
}
