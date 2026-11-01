// 3D viewport: scene sync with the Doc, camera, selection, gizmo, placement, room tool, collab overlays.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ueToThreePos, threeToUePos, ueRotToQuat, quatToUeRot, ueToThreeScale, threeToUeScale } from './coords.js';
import { LOGIC_TYPES, textSign, placeholder } from './catalog.js';
import { newId } from './doc.js';
import { wandererAvatar } from './avatar.js';

const ACCENT = '#f2d45c';
const LOGIC_COLORS = Object.fromEntries(LOGIC_TYPES.map((t) => [t.type, t.color]));
const SPAWN_ID = '__spawn';

export class Viewport extends EventTarget {
  constructor(el, app) {
    super();
    this.el = el; this.app = app; this.doc = app.doc; this.catalog = app.catalog;
    this.objects = new Map(); // id -> root Object3D
    this.selection = new Set();
    this.locks = new Map(); // id -> {name,color} (other users' selections)
    this.mode = 'select'; // select | place | room
    this.gizmoMode = 'translate';
    this.snap = { on: true, grid: 1, rot: 15, scale: 0.25 };
    this.workY = 0;
    this.keys = new Set();
    this.fly = { active: false, speed: 8 };
    this.lighting = 'bright';
    this._initThree();
    this._initGizmo();
    this._initInput();
    this.doc.on((ops, source) => this.onOps(ops, source));
    this._loop = this._loop.bind(this);
    this.clock = new THREE.Clock();
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------------ setup
  _initThree() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1912');
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
    this.camera.position.set(10, 8, 12);
    this.camYaw = Math.atan2(-10, -12); this.camPitch = -0.45;
    this._applyCamRot();

    this.hemi = new THREE.HemisphereLight('#fff6dc', '#5a5038', 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.2); this.sun.position.set(20, 40, 15);
    this.scene.add(this.sun);
    this.fog = new THREE.Fog('#1b1912', 60, 400);

    // grid: minor 1 m, major every 4 m (Level 0 tiles are 4 m)
    this.grid = new THREE.Group();
    const g1 = new THREE.GridHelper(400, 400, '#3a3626', '#2b281d'); g1.material.transparent = true; g1.material.opacity = 0.55;
    const g4 = new THREE.GridHelper(400, 100, '#6b6240', '#4a4430'); g4.material.transparent = true; g4.material.opacity = 0.8;
    this.grid.add(g1, g4);
    const axX = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0.01, 0), new THREE.Vector3(200, 0.01, 0)]), new THREE.LineBasicMaterial({ color: '#c0503a' }));
    const axZ = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, -200), new THREE.Vector3(0, 0.01, 200)]), new THREE.LineBasicMaterial({ color: '#4f9a3a' }));
    this.grid.add(axX, axZ);
    this.scene.add(this.grid);

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selBoxes = new Map(); this.lockBoxes = new Map();
    this.hoverBox = new THREE.BoxHelper(undefined, '#ffffff'); this.hoverBox.material.transparent = true; this.hoverBox.material.opacity = 0.35; this.hoverBox.visible = false;
    this.overlay.add(this.hoverBox);
    this.cursors = new Map();
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.resize();
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setLighting(mode) {
    this.lighting = mode;
    if (mode === 'game') { this.hemi.intensity = 0.25; this.sun.intensity = 0; this.scene.fog = this.fog; }
    else { this.hemi.intensity = 1.6; this.sun.intensity = 1.2; this.scene.fog = null; }
    for (const o of this.objects.values()) if (o.userData.light) o.userData.light.visible = mode === 'game' || this.objects.size < 400;
  }

  _initGizmo() {
    this.pivot = new THREE.Object3D(); this.scene.add(this.pivot);
    const tc = this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    tc.setSize(0.9);
    this.scene.add(tc.getHelper());
    tc.addEventListener('dragging-changed', (e) => {
      this.gizmoDragging = e.value;
      if (e.value) this._dragStart(); else this._dragEnd();
    });
    tc.addEventListener('objectChange', () => this._dragMove());
    this._applySnap();
  }
  _applySnap() {
    const s = this.snap;
    this.gizmo.setTranslationSnap(s.on ? s.grid : null);
    this.gizmo.setRotationSnap(s.on ? THREE.MathUtils.degToRad(s.rot) : null);
    this.gizmo.setScaleSnap(s.on ? s.scale : null);
  }
  setSnap(patch) { Object.assign(this.snap, patch); this._applySnap(); }
  setGizmoMode(m) {
    this.gizmoMode = m; this.gizmo.setMode(m);
    this._refreshGizmo();
  }
  toggleSpace() { this.gizmo.setSpace(this.gizmo.space === 'local' ? 'world' : 'local'); return this.gizmo.space; }

  // ------------------------------------------------------------------ doc -> scene
  async onOps(ops, source) {
    for (const op of ops) {
      if (op.o === 'replace') { await this.rebuild(); continue; }
      if (op.o === 'cfg') { if (op.k !== 'meta') this.updateSpawn(); continue; }
      const c = op.c === 'logic' ? 'logic' : 'objects';
      if (op.o === 'add') await this.createFor(c, this.doc.get(c, op.item.id));
      else if (op.o === 'del') this.removeFor(op.id);
      else if (op.o === 'set') {
        const it = this.doc.get(c, op.id); if (!it) continue;
        if ('asset' in op.patch || 'props' in op.patch || 'type' in op.patch || 'kind' in op.patch) { this.removeFor(op.id, true); await this.createFor(c, it); }
        else this.applyTransform(this.objects.get(op.id), c, it);
      }
    }
    this._refreshSelectionBoxes();
    this._refreshGizmo();
    this.dispatchEvent(new Event('scenechange'));
  }
  async rebuild() {
    for (const id of [...this.objects.keys()]) this.removeFor(id, true);
    this.selection.clear();
    this.updateSpawn();
    const objs = this.doc.all('objects'), logic = this.doc.all('logic');
    // preload unique assets first (parallel), then instantiate
    const unique = [...new Set(objs.map((o) => o.asset))];
    await Promise.all(unique.map((id) => { const it = this.catalog.get(id); return it?.kind === 'mesh' ? this.catalog.meshTemplate(it) : null; }));
    for (const o of objs) await this.createFor('objects', o);
    for (const l of logic) await this.createFor('logic', l);
    this.setLighting(this.lighting);
    this.dispatchEvent(new Event('selection'));
  }
  async createFor(c, it) {
    if (!it || this.objects.has(it.id)) return;
    let obj;
    if (c === 'logic') obj = logicVolume(it);
    else {
      const item = this.catalog.get(it.asset) || (it.kind === 'text' ? this.catalog.get('text') : null);
      if (it.kind === 'text') obj = textSign(it.props?.text || 'Text', it.props?.color || '#fff', it.props?.size || 40);
      else obj = item ? await this.catalog.instantiate(item) : placeholder('Missing: ' + (it.asset || '').split('/').pop(), '#ff4d4d', 1);
      if (this.objects.has(it.id)) return; // raced with another add
      obj.traverse((o) => { if (o.isPointLight) { obj.userData.light = o; } });
      if (obj.userData.light) applyLightProps(obj.userData.light, it.props || item?.props || {});
    }
    obj.userData.id = it.id; obj.userData.c = c;
    obj.traverse((o) => { o.userData.rootId = it.id; });
    this.applyTransform(obj, c, it);
    this.objects.set(it.id, obj); this.world.add(obj);
  }
  removeFor(id, keepSelection) {
    const o = this.objects.get(id); if (!o) return;
    this.world.remove(o); this.objects.delete(id);
    if (!keepSelection && this.selection.delete(id)) this.dispatchEvent(new Event('selection'));
  }
  applyTransform(obj, c, it) {
    if (!obj) return;
    ueToThreePos(it.pos || [0, 0, 0], obj.position);
    if (c === 'logic') {
      const s = it.size || [200, 200, 200];
      obj.scale.set(s[0] / 100, s[2] / 100, s[1] / 100);
      obj.quaternion.identity();
    } else {
      ueRotToQuat(it.rot || [0, 0, 0], obj.quaternion);
      ueToThreeScale(it.scale || [1, 1, 1], obj.scale);
      if (obj.userData.light) applyLightProps(obj.userData.light, it.props || {});
    }
  }
  updateSpawn() {
    const sp = this.doc.map.settings.spawn || { pos: [0, 0, 100], yaw: 0 };
    if (!this.spawnObj) {
      this.spawnObj = spawnMarker(); this.spawnObj.userData.id = SPAWN_ID; this.spawnObj.userData.c = 'spawn';
      this.spawnObj.traverse((o) => { o.userData.rootId = SPAWN_ID; });
      this.world.add(this.spawnObj); this.objects.set(SPAWN_ID, this.spawnObj);
    }
    // spawn pos is the player's capsule centre (~1 m above floor); marker origin = feet
    ueToThreePos(sp.pos, this.spawnObj.position); this.spawnObj.position.y -= 0.9;
    this.spawnObj.rotation.set(0, -THREE.MathUtils.degToRad(sp.yaw || 0), 0);
  }

  // ------------------------------------------------------------------ selection
  select(ids, { add = false, toggle = false } = {}) {
    if (!add && !toggle) this.selection.clear();
    for (const id of ids) {
      if (!this.objects.has(id)) continue;
      const lk = this.locks.get(id);
      if (lk) { this.app.toast(`🔒 ${lk.name} is editing that`); continue; }
      if (toggle && this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    }
    this._refreshSelectionBoxes(); this._refreshGizmo();
    this.dispatchEvent(new Event('selection'));
  }
  clearSelection() { if (this.selection.size) this.select([]); }
  selectAll() { this.select([...this.objects.keys()].filter((id) => id !== SPAWN_ID)); }
  _refreshSelectionBoxes() {
    for (const [id, b] of this.selBoxes) if (!this.selection.has(id) || !this.objects.has(id)) { this.overlay.remove(b); this.selBoxes.delete(id); }
    for (const id of this.selection) {
      const o = this.objects.get(id); if (!o) continue;
      let b = this.selBoxes.get(id);
      if (!b) { b = new THREE.BoxHelper(o, ACCENT); b.material.depthTest = false; b.renderOrder = 5; this.overlay.add(b); this.selBoxes.set(id, b); }
      b.setFromObject(o);
    }
    for (const [id, b] of this.lockBoxes) { const o = this.objects.get(id); if (o) b.setFromObject(o); else { this.overlay.remove(b); this.lockBoxes.delete(id); } }
  }
  _refreshGizmo() {
    const sel = [...this.selection].map((id) => this.objects.get(id)).filter(Boolean);
    if (!sel.length || this.mode !== 'select') { this.gizmo.detach(); return; }
    const onlyLogic = sel.every((o) => o.userData.c === 'logic' || o.userData.c === 'spawn');
    if (onlyLogic && this.gizmoMode === 'rotate' && !sel.every((o) => o.userData.c === 'spawn')) this.gizmo.setMode('translate');
    else this.gizmo.setMode(this.gizmoMode);
    if (sel.length === 1) { this.pivot.position.copy(sel[0].position); this.pivot.quaternion.copy(sel[0].quaternion); this.pivot.scale.set(1, 1, 1); }
    else {
      const box = new THREE.Box3(); for (const o of sel) box.expandByPoint(o.position);
      box.getCenter(this.pivot.position); this.pivot.quaternion.identity(); this.pivot.scale.set(1, 1, 1);
    }
    this.pivot.updateMatrixWorld();
    if (this.gizmo.object !== this.pivot) this.gizmo.attach(this.pivot);
    this.gizmo.showY = this.gizmo.showZ = true;
    if (sel.length === 1 && sel[0].userData.c === 'spawn' && this.gizmo.mode === 'rotate') { this.gizmo.showX = this.gizmo.showZ = false; } else this.gizmo.showX = true;
  }
  _dragStart() {
    this.dragSet = [...this.selection].map((id) => this.objects.get(id)).filter(Boolean).map((o) => ({ o, m: o.matrix.clone(), scale: o.scale.clone() }));
    this.pivotStart = this.pivot.matrixWorld.clone();
    this.pivotStartInv = this.pivotStart.clone().invert();
    this.lastLive = 0;
  }
  _dragMove() {
    if (!this.dragSet) return;
    this.pivot.updateMatrixWorld();
    const delta = new THREE.Matrix4().multiplyMatrices(this.pivot.matrixWorld, this.pivotStartInv);
    for (const d of this.dragSet) {
      const m = new THREE.Matrix4().multiplyMatrices(delta, d.m);
      m.decompose(d.o.position, d.o.quaternion, d.o.scale);
      if (d.o.userData.c === 'logic') d.o.quaternion.identity();
      if (d.o.userData.c === 'spawn') { const e = new THREE.Euler().setFromQuaternion(d.o.quaternion, 'YXZ'); d.o.rotation.set(0, e.y, 0); d.o.scale.set(1, 1, 1); }
    }
    this._refreshSelectionBoxes();
    const now = performance.now();
    if (now - this.lastLive > 100) { this.lastLive = now; this.app.collab?.sendLive(this._dragOps()); }
    this.dispatchEvent(new Event('dragmove'));
  }
  _dragOps() {
    const ops = [];
    for (const d of this.dragSet || []) {
      const o = d.o, id = o.userData.id, c = o.userData.c;
      if (c === 'spawn') {
        const p = o.position.clone(); p.y += 0.9;
        const yaw = -THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y);
        ops.push({ o: 'cfg', k: 'settings', patch: { spawn: { pos: threeToUePos(p), yaw: Math.round(yaw * 10) / 10 } } });
      } else if (c === 'logic') {
        ops.push({ o: 'set', c, id, patch: { pos: threeToUePos(o.position), size: threeToUeScale(o.scale).map((v) => Math.max(10, Math.round(v * 100))) } });
      } else {
        ops.push({ o: 'set', c, id, patch: { pos: threeToUePos(o.position), rot: quatToUeRot(o.quaternion), scale: threeToUeScale(o.scale) } });
      }
    }
    return ops;
  }
  _dragEnd() {
    if (!this.dragSet) return;
    const ops = this._dragOps();
    // restore pre-drag matrices so the Doc's inverse ops capture the true "before" values
    for (const d of this.dragSet) d.m.decompose(d.o.position, d.o.quaternion, d.o.scale);
    this.dragSet = null;
    this.doc.apply(ops, { label: 'Transform' });
  }

  // ------------------------------------------------------------------ input
  _initInput() {
    const dom = this.renderer.domElement;
    dom.tabIndex = 0;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    dom.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => { if (!isTyping(e)) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.marquee = document.createElement('div'); this.marquee.className = 'marquee'; this.el.appendChild(this.marquee);
  }
  _ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.pointer;
  }
  pick(e, { ignore } = {}) {
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    for (const h of hits) {
      if (!h.object.visible || h.object.userData.isLabel) continue;
      if (ignore && isChildOf(h.object, ignore)) continue;
      const id = h.object.userData.rootId; if (!id) continue;
      return { id, point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0), object: h.object };
    }
    return null;
  }
  groundPoint(e, y = this.workY) {
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    this.groundPlane.constant = -y;
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }
  _down(e) {
    this.renderer.domElement.focus();
    this.downAt = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    if (e.button === 2) { this.fly.active = true; this.renderer.domElement.requestPointerLock?.(); return; }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.navDrag = e.button === 1 ? 'pan' : 'orbit';
      if (this.navDrag === 'orbit') { const p = this.pick(e)?.point || this.groundPoint(e) || new THREE.Vector3(); this.orbitPivot = this.selection.size ? this.pivot.position.clone() : p; }
      e.preventDefault(); return;
    }
    if (e.button !== 0 || this.gizmo.axis) return; // gizmo handles its own drags
    if (this.mode === 'place') return this._placeClick(e);
    if (this.mode === 'room') { const p = this.groundPoint(e); if (p) this.roomStart = this._snapXZ(p, this.roomCell()); return; }
    this.marqueeStart = { x: e.clientX, y: e.clientY };
  }
  _move(e) {
    if (this.fly.active && document.pointerLockElement) {
      this.camYaw -= e.movementX * 0.0025; this.camPitch = THREE.MathUtils.clamp(this.camPitch - e.movementY * 0.0025, -1.55, 1.55);
      this._applyCamRot(); return;
    }
    if (this.navDrag === 'pan') {
      const d = this.camera.position.distanceTo(this.orbitPivot || new THREE.Vector3()) || 10;
      const k = 0.0016 * Math.max(4, d);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      this.camera.position.addScaledVector(right, -e.movementX * k).addScaledVector(up, e.movementY * k); return;
    }
    if (this.navDrag === 'orbit') {
      const off = this.camera.position.clone().sub(this.orbitPivot);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta -= e.movementX * 0.006; sph.phi = THREE.MathUtils.clamp(sph.phi - e.movementY * 0.006, 0.05, Math.PI - 0.05);
      this.camera.position.copy(this.orbitPivot).add(off.setFromSpherical(sph));
      this.camera.lookAt(this.orbitPivot);
      const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
      this.camYaw = Math.atan2(-dir.x, -dir.z); this.camPitch = Math.asin(dir.y); return;
    }
    if (e.target !== this.renderer.domElement && !this.marqueeStart && !this.roomStart) return;
    // collab cursor + hover + tools
    const hit = this.pick(e, { ignore: this.ghost });
    const gp = hit?.point || this.groundPoint(e);
    if (gp) { this.cursorPoint = gp; this.app.collab?.sendCursor(gp); this.dispatchEvent(new CustomEvent('cursor', { detail: gp })); }
    if (this.mode === 'place') return this._ghostMove(e, hit);
    if (this.mode === 'room' && this.roomStart) { const p = this.groundPoint(e); if (p) this._roomPreview(this.roomStart, this._snapXZ(p, this.roomCell())); return; }
    if (this.marqueeStart) {
      const dx = e.clientX - this.marqueeStart.x, dy = e.clientY - this.marqueeStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        const r = this.el.getBoundingClientRect();
        Object.assign(this.marquee.style, { display: 'block', left: Math.min(e.clientX, this.marqueeStart.x) - r.left + 'px', top: Math.min(e.clientY, this.marqueeStart.y) - r.top + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
      }
      return;
    }
    const hov = hit && !this.gizmoDragging ? this.objects.get(hit.id) : null;
    if (hov && !this.selection.has(hit.id)) { this.hoverBox.setFromObject(hov); this.hoverBox.visible = true; } else this.hoverBox.visible = false;
  }
  _up(e) {
    if (e.button === 2 && this.fly.active) {
      this.fly.active = false; document.exitPointerLock?.();
      const moved = this.downAt && performance.now() - this.downAt.t < 250 && !this.flyMoved;
      this.flyMoved = false;
      if (moved && this.mode !== 'select') this.app.setMode('select');
      return;
    }
    if (this.navDrag) { this.navDrag = null; return; }
    if (this.mode === 'room' && this.roomStart && e.button === 0) {
      const p = this.groundPoint(e); const a = this.roomStart; this.roomStart = null; this._roomPreview(null);
      if (p) this.buildRoom(a, this._snapXZ(p, this.roomCell()));
      return;
    }
    if (!this.marqueeStart || e.button !== 0) return;
    const start = this.marqueeStart; this.marqueeStart = null;
    const dragged = this.marquee.style.display === 'block'; this.marquee.style.display = 'none';
    if (dragged) {
      const r = this.renderer.domElement.getBoundingClientRect();
      const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX), y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY);
      const ids = [];
      const v = new THREE.Vector3();
      for (const [id, o] of this.objects) {
        v.copy(o.position).project(this.camera);
        if (v.z > 1) continue;
        const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(id);
      }
      this.select(ids, { add: e.shiftKey, toggle: e.ctrlKey });
    } else {
      const hit = this.pick(e);
      if (hit) this.select([hit.id], { add: e.shiftKey, toggle: e.ctrlKey });
      else if (!e.shiftKey && !e.ctrlKey) this.clearSelection();
    }
  }
  _wheel(e) {
    e.preventDefault();
    if (this.fly.active) { this.fly.speed = THREE.MathUtils.clamp(this.fly.speed * (e.deltaY < 0 ? 1.2 : 0.83), 1, 200); this.app.toast(`Fly speed ${this.fly.speed.toFixed(0)} m/s`, 600); return; }
    if (this.mode === 'place' && e.shiftKey) { this.ghostYaw = (this.ghostYaw || 0) + (e.deltaY < 0 ? 15 : -15); this._ghostMove(e, this.pick(e, { ignore: this.ghost })); return; }
    const target = this.pick(e)?.point || this.groundPoint(e);
    const dir = target ? target.clone().sub(this.camera.position) : new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(20);
    const dist = dir.length();
    const step = Math.min(dist * 0.18, 40) * (e.deltaY < 0 ? 1 : -1.2);
    this.camera.position.addScaledVector(dir.normalize(), step);
  }
  _applyCamRot() { this.camera.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ'); }

  focusSelection() {
    const objs = this.selection.size ? [...this.selection].map((id) => this.objects.get(id)).filter(Boolean) : [...this.objects.values()];
    if (!objs.length) return;
    const box = new THREE.Box3(); for (const o of objs) box.expandByObject(o);
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    this.camera.position.copy(c).addScaledVector(dir, -r * 1.8);
  }

  // ------------------------------------------------------------------ frame
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._animAvatars(dt);
    if (this.fly.active) {
      const k = this.keys, v = new THREE.Vector3();
      if (k.has('KeyW')) v.z -= 1; if (k.has('KeyS')) v.z += 1; if (k.has('KeyA')) v.x -= 1; if (k.has('KeyD')) v.x += 1;
      if (k.has('KeyE') || k.has('Space')) v.y += 1; if (k.has('KeyQ') || k.has('ControlLeft')) v.y -= 1;
      if (v.lengthSq()) {
        this.flyMoved = true;
        const sp = this.fly.speed * (k.has('ShiftLeft') ? 3 : 1) * dt;
        const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
        const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
        this.camera.position.addScaledVector(fwd, -v.z * sp).addScaledVector(right, v.x * sp).addScaledVector(new THREE.Vector3(0, 1, 0), v.y * sp);
      }
    }
    for (const cur of this.cursors.values()) { cur.g.position.lerp(cur.target, 0.25); cur.g.lookAt(this.camera.position); }
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ placement
  async startPlacing(item, logicType) {
    this.stopPlacing();
    this.placeItem = item; this.placeLogic = logicType || null; this.ghostYaw = this.ghostYaw || 0;
    let g;
    if (logicType) g = logicType === 'spawn' ? spawnMarker() : logicVolume({ type: logicType, size: [200, 200, 200] });
    else g = await this.catalog.instantiate(item);
    if (this.placeItem !== item || this.placeLogic !== (logicType || null)) return;
    g.traverse((o) => { if (o.material && !o.userData.isLabel) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; } });
    this.ghost = g; this.scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    this.ghostBottom = logicType && logicType !== 'spawn' ? -0.0 : (isFinite(box.min.y) ? box.min.y : 0);
    g.visible = false;
  }
  stopPlacing() { if (this.ghost) this.scene.remove(this.ghost); this.ghost = null; this.placeItem = null; this.placeLogic = null; }
  _snapXZ(p, cell = this.snap.grid) {
    if (!this.snap.on) return p.clone();
    return new THREE.Vector3(Math.round(p.x / cell) * cell, p.y, Math.round(p.z / cell) * cell);
  }
  _ghostMove(e, hit) {
    if (!this.ghost) return;
    let p, onTop = false;
    if (hit && !this.placeLogic) {
      p = hit.point.clone();
      if (hit.normal.y > 0.6) onTop = true; // stacking on a surface
      else p.addScaledVector(hit.normal, 0.01);
    } else p = this.groundPoint(e);
    if (!p) { this.ghost.visible = false; return; }
    const s = this._snapXZ(p);
    s.y = onTop || !hit ? p.y : p.y;
    if (this.placeLogic && this.placeLogic !== 'spawn') s.y = (hit?.point.y ?? this.workY) + 1;
    else s.y -= this.ghostBottom * 1;
    this.ghost.position.copy(s);
    this.ghost.rotation.set(0, THREE.MathUtils.degToRad(this.ghostYaw || 0), 0);
    this.ghost.visible = true;
  }
  rotateGhost(step = 90) { this.ghostYaw = ((this.ghostYaw || 0) + step) % 360; if (this.ghost) this.ghost.rotation.y = THREE.MathUtils.degToRad(this.ghostYaw); }
  _placeClick(e) {
    if (!this.ghost?.visible) return;
    const pos = threeToUePos(this.ghost.position);
    if (this.placeLogic === 'spawn') {
      const p = this.ghost.position.clone(); p.y += 0.9;
      this.doc.apply([{ o: 'cfg', k: 'settings', patch: { spawn: { pos: threeToUePos(p), yaw: -(this.ghostYaw || 0) } } }], { label: 'Move spawn' });
      this.app.setMode('select'); this.select([SPAWN_ID]); return;
    }
    if (this.placeLogic) {
      const id = newId('l');
      const base = { id, type: this.placeLogic, pos, size: [200, 200, 200] };
      if (this.placeLogic === 'message') base.text = 'Something is watching…';
      if (this.placeLogic === 'exit') base.text = 'You escaped!';
      if (this.placeLogic === 'teleport') base.to = [pos[0] + 400, pos[1], pos[2]];
      const ops = [{ o: 'add', c: 'logic', item: base }];
      if (this.placeLogic === 'entityspawn') {
        base.size = [400, 400, 250];
        base.group = this.app.lastSpawnGroup || 'Group 1';
        const groups = this.doc.map.settings.spawnGroups || {};
        if (!groups[base.group]) ops.push({ o: 'cfg', k: 'settings', patch: { spawnGroups: { ...groups, [base.group]: this.app.defaultSpawnGroup() } } });
      }
      this.doc.apply(ops, { label: 'Add ' + this.placeLogic });
      if (!e.shiftKey) { this.app.setMode('select'); this.select([id]); }
      return;
    }
    const it = this.placeItem;
    const item = { id: newId('o'), asset: it.id, kind: it.kind, pos, rot: quatToUeRot(this.ghost.quaternion), scale: [1, 1, 1], layer: this.app.activeLayer || 'Default' };
    if (it.props) item.props = { ...it.props };
    this.doc.apply([{ o: 'add', c: 'objects', item }], { label: 'Place ' + it.name });
  }

  // ------------------------------------------------------------------ room tool
  roomCell() { return (this.app.roomKit?.cell || 400) / 100; }
  _roomPreview(a, b) {
    if (this.roomBox) { this.overlay.remove(this.roomBox); this.roomBox = null; }
    if (!a || !b) return;
    const h = (this.app.roomKit?.height || 400) / 100;
    const w = Math.max(Math.abs(b.x - a.x), this.roomCell()), d = Math.max(Math.abs(b.z - a.z), this.roomCell());
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.12, depthWrite: false }));
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(g.geometry), new THREE.LineBasicMaterial({ color: ACCENT }));
    g.add(ed);
    g.position.set(Math.min(a.x, b.x) + w / 2, this.workY + h / 2, Math.min(a.z, b.z) + d / 2);
    this.roomBox = g; this.overlay.add(g);
    this.app.toast(`Room ${w.toFixed(0)} × ${d.toFixed(0)} m`, 500);
  }
  async buildRoom(a, b) {
    const kit = this.app.roomKit; if (!kit) return;
    const cell = this.roomCell();
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    if (x1 - x0 < cell) x1 = x0 + cell; if (z1 - z0 < cell) z1 = z0 + cell;
    const nx = Math.round((x1 - x0) / cell), nz = Math.round((z1 - z0) / cell);
    if (nx * nz > 900) return this.app.toast('That room is huge — try something smaller (max 30×30 tiles)');
    const y = this.workY, H = (kit.height || 400) / 100;
    const ops = [];
    const add = (assetId, cx, cy, cz, yaw = 0, extra = {}) => {
      const it = this.catalog.get(assetId); if (!it) return;
      // place so the mesh's bounds centre lands on (cx, ?, cz) and its bottom on cy
      const b = it.bounds || { o: [0, 0, 0], e: [0, 0, 0] };
      const q = ueRotToQuat([0, yaw, 0]);
      const o = ueToThreePos(b.o).applyQuaternion(q);
      const halfH = b.e[2] / 100;
      const pos = new THREE.Vector3(cx - o.x, cy + halfH - o.y, cz - o.z);
      ops.push({ o: 'add', c: 'objects', item: { id: newId('o'), asset: assetId, kind: it.kind, pos: threeToUePos(pos), rot: [0, yaw, 0], scale: [1, 1, 1], layer: this.app.activeLayer || 'Default', ...extra } });
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
      if (kit.floor) add(kit.floor, cx, y - this._thick(kit.floor), cz);
      if (kit.ceiling) add(kit.ceiling, cx, y + H, cz);
      if (kit.light && kit.lightEvery && (i % kit.lightEvery === 0) && (j % kit.lightEvery === 0)) {
        add(kit.light, cx, y + H - this._thick(kit.light) - 0.005, cz);
        if (kit.pointLight) ops.push({ o: 'add', c: 'objects', item: { id: newId('o'), asset: '/Script/Engine.PointLight', kind: 'actor', pos: threeToUePos(new THREE.Vector3(cx, y + H - 0.3, cz)), rot: [0, 0, 0], scale: [1, 1, 1], layer: this.app.activeLayer || 'Default', props: { intensity: 2500, color: '#fff3c4', radius: 900 } } });
      }
    }
    if (kit.wall) {
      const wi = this.catalog.get(kit.wall);
      const ww = wi?.bounds ? (wi.bounds.e[0] * 2) / 100 : cell;
      const facing = await this._wallFacing(wi); // local normal sign of the wall plane (+1 / -1 along UE Y)
      const along = (len) => Math.max(1, Math.round(len / ww));
      // edges: north (z0) & south (z1) run along X; west (x0) & east (x1) run along Z
      const edges = [
        { ax: 'x', fixed: z0, from: x0, to: x1, inward: +1 }, { ax: 'x', fixed: z1, from: x0, to: x1, inward: -1 },
        { ax: 'z', fixed: x0, from: z0, to: z1, inward: +1 }, { ax: 'z', fixed: x1, from: z0, to: z1, inward: -1 },
      ];
      for (const ed of edges) {
        const n = along(ed.to - ed.from), seg = (ed.to - ed.from) / n;
        for (let k = 0; k < n; k++) {
          const t = ed.from + (k + 0.5) * seg;
          // wall plane lies along UE X (three X); its normal is ±UE Y (three Z). Rotate so the normal points into the room.
          let yaw;
          if (ed.ax === 'x') yaw = ed.inward * facing > 0 ? 0 : 180;
          else yaw = ed.inward * facing > 0 ? -90 : 90;
          const cx = ed.ax === 'x' ? t : ed.fixed, cz = ed.ax === 'x' ? ed.fixed : t;
          add(kit.wall, cx, y, cz, yaw);
        }
      }
    }
    this.doc.apply(ops, { label: 'Build room' });
    this.app.toast(`Built a ${nx * cell}×${nz * cell} m room (${ops.length} pieces) — Ctrl+Z to undo`);
  }
  _thick(assetId) { const it = this.catalog.get(assetId); return it?.bounds ? (it.bounds.e[2] * 2) / 100 : 0; }
  async _wallFacing(item) {
    // find which way the (single-sided) wall's triangles face: +1 = +UE Y (three +Z)
    if (!item || item.kind !== 'mesh') return 1;
    const t = await this.catalog.meshTemplate(item);
    let nz = 0;
    t?.traverse((o) => {
      if (!o.isMesh || nz) return;
      const n = o.geometry.attributes.normal; if (!n) return;
      for (let i = 0; i < Math.min(n.count, 50); i++) nz += n.getZ(i);
    });
    return nz >= 0 ? 1 : -1;
  }

  // ------------------------------------------------------------------ collab overlays
  setRemoteCursor(id, user, p) {
    let c = this.cursors.get(id);
    if (!c) {
      const g = new THREE.Group();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: user.color, depthTest: false }));
      dot.renderOrder = 20; g.add(dot);
      const lbl = nameSprite(user.name, user.color); lbl.position.y = 0.45; g.add(lbl);
      this.overlay.add(g); c = { g, target: new THREE.Vector3() }; this.cursors.set(id, c);
    }
    c.target.set(p[0], p[1], p[2]);
  }
  removeRemote(id) { const c = this.cursors.get(id); if (c) { this.overlay.remove(c.g); this.cursors.delete(id); } this.setRemoteSelection(id, null, []); this.setRemoteTesting(id, null, false); }
  // collaborators who are play-testing show up as walking Wanderer avatars
  setRemoteTesting(id, user, on) {
    this.avatars = this.avatars || new Map();
    const a = this.avatars.get(id);
    if (!on) { if (a) { this.scene.remove(a); this.avatars.delete(id); } return; }
    if (!a && user) { const g = wandererAvatar(user.name, user.color); g.visible = false; this.scene.add(g); this.avatars.set(id, g); }
    const c = this.cursors.get(id); if (c) c.g.visible = !on;
  }
  setRemotePose(id, user, pose) {
    this.avatars = this.avatars || new Map();
    if (!this.avatars.has(id)) this.setRemoteTesting(id, user, true);
    const g = this.avatars.get(id); if (!g) return;
    const u = g.userData;
    u.target.set(pose.p[0], pose.p[1], pose.p[2]);
    if (!g.visible) { g.position.copy(u.target); g.visible = true; }
    u.yaw = pose.yaw; u.cr = pose.cr; u.beam.visible = !!pose.fl;
  }
  _animAvatars(dt) {
    if (!this.avatars) return;
    for (const g of this.avatars.values()) {
      const u = g.userData;
      const speed = g.position.distanceTo(u.target) / Math.max(dt, 1e-3);
      g.position.lerp(u.target, Math.min(1, dt * 12));
      g.rotation.y += (u.yaw - g.rotation.y) * Math.min(1, dt * 12);
      u.t += dt * Math.min(speed, 6) * 2.2;
      const sw = Math.sin(u.t) * Math.min(1, speed / 3) * 0.5;
      const l1 = u.body.getObjectByName('leg-1'), l2 = u.body.getObjectByName('leg1');
      if (l1) l1.rotation.x = sw; if (l2) l2.rotation.x = -sw;
      u.body.scale.y = THREE.MathUtils.lerp(u.body.scale.y, u.cr ? 0.65 : 1, Math.min(1, dt * 10));
    }
  }
  setRemoteSelection(userId, user, ids) {
    for (const [oid, lk] of [...this.locks]) if (lk.userId === userId) { this.locks.delete(oid); const b = this.lockBoxes.get(oid); if (b) { this.overlay.remove(b); this.lockBoxes.delete(oid); } }
    for (const oid of ids) {
      this.locks.set(oid, { userId, name: user.name, color: user.color });
      const o = this.objects.get(oid); if (!o) continue;
      const b = new THREE.BoxHelper(o, user.color); b.material.depthTest = false; this.overlay.add(b); this.lockBoxes.set(oid, b);
      if (this.selection.delete(oid)) { this._refreshSelectionBoxes(); this._refreshGizmo(); this.dispatchEvent(new Event('selection')); }
    }
  }
}

// ---------- helpers ----------
function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
function isChildOf(o, root) { for (let x = o; x; x = x.parent) if (x === root) return true; return false; }
function applyLightProps(light, p) {
  if (p.color) light.color.set(p.color);
  light.intensity = (p.intensity ?? 5000) / 1500;
  light.distance = (p.radius ?? 1000) / 100;
}
function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = color; g.beginPath(); g.roundRect(0, 8, 256, 48, 24); g.fill();
  g.fillStyle = '#111'; g.font = '700 30px Inter, Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text.slice(0, 14), 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(1.2, 0.3, 1); s.renderOrder = 21; s.userData.isLabel = true;
  return s;
}
export function logicVolume(it) {
  const color = LOGIC_COLORS[it.type] || '#ffffff';
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }));
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color }));
  g.add(m, e);
  const lbl = document.createElement('canvas'); lbl.width = 256; lbl.height = 64;
  const c = lbl.getContext('2d'); c.fillStyle = color; c.font = '700 34px Inter, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText((LOGIC_TYPES.find((t) => t.type === it.type)?.name || it.type).toUpperCase(), 128, 32);
  const t = new THREE.CanvasTexture(lbl); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.8, 0.2, 1); s.userData.isLabel = true; s.renderOrder = 8; g.add(s);
  return g;
}
function spawnMarker() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#4fd1ff', transparent: true, opacity: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 6, 14), mat); body.position.y = 0.9; g.add(body);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  arrow.rotation.z = -Math.PI / 2; arrow.position.set(0.75, 0.9, 0); g.add(arrow); // +X = UE forward at yaw 0
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), new THREE.MeshBasicMaterial({ color: '#4fd1ff', side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  return g;
}
