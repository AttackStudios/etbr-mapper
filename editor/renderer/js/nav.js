// Walk grid for custom entities. Baked in the editor (which has the real 3D scene) and shipped inside the
// .etbrmap, so the in-game loader can path-find with A* using only safe engine calls.
// Grid: cell = 50 cm on Unreal X/Y. Per cell: floor height (int16 cm, map-local) or -32768 = not walkable.
import * as THREE from 'three';

const CELL = 50;          // cm
const HEAD = 170;         // cm of clear space an entity needs above the floor
const BODY = 30;          // cm wall clearance probe
const MAX_CELLS = 90000;  // ~150 x 150 m at 50 cm

// is there anything to stand on under this Unreal-cm position? Same front-faces-only rule the game
// draws with, so a ceiling tile laid flat (visible only from below) counts as nothing.
export function floorUnder(viewport, doc, pos) {
  const solid = [];
  for (const [id, root] of viewport.objects) {
    if (root.userData.c === 'logic' || root.userData.c === 'spawn') continue;
    const it = doc.get('objects', id);
    if (!it || it.props?.noCollision || it.kind === 'text') continue;
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && !o.userData.isLabel && !o.userData.placeholder) solid.push(o); });
  }
  const rc = new THREE.Raycaster(new THREE.Vector3(pos[0] / 100, pos[2] / 100 + 0.5, pos[1] / 100), new THREE.Vector3(0, -1, 0));
  return rc.intersectObjects(solid, false).length > 0;
}

export function bakeNav(viewport, doc) {
  const solid = [];
  for (const [id, root] of viewport.objects) {
    const c = root.userData.c;
    if (c === 'logic' || c === 'spawn') continue;
    const it = doc.get('objects', id);
    if (!it || it.props?.noCollision || it.kind === 'text') continue;
    const item = viewport.catalog.get(it.asset);
    if (item?.cat === 'entities' || item?.builtin || item?.customKind === 'entity' || item?.customKind === 'item') continue;
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && !o.userData.isLabel && !o.userData.placeholder) solid.push(o); });
  }
  if (!solid.length) return null;
  const box = new THREE.Box3();
  for (const o of solid) box.expandByObject(o);
  // three space (m): x = UE X, z = UE Y, y = up
  const x0 = Math.floor((box.min.x * 100) / CELL), x1 = Math.ceil((box.max.x * 100) / CELL);
  const y0 = Math.floor((box.min.z * 100) / CELL), y1 = Math.ceil((box.max.z * 100) / CELL);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0 || w * h > MAX_CELLS) return { error: `level too big for entity navigation (${w}×${h} cells, max ${MAX_CELLS})` };
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true;
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const top = box.max.y + 0.5;
  const floors = new Int16Array(w * h).fill(-32768);
  const p = new THREE.Vector3();
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ux = (x0 + i + 0.5) * CELL, uy = (y0 + j + 0.5) * CELL;
    // highest walkable floor under the cell that has head room
    let from = top, floorY = null;
    for (let tries = 0; tries < 6; tries++) {
      rc.set(p.set(ux / 100, from, uy / 100), down); rc.far = from - box.min.y + 1;
      const hit = rc.intersectObjects(solid, false)[0];
      if (!hit) break;
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : up;
      const fy = hit.point.y;
      if (n.y > 0.7) { // flat enough to stand on: check head room
        rc.set(p.set(ux / 100, fy + 0.05, uy / 100), up); rc.far = HEAD / 100;
        if (!rc.intersectObjects(solid, false).length) { floorY = fy; break; }
      }
      from = fy - 0.05;
    }
    if (floorY === null) continue;
    // walls right next to the cell centre block it (knee + chest height)
    let blocked = false;
    for (const hgt of [0.4, 1.2]) for (const d of dirs) {
      rc.set(p.set(ux / 100, floorY + hgt, uy / 100), d); rc.far = BODY / 100;
      if (rc.intersectObjects(solid, false).length) { blocked = true; break; }
    }
    if (!blocked) floors[j * w + i] = Math.round(floorY * 100);
  }
  const bytes = new Uint8Array(floors.buffer);
  let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  let walk = 0; for (const f of floors) if (f !== -32768) walk++;
  return { cell: CELL, x0, y0, w, h, floors: btoa(s), walkable: walk };
}
