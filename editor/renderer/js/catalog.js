// Object library: categories, search, asset loading (GLB + textures), previews, thumbnails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ueToThreePos, ueRotToQuat, ueToThreeScale } from './coords.js';

const LIB = 'etbrlib://lib/';

// Friendly names for the game's level folders
export const LEVEL_NAMES = {
  Level0: 'Level 0 — The Lobby', Lobby: 'Lobby / Hub', Hub: 'The Hub', TheHub: 'The Hub (main)',
  Level05: 'Level 5 — Terror Hotel', Level07: 'Level 7 — Thalassophobia', Level9: 'Level 9 — Suburbs',
  Level10: 'Level 10 — Field of Wheat', Level188: 'Level 188 — Windows', Level188_Expanded: 'Level 188 (expanded)',
  Level3999: 'Level 3999', Level52: 'Level 52 — School', Level94: 'Level 94 — Motion', Level922: 'Level 922 — Endless Hallways',
  Level974: 'Level 974 — Kitty', LevelFun: 'Level Fun — Party', LevelFun_Expanded: 'Level Fun (expanded)', Fun: 'Fun / Party rooms',
  LevelRun: 'Level Run (!)', LevelDash: 'Level Dash', Poolrooms: 'Level 37 — Poolrooms', Poolrooms_Expanded: 'Poolrooms (expanded)',
  PoolroomsExpansion: 'Poolrooms expansion', Grassrooms: 'Grassrooms', Grassrooms_Expanded: 'Grassrooms (expanded)',
  Garage: 'Level 4 — Abandoned Office / Garage', Office: 'Level 4 — Office', Pipes: 'Level 2 — Pipe Dreams',
  ElectricalStation: 'Level 3 — Electrical Station', Hotel: 'The Hotel', Bunker: 'The Bunker', AbandonedBase: 'Abandoned Base',
  Snackrooms: 'Snackrooms', LightsOut: 'Lights Out', OceanMap: 'The Ocean', OceanMap_Old: 'The Ocean (old)', CaveLevel: 'Cave Level',
  CaveSystem: 'Cave System', TheEnd: 'The End', Tunnel: 'Tunnels', TunnelLevel: 'Tunnel Level', GraffitiLevel: 'Graffiti Level',
  LevelPlasticMariana: 'Plastic Mariana', AnimatedKingdom: 'Animated Kingdom', MainMenuMap: 'Main Menu', LevelCheat: 'Cheat Level', Costumes: 'Costumes',
};

// Built-in objects the loader implements itself (no game asset needed)
const BUILTINS = [
  { id: '/Script/Engine.PointLight', kind: 'actor', name: 'Point Light', cat: 'lights', builtin: 'pointlight', props: { intensity: 5000, color: '#fff3c4', radius: 1000 } },
  { id: '/Script/Engine.SpotLight', kind: 'actor', name: 'Spot Light', cat: 'lights', builtin: 'spotlight', props: { intensity: 8000, color: '#fff3c4', radius: 1500 } },
  { id: '/Script/Engine.RectLight', kind: 'actor', name: 'Rect Light (panel)', cat: 'lights', builtin: 'rectlight', props: { intensity: 4000, color: '#fff3c4', radius: 1000 } },
  { id: 'text', kind: 'text', name: '3D Text / Sign', cat: 'logic', builtin: 'text', props: { text: 'Hello', size: 40, color: '#ffffff' } },
];
export const LOGIC_TYPES = [
  { type: 'spawn', name: 'Player Spawn', color: '#4fd1ff', desc: 'Where players appear when the level starts (only one).' },
  { type: 'exit', name: 'Exit Zone', color: '#4ade80', desc: 'Walk in to escape. Optional: send everyone to a real game level next.' },
  { type: 'kill', name: 'Death Zone', color: '#f43f5e', desc: 'Touching it sends the player back to their last checkpoint.' },
  { type: 'checkpoint', name: 'Checkpoint', color: '#facc15', desc: 'Respawn here after falling / dying.' },
  { type: 'message', name: 'Message Zone', color: '#c084fc', desc: 'Shows floating text when a player walks in.' },
  { type: 'teleport', name: 'Teleporter', color: '#38bdf8', desc: 'Moves the player to a target point.' },
  { type: 'entityspawn', name: 'Entity Spawn Area', color: '#ff5577', desc: 'An entity appears in one of a group\'s areas at a random time (e.g. every 20–50 s).' },
];

export const CATEGORIES = [
  { key: 'kits', name: 'Level Kits', icon: '🧱', hint: 'Pieces grouped by the level that uses them' },
  { key: 'entities', name: 'Entities', icon: '👁', hint: 'Monsters — spawned by the host in co-op' },
  { key: 'items', name: 'Items', icon: '🔦', hint: 'Pick-ups: almond water, flashlights…' },
  { key: 'lights', name: 'Lights', icon: '💡', hint: 'Light sources' },
  { key: 'gameplay', name: 'Gameplay', icon: '⚙️', hint: 'Doors, triggers, exits, gameplay blueprints' },
  { key: 'packs', name: 'All Meshes', icon: '📦', hint: 'Every mesh in the game, by folder' },
  { key: 'logic', name: 'Logic', icon: '🎯', hint: 'Spawn, exits, death zones, checkpoints' },
];

export class Catalog {
  constructor() {
    this.items = []; this.byId = new Map();
    this.loader = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.glbCache = new Map(); this.texCache = new Map(); this.tplCache = new Map();
    this.matCache = new Map();
  }

  setData(cat) {
    const items = (cat.items || []).map((it) => ({ ...it }));
    for (const b of BUILTINS) items.push({ ...b });
    for (const it of items) {
      if (!it.cat) it.cat = classify(it);
      it.search = (it.name + ' ' + it.id + ' ' + (it.levels || []).join(' ')).toLowerCase();
    }
    this.items = items;
    this.byId = new Map(items.map((i) => [i.id, i]));
    this.levels = [...new Set(items.flatMap((i) => i.levels || []))].sort((a, b) => (LEVEL_NAMES[a] || a).localeCompare(LEVEL_NAMES[b] || b, undefined, { numeric: true }));
    this.folders = [...new Set(items.filter((i) => i.kind === 'mesh').map((i) => i.folder))].sort();
  }
  get(id) { return this.byId.get(id); }

  // list for the palette: category + group (level / folder) + search
  query({ cat, group, q }) {
    q = (q || '').trim().toLowerCase();
    let list = this.items;
    if (q) {
      const words = q.split(/\s+/);
      list = list.filter((i) => words.every((w) => i.search.includes(w)));
    } else if (cat === 'kits') list = list.filter((i) => i.kind === 'mesh' && (i.levels || []).includes(group));
    else if (cat === 'packs') list = list.filter((i) => i.kind === 'mesh' && i.folder === group);
    else list = list.filter((i) => i.cat === cat);
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  // ---------- assets ----------
  texture(rel) {
    if (!rel) return null;
    if (this.texCache.has(rel)) return this.texCache.get(rel);
    let done;
    const p = new Promise((r) => (done = r));
    this.texPending = this.texPending || new Set();
    this.texPending.add(p);
    const t = this.texLoader.load(LIB + rel, () => { done(); this.texPending.delete(p); }, undefined, () => { done(); this.texPending.delete(p); });
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    this.texCache.set(rel, t);
    return t;
  }
  material(item, idx) {
    const tex = item.tex?.[idx] || null, tint = item.tint?.[idx] || null;
    const two = !!item.two?.[idx], emis = !!item.emis?.[idx], tile = item.tile?.[idx] || 1;
    const key = (tex || '-') + '|' + (tint || '-') + (two ? '|2' : '') + (emis ? '|e' : '') + '|' + tile;
    if (this.matCache.has(key)) return this.matCache.get(key);
    // one-sided unless Unreal marks the material Two Sided — same as the game, and lets you see into rooms from above
    let map = this.texture(tex);
    if (map && tile !== 1) { map = map.clone(); map.repeat.set(tile, tile); map.needsUpdate = true; } // the material's Tiling parameter
    const m = new THREE.MeshStandardMaterial({ map, color: tint || (tex ? '#ffffff' : '#9a9486'), roughness: 0.85, metalness: 0, side: two ? THREE.DoubleSide : THREE.FrontSide });
    if (emis) { m.emissive.set(tint || '#fff6dd'); m.emissiveMap = map; m.emissiveIntensity = 1.6; }
    this.matCache.set(key, m);
    return m;
  }
  async meshTemplate(item) {
    if (this.glbCache.has(item.id)) return this.glbCache.get(item.id);
    const p = new Promise((resolve) => {
      this.loader.load(LIB + item.glb, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.geometry.computeVertexNormals();
            const mi = parseInt((o.name || o.parent?.name || 'mi0').replace(/\D/g, ''), 10) || 0;
            o.material = this.material(item, mi);
            o.castShadow = o.receiveShadow = false;
          }
        });
        resolve(root);
      }, undefined, () => resolve(null));
    });
    this.glbCache.set(item.id, p);
    return p;
  }

  // a fresh Object3D for placing in the scene (shares geometry/materials with the cache)
  async instantiate(item) {
    if (!item) return placeholder('?', '#ff4d4d', 1);
    if (item.kind === 'mesh') {
      const t = await this.meshTemplate(item);
      return t ? t.clone(true) : placeholder(item.name, '#ff4d4d', 1);
    }
    if (item.kind === 'text') return textSign(item.props?.text || 'Text', item.props?.color, item.props?.size);
    if (item.builtin) return lightGizmo(item.builtin);
    if (item.parts?.length) {
      const g = new THREE.Group();
      for (const part of item.parts) {
        const mi = this.get(part.mesh);
        if (!mi) continue;
        const t = await this.meshTemplate(mi);
        if (!t) continue;
        // compose root..leaf relative transforms
        let parent = g;
        const n = part.pos.length / 3;
        for (let k = 0; k < n; k++) {
          const node = new THREE.Group();
          ueToThreePos(part.pos.slice(k * 3, k * 3 + 3), node.position);
          ueRotToQuat(part.rot.slice(k * 3, k * 3 + 3), node.quaternion);
          ueToThreeScale(part.scale.slice(k * 3, k * 3 + 3), node.scale);
          parent.add(node); parent = node;
        }
        parent.add(t.clone(true));
      }
      if (item.cat === 'entities') g.add(placeholder(item.name, '#ff5577', 1.8, true));
      if (item.cat === 'lights') { const l = new THREE.PointLight('#fff3c4', 3, 9, 1.5); l.position.y = -0.3; g.add(l); }
      return g;
    }
    if (item.cat === 'entities') return placeholder(item.name, '#ff5577', 1.8, true);
    if (item.cat === 'items') return placeholder(item.name, '#ffd166', 0.3);
    return placeholder(item.name, '#8ab4ff', 1);
  }
}

function classify(it) {
  const id = it.id, chain = it.chain || [];
  if (it.kind === 'mesh') return 'packs';
  const native = chain[chain.length - 1] || '';
  if (native === 'Character' || native === 'Pawn' || /\/Entity\//.test(id) || /\/HorrorAI\//.test(id)) return 'entities';
  if (/DroppedItem|ItemSpawner/i.test(id) || chain.some((c) => /DroppedItem|BP_Item_C/.test(c))) return 'items';
  if (/Light/i.test(it.name) && !/Switch/i.test(it.name)) return 'lights';
  return 'gameplay';
}

// ---------- procedural previews ----------
function labelSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,9,6,0.75)'; g.beginPath(); g.roundRect(4, 8, 504, 80, 18); g.fill();
  g.fillStyle = color; g.font = '600 40px Inter, Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.length > 22 ? text.slice(0, 21) + '…' : text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1); s.renderOrder = 10; s.userData.isLabel = true;
  return s;
}
export function placeholder(name, color, h, humanoid) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.85 });
  if (humanoid) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, h - 0.6, 6, 12), mat);
    body.position.y = h / 2; g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    eye.position.set(0.1, h - 0.35, 0.26); g.add(eye); const e2 = eye.clone(); e2.position.x = -0.1; g.add(e2);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(h, h, h), mat);
    box.position.y = h / 2; g.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#ffffff' }));
    edges.position.copy(box.position); g.add(edges);
  }
  g.traverse((o) => { o.userData.placeholder = true; });
  const l = labelSprite(name, color); l.position.y = h + 0.35; g.add(l);
  return g;
}
export function textSign(text, color = '#ffffff', size = 40) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = color; g.font = '700 150px Inter, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const w = (size / 100) * 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
  m.position.y = w / 8;
  const grp = new THREE.Group(); grp.add(m); grp.userData.textMesh = m;
  return grp;
}
export function lightGizmo(kind) {
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff3a0' }));
  g.add(bulb);
  if (kind === 'spotlight') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3a0', wireframe: true }));
    cone.rotation.z = Math.PI / 2; cone.position.x = 0.3; g.add(cone);
  }
  if (kind === 'rectlight') {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ color: '#fff3a0', side: THREE.DoubleSide }));
    p.rotation.x = Math.PI / 2; g.add(p);
  }
  const light = new THREE.PointLight('#fff3c4', 2, 10, 1.5);
  g.add(light); g.userData.light = light;
  return g;
}

// ---------- thumbnails ----------
export class Thumbnailer {
  constructor(catalog) {
    this.catalog = catalog; this.queue = []; this.busy = false; this.done = new Map();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(160, 160); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#fffbe8', '#4a4230', 2.2));
    const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(3, 5, 4); this.scene.add(d);
    this.cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  }
  url(item) { return LIB + 'thumbs/' + item.id.replace(/[^a-z0-9_.-]/gi, '_') + '.png'; }
  request(item, img) {
    if (this.done.has(item.id)) { img.src = this.done.get(item.id); return; }
    // try the disk cache first
    const url = this.url(item) + '?v=1';
    img.onerror = () => { img.onerror = null; this.queue.push({ item, img }); this.pump(); };
    img.onload = () => { this.done.set(item.id, url); };
    img.src = url;
  }
  async pump() {
    if (this.busy) return; this.busy = true;
    while (this.queue.length) {
      const { item, img } = this.queue.shift();
      if (!img.isConnected) continue;
      try {
        const obj = await this.catalog.instantiate(item);
        obj.traverse((o) => { if (o.userData?.isLabel) o.visible = false; });
        if (this.catalog.texPending?.size) await Promise.race([Promise.all([...this.catalog.texPending]), new Promise((r) => setTimeout(r, 3000))]);
        this.scene.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const r = Math.max(size.length() / 2, 0.05);
        const dist = r / Math.sin((35 * Math.PI) / 360) * 1.05;
        this.cam.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(dist));
        this.cam.near = dist / 100; this.cam.far = dist * 10; this.cam.updateProjectionMatrix();
        this.cam.lookAt(c);
        this.renderer.render(this.scene, this.cam);
        const data = this.renderer.domElement.toDataURL('image/png');
        this.scene.remove(obj);
        img.src = data; this.done.set(item.id, data);
        window.etbr.library.saveThumb(item.id, data);
      } catch (e) { console.warn('thumb', item.id, e); }
      await new Promise((r) => setTimeout(r, 0));
    }
    this.busy = false;
  }
}
