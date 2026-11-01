// ETBR Mapper — renderer entry: boot, panels, shortcuts, files, play-in-game.
import * as THREE from 'three';
import { Doc, blankMap, newId } from './doc.js';
import { Catalog, Thumbnailer, CATEGORIES, LEVEL_NAMES, LOGIC_TYPES } from './catalog.js';
import { Viewport } from './viewport.js';
import { Collab } from './collab.js';
import { Tutorial } from './tutorial.js';

const api = window.etbr;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (x, k = 100) => Math.round(x * k) / k;

class App {
  constructor() {
    this.doc = new Doc();
    this.catalog = new Catalog();
    this.filePath = null;
    this.cat = 'kits'; this.group = null; this.q = '';
    this.activeLayer = 'Default';
    this.hiddenLayers = new Set();
    this.clipboard = null;
  }

  // ================================================================ boot
  async boot() {
    this.settings = await api.settings.get();
    $('#st-name').value = this.settings.name || '';
    $('#st-color').value = this.settings.color || '#f2d45c';
    $('#st-name').onchange = () => this.saveWho();
    $('#st-color').onchange = () => this.saveWho();
    const st = await api.library.status();
    if (st.ok) return this.libraryReady(st.catalog);
    // first run: build the library from the player's own game files
    $('#boot-library').hidden = false;
    const gp = await api.game.detect();
    $('#game-path').textContent = gp || 'Not found — click Change… and pick the EscapeTheBackrooms folder';
    $('#btn-pick-game').onclick = async () => {
      const r = await api.game.pick();
      if (r?.error) return this.toast(r.error);
      if (r) $('#game-path').textContent = r;
    };
    $('#btn-build-lib').onclick = () => this.buildLibrary();
  }
  async buildLibrary(force) {
    $('#btn-build-lib').disabled = true; $('#lib-progress').hidden = false;
    api.library.onProgress(({ done, total, label }) => {
      $('#lib-progress .bar i').style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
      $('#lib-progress-label').textContent = `${label} — ${done.toLocaleString()} / ${total.toLocaleString()}`;
    });
    const r = await api.library.build(force);
    if (!r.ok) { $('#btn-build-lib').disabled = false; return this.modal('Library build failed', `<pre style="white-space:pre-wrap;max-height:300px;overflow:auto">${esc(r.error)}</pre>`); }
    const st = await api.library.status();
    this.libraryReady(st.catalog);
  }
  libraryReady(cat) {
    this.catalog.setData(cat);
    this.thumbs = new Thumbnailer(this.catalog);
    this.defaultKit();
    $('#boot-library').hidden = true; $('#boot-start').hidden = false;
    const rec = $('#recent'); rec.innerHTML = '';
    if (this.settings.recent?.length) rec.append(h('div', { class: 'muted small' }, 'Recent'));
    for (const p of this.settings.recent || []) rec.append(h('button', { onclick: () => this.startWith(() => this.openPath(p)) }, '📄 ' + p.split(/[\\/]/).pop() + '  ', h('span', { class: 'muted small' }, p)));
    const auto = localStorage.getItem('etbr.autosave');
    if (auto) rec.prepend(h('button', { onclick: () => this.startWith(() => this.loadText(auto, null)) }, '♻️ Recover last unsaved session'));
    if (this.settings.lastRoom) rec.append(h('button', { onclick: () => this.startWith(() => this.joinRoom(this.settings.lastRoom)) }, `🤝 Rejoin room ${this.settings.lastRoom}`));
    $('#st-new').onclick = () => this.startWith(() => this.newLevel(true));
    $('#st-open').onclick = () => this.startWith(() => this.open(), true);
    $('#st-join').onclick = () => this.startWith(() => this.joinDialog(), true);
  }
  saveWho() {
    const name = $('#st-name').value.trim().slice(0, 24), color = $('#st-color').value;
    Object.assign(this.settings, { name, color }); api.settings.set({ name, color });
  }
  async startWith(fn, keepIfCancel) {
    this.saveWho();
    if (!this.settings.name) { const n = 'Builder' + Math.floor(Math.random() * 900 + 100); this.settings.name = n; api.settings.set({ name: n }); }
    if (!this.viewport) this.initEditor();
    $('#boot').hidden = true; $('#app').hidden = false;
    this.viewport.resize();
    const ok = await fn();
    if (ok === false && keepIfCancel && !this.doc.map.objects.length) this.newLevel(true);
    if (!this.settings.tutorialDone) setTimeout(() => this.tutorial.start(), 400);
  }

  // ================================================================ editor
  initEditor() {
    this.viewport = new Viewport($('#viewport'), this);
    this.collab = new Collab(this);
    this.tutorial = new Tutorial(this);
    this.viewport.addEventListener('selection', () => { this.renderInspector(); this.renderOutlinerSel(); this.collab.sendSelection([...this.viewport.selection].filter((id) => id !== '__spawn')); this.status(); });
    this.viewport.addEventListener('scenechange', () => { this.status(); this.renderInspectorSoon(); this.renderOutlinerSoon(); this.applyLayerVisibility(); });
    this.viewport.addEventListener('dragmove', () => this.renderInspectorSoon());
    this.viewport.addEventListener('cursor', (e) => { const p = e.detail; $('#st-cursor').textContent = `⌖ ${r1(p.x, 10)}, ${r1(p.z, 10)}, ${r1(p.y, 10)} m`; });
    this.collab.addEventListener('change', () => { this.renderPeople(); this.status(); });
    this.collab.addEventListener('chat', (e) => this.addChat(e.detail));
    this.doc.on((ops, src) => { if (ops.some((o) => o.o === 'replace' || o.o === 'cfg')) { this.renderLevel(); $('#level-name').value = this.doc.map.meta.name || ''; } });

    // toolbar
    $$('#topbar [data-act]').forEach((b) => (b.onclick = () => this.act(b.dataset.act)));
    $$('#tools button').forEach((b) => (b.onclick = () => (b.dataset.tool === 'room' ? this.setMode('room') : (this.setMode('select'), this.setGizmo(b.dataset.gizmo)))));
    $('#snap-on').onchange = (e) => this.viewport.setSnap({ on: e.target.checked });
    $('#snap-grid').onchange = (e) => this.viewport.setSnap({ grid: +e.target.value });
    $('#level-name').onchange = (e) => this.doc.apply([{ o: 'cfg', k: 'meta', patch: { name: e.target.value.trim() || 'Untitled Level' } }], { label: 'Rename' });
    $$('#side-tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    // palette
    $('#pal-q').oninput = (e) => { this.q = e.target.value; this.renderPalette(); };
    this.renderCats();
    this.renderPalette();
    this.initShortcuts();
    api.app.onClosing(() => this.confirmClose());
    setInterval(() => { if (this.doc.dirty && this.doc.map.objects.length) try { localStorage.setItem('etbr.autosave', this.doc.serialize()); } catch {} }, 30000);
  }

  setMode(mode) {
    const vp = this.viewport;
    if (mode !== 'place') { vp.stopPlacing(); $$('.card.on').forEach((c) => c.classList.remove('on')); }
    vp.mode = mode === 'room' ? 'room' : mode === 'place' ? 'place' : 'select';
    vp._refreshGizmo();
    $$('#tools button').forEach((b) => b.classList.toggle('on', mode === 'room' ? b.dataset.tool === 'room' : mode === 'select' && b.dataset.gizmo === vp.gizmoMode));
    const banner = $('#mode-banner');
    banner.hidden = mode === 'select';
    if (mode === 'place') banner.textContent = `Placing: ${vp.placeLogic ? LOGIC_TYPES.find((t) => t.type === vp.placeLogic)?.name : vp.placeItem?.name} — click to place · R rotate · Shift+wheel fine rotate · Esc done`;
    if (mode === 'room') banner.textContent = 'Room builder — drag a rectangle on the floor · Esc to stop';
    $('#room-panel').hidden = mode !== 'room';
    if (mode === 'room') this.renderRoomPanel();
  }
  setGizmo(m) { this.viewport.setGizmoMode(m); this.setMode('select'); }

  // ================================================================ files
  async confirmDiscard() {
    if (!this.doc.dirty || !this.doc.map.objects.length || this.collab?.connected) return true;
    return new Promise((res) => this.modal('Unsaved changes', '<p>Save your level first?</p>', [
      { label: 'Cancel', onclick: () => res(false) },
      { label: 'Discard', class: 'danger', onclick: () => res(true) },
      { label: 'Save', class: 'primary', onclick: async () => res(!!(await this.save())) },
    ]));
  }
  async newLevel(skipConfirm) {
    if (!skipConfirm && !(await this.confirmDiscard())) return false;
    this.collab?.leave();
    this.filePath = null;
    this.doc.load(blankMap('Untitled Level', this.settings.name));
    this.viewport.camera.position.set(10, 8, 12); this.viewport.camYaw = Math.atan2(-10, -12); this.viewport.camPitch = -0.45; this.viewport._applyCamRot();
    return true;
  }
  async open() {
    if (!(await this.confirmDiscard())) return false;
    const r = await api.file.open(); if (!r) return false;
    return this.loadText(r.text, r.path);
  }
  async openPath(p) { try { const r = await api.file.openPath(p); return this.loadText(r.text, r.path); } catch (e) { this.toast('Could not open ' + p); return false; } }
  loadText(text, path) {
    try {
      const m = JSON.parse(text);
      this.collab?.leave();
      this.doc.load(m); this.filePath = path;
      setTimeout(() => this.viewport.focusSelection(), 300);
      this.toast(`Opened “${m.meta?.name || 'level'}” — ${m.objects.length} objects`);
      return true;
    } catch (e) { this.modal('Could not open', `<p>${esc(e.message)}</p>`); return false; }
  }
  async save(saveAs) {
    const p = await api.file.save({ path: this.filePath, text: this.doc.serialize(), name: this.doc.map.meta.name, saveAs });
    if (!p) return null;
    this.filePath = p; this.doc.dirty = false; localStorage.removeItem('etbr.autosave');
    this.toast('💾 Saved ' + p.split(/[\\/]/).pop());
    return p;
  }
  async confirmClose() {
    if (await this.confirmDiscard()) { this.collab?.leave(true); api.app.quit(); }
  }

  // ================================================================ actions
  act(a) {
    const vp = this.viewport;
    switch (a) {
      case 'new': return this.newLevel();
      case 'open': return this.open();
      case 'save': return this.save();
      case 'export': return this.save(true);
      case 'undo': if (!this.doc.undo()) this.toast('Nothing to undo'); return;
      case 'redo': if (!this.doc.redo()) this.toast('Nothing to redo'); return;
      case 'lighting': { const m = vp.lighting === 'bright' ? 'game' : 'bright'; vp.setLighting(m); $('#btn-lighting').textContent = m === 'bright' ? '☀ Bright' : '🌙 Game-like'; return; }
      case 'collab': return this.tab('people');
      case 'play': return this.playInGame();
      case 'help': return this.help();
    }
  }
  selectedItems() {
    const out = [];
    for (const id of this.viewport.selection) {
      if (id === '__spawn') continue;
      const o = this.doc.get('objects', id); if (o) { out.push({ c: 'objects', it: o }); continue; }
      const l = this.doc.get('logic', id); if (l) out.push({ c: 'logic', it: l });
    }
    return out;
  }
  deleteSelected() {
    const sel = this.selectedItems(); if (!sel.length) return;
    this.doc.apply(sel.map(({ c, it }) => ({ o: 'del', c, id: it.id })), { label: 'Delete' });
    this.viewport.clearSelection();
    this.toast(`Deleted ${sel.length} — Ctrl+Z to undo`);
  }
  duplicateSelected(offset = true) {
    const sel = this.selectedItems(); if (!sel.length) return;
    const step = (this.viewport.snap.on ? this.viewport.snap.grid : 1) * 100;
    const ops = [], ids = [];
    for (const { c, it } of sel) {
      const n = JSON.parse(JSON.stringify(it)); n.id = newId(c === 'logic' ? 'l' : 'o'); ids.push(n.id);
      if (offset) n.pos = [n.pos[0] + step, n.pos[1], n.pos[2]];
      ops.push({ o: 'add', c, item: n });
    }
    this.doc.apply(ops, { label: 'Duplicate' });
    this.viewport.select(ids);
  }
  copy() { const sel = this.selectedItems(); if (sel.length) { this.clipboard = JSON.parse(JSON.stringify(sel)); this.toast(`Copied ${sel.length}`); } }
  paste() {
    if (!this.clipboard?.length) return;
    const at = this.viewport.cursorPoint;
    const first = this.clipboard[0].it.pos;
    const ops = [], ids = [];
    for (const { c, it } of this.clipboard) {
      const n = JSON.parse(JSON.stringify(it)); n.id = newId(c === 'logic' ? 'l' : 'o'); ids.push(n.id);
      if (at) n.pos = [Math.round(at.x * 100) + (it.pos[0] - first[0]), Math.round(at.z * 100) + (it.pos[1] - first[1]), it.pos[2]];
      ops.push({ o: 'add', c, item: n });
    }
    this.doc.apply(ops, { label: 'Paste' }); this.viewport.select(ids);
  }
  nudgeWorkPlane(dir) {
    const vp = this.viewport, step = (this.roomKit?.height || 400) / 100;
    vp.workY = Math.round((vp.workY + dir * step) * 100) / 100;
    vp.grid.position.y = vp.workY;
    this.toast(`Building on floor ${Math.round(vp.workY / step)} (height ${vp.workY} m)`);
    this.status();
  }

  // ================================================================ shortcuts
  initShortcuts() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { if (e.key === 'Escape') t.blur(); return; }
      if (this.viewport.fly.active) return; // WASD belongs to the fly camera
      if ($('.modal-bg') && e.key !== 'Escape') return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      const vp = this.viewport;
      if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); return this.act('undo'); }
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); return this.act('redo'); }
      if (ctrl && k === 's') { e.preventDefault(); return this.save(e.shiftKey); }
      if (ctrl && k === 'o') { e.preventDefault(); return this.open(); }
      if (ctrl && k === 'n') { e.preventDefault(); return this.newLevel(); }
      if (ctrl && k === 'p') { e.preventDefault(); return this.playInGame(); }
      if (ctrl && k === 'd') { e.preventDefault(); return this.duplicateSelected(); }
      if (ctrl && k === 'c') return this.copy();
      if (ctrl && k === 'v') return this.paste();
      if (ctrl && k === 'a') { e.preventDefault(); return vp.selectAll(); }
      if (ctrl && k === 'f') { e.preventDefault(); return $('#pal-q').focus(); }
      if (ctrl) return;
      if (k === 'escape') { $('.modal-bg')?.remove(); if (vp.mode !== 'select') return this.setMode('select'); return vp.clearSelection(); }
      if (k === 'delete' || k === 'backspace') return this.deleteSelected();
      if (vp.mode === 'place' && k === 'r') return vp.rotateGhost(e.shiftKey ? -90 : 90);
      if (k === 'w') return this.setGizmo('translate');
      if (k === 'e') return this.setGizmo('rotate');
      if (k === 'r') return this.setGizmo('scale');
      if (k === 'b') return this.setMode(vp.mode === 'room' ? 'select' : 'room');
      if (k === 'f') return vp.focusSelection();
      if (k === 'g') { const c = $('#snap-on'); c.checked = !c.checked; vp.setSnap({ on: c.checked }); return this.toast('Snapping ' + (c.checked ? 'on' : 'off')); }
      if (k === 'x') return this.toast('Gizmo space: ' + vp.toggleSpace());
      if (k === 'l') return this.act('lighting');
      if (k === 'pageup') return this.nudgeWorkPlane(1);
      if (k === 'pagedown') return this.nudgeWorkPlane(-1);
      if (k === '?' || k === 'f1') { e.preventDefault(); return this.help(); }
      if (k === 'end') return this.dropToFloor();
    });
  }
  dropToFloor() {
    const ops = [];
    for (const { c, it } of this.selectedItems()) {
      const o = this.viewport.objects.get(it.id); if (!o) continue;
      const box = new THREE.Box3().setFromObject(o);
      const dz = Math.round((this.viewport.workY - box.min.y) * 100);
      if (dz) ops.push({ o: 'set', c, id: it.id, patch: { pos: [it.pos[0], it.pos[1], it.pos[2] + dz] } });
    }
    if (ops.length) this.doc.apply(ops, { label: 'Drop to floor' });
  }

  // ================================================================ palette
  renderCats() {
    const nav = $('#pal-cats'); nav.innerHTML = '';
    for (const c of CATEGORIES) nav.append(h('button', { class: this.cat === c.key ? 'on' : '', title: c.hint, onclick: () => { this.cat = c.key; this.group = null; this.q = ''; $('#pal-q').value = ''; this.renderCats(); this.renderPalette(); } }, h('span', {}, c.icon), c.name));
  }
  renderPalette() {
    const grid = $('#pal-grid'), groups = $('#pal-groups');
    grid.innerHTML = ''; groups.innerHTML = '';
    if (!this.q && (this.cat === 'kits' || this.cat === 'packs')) {
      const opts = this.cat === 'kits' ? this.catalog.levels : this.catalog.folders;
      if (!this.group || !opts.includes(this.group)) this.group = this.cat === 'kits' ? (opts.includes('Level0') ? 'Level0' : opts[0]) : opts[0];
      const sel = h('select', { onchange: (e) => { this.group = e.target.value; this.renderPalette(); } });
      for (const o of opts) {
        const n = this.cat === 'kits' ? this.catalog.items.filter((i) => i.kind === 'mesh' && i.levels?.includes(o)).length : this.catalog.items.filter((i) => i.kind === 'mesh' && i.folder === o).length;
        sel.append(h('option', { value: o, selected: o === this.group }, `${this.cat === 'kits' ? LEVEL_NAMES[o] || o : o}  (${n})`));
      }
      groups.append(sel);
    }
    if (!this.q && this.cat === 'logic') {
      for (const t of LOGIC_TYPES) grid.append(h('div', { class: 'card logic-card', onclick: (e) => this.pickLogic(t.type, e.currentTarget) }, h('i', { class: 'sw', style: `background:${t.color}` }), h('div', {}, h('b', {}, t.name), h('small', {}, t.desc))));
    }
    const list = this.catalog.query({ cat: this.cat, group: this.group, q: this.q });
    if (!list.length && this.cat !== 'logic') grid.append(h('div', { class: 'pal-empty' }, this.q ? `Nothing matches “${this.q}”` : 'Nothing here'));
    const LIMIT = 300;
    const render = (from) => {
      const io = this.cardObserver || (this.cardObserver = new IntersectionObserver((ents) => {
        for (const en of ents) if (en.isIntersecting) { const img = en.target; this.cardObserver.unobserve(img); this.thumbs.request(this.catalog.get(img.dataset.id), img); }
      }, { root: grid, rootMargin: '200px' }));
      for (const it of list.slice(from, from + LIMIT)) {
        const img = h('img', { 'data-id': it.id, alt: '' });
        const card = h('div', { class: 'card', title: `${it.name}\n${it.id}${it.levels ? '\nUsed in: ' + it.levels.map((l) => LEVEL_NAMES[l] || l).join(', ') : ''}`, onclick: (e) => this.pickItem(it, e.currentTarget) }, img, h('div', { class: 'nm' }, it.name));
        grid.append(card); io.observe(img);
      }
      if (list.length > from + LIMIT) { const more = h('button', { class: 'pal-empty', onclick: () => { more.remove(); render(from + LIMIT); } }, `Show more (${list.length - from - LIMIT} left)`); grid.append(more); }
    };
    render(0);
  }
  pickItem(it, card) {
    $$('.card.on').forEach((c) => c.classList.remove('on')); card?.classList.add('on');
    this.lastPicked = it;
    this.viewport.startPlacing(it); this.setMode('place');
    if (this.viewport.mode === 'room') this.renderRoomPanel();
  }
  pickLogic(type, card) {
    $$('.card.on').forEach((c) => c.classList.remove('on')); card?.classList.add('on');
    this.viewport.startPlacing(null, type); this.setMode('place');
  }

  // ================================================================ room builder
  defaultKit() {
    const find = (re, level) => this.catalog.items.find((i) => i.kind === 'mesh' && re.test(i.id) && (!level || i.levels?.includes(level)))?.id;
    const wall = find(/\/SM_Wall_2m\.SM_Wall_2m$/, 'Level0') || find(/SM_Wall_2m/);
    const wi = this.catalog.get(wall);
    this.roomKit = {
      name: 'Level 0 (yellow rooms)',
      floor: find(/\/SM_Floor_4m\.SM_Floor_4m$/, 'Level0') || find(/SM_Floor_4m/),
      ceiling: find(/\/SM_Ceiling_4m\.SM_Ceiling_4m$/, 'Level0') || find(/SM_Ceiling_4m/),
      wall,
      // the exact lamp actor Level 0 uses (fixture + its real light); falls back to the bare mesh
      light: this.catalog.items.find((i) => i.kind === 'actor' && /\/BP_Ceiling_2Light\.BP_Ceiling_2Light_C$/.test(i.id) && i.levels?.includes('Level0'))?.id || find(/SM_Ceiling_Light/),
      pointLight: false, lightEvery: 2, cell: 400, ceilingRoll: 180,
      height: wi?.bounds ? Math.round(wi.bounds.e[2] * 2) : 400,
    };
  }
  renderRoomPanel() {
    const p = $('#room-panel'), k = this.roomKit; p.innerHTML = '';
    const slot = (key, label) => {
      const it = this.catalog.get(k[key]);
      return h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' },
        h('span', { class: 'tag-chip', style: 'flex:1;overflow:hidden;text-overflow:ellipsis', title: k[key] || '' }, it ? it.name : '— none —'),
        h('button', { class: 'small', title: 'Use the object last clicked in the library', onclick: () => { if (!this.lastPicked || this.lastPicked.kind !== 'mesh') return this.toast('Click a mesh in the library first'); k[key] = this.lastPicked.id; if (key === 'wall' && this.lastPicked.bounds) k.height = Math.round(this.lastPicked.bounds.e[2] * 2); this.setMode('room'); } }, 'Use picked'),
        h('button', { class: 'small ghost', title: 'None', onclick: () => { k[key] = null; this.renderRoomPanel(); } }, '✕')));
    };
    p.append(h('h4', {}, '▣ Room builder'), h('p', { class: 'muted small', style: 'margin:0 0 10px' }, 'Drag a rectangle on the floor to build a whole room. PageUp/PageDown changes floor (storey).'),
      slot('floor', 'Floor'), slot('wall', 'Walls'), slot('ceiling', 'Ceiling'), slot('light', 'Lamp'),
      h('div', { class: 'field' }, h('span', {}, 'Height'), h('input', { type: 'number', value: k.height / 100, step: 0.25, onchange: (e) => (k.height = Math.max(50, +e.target.value * 100)) })),
      h('div', { class: 'field' }, h('span', {}, 'Tile'), h('input', { type: 'number', value: k.cell / 100, step: 0.5, onchange: (e) => (k.cell = Math.max(50, +e.target.value * 100)) })),
      h('div', { class: 'field' }, h('span', {}, 'Lights'), h('label', { class: 'row', style: 'align-items:center' }, h('input', { type: 'checkbox', checked: k.pointLight, onchange: (e) => (k.pointLight = e.target.checked) }), ' real light every', h('input', { type: 'number', value: k.lightEvery, min: 1, style: 'width:50px', onchange: (e) => (k.lightEvery = Math.max(1, +e.target.value)) }), 'tiles')),
      h('button', { class: 'small ghost', onclick: () => { this.defaultKit(); this.renderRoomPanel(); } }, '↺ Level 0 kit'));
  }

  // ================================================================ inspector
  renderInspectorSoon() { cancelAnimationFrame(this._insRaf); this._insRaf = requestAnimationFrame(() => this.renderInspector()); }
  renderInspector() {
    const el = $('#tab-inspector');
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't clobber typing
    el.innerHTML = '';
    const ids = [...this.viewport.selection];
    if (!ids.length) {
      el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🖱️'), 'Click something in the world to edit it.', h('br'), h('br'),
        h('span', { class: 'small' }, 'Or pick an object from the library on the left and click to place it.')));
      return;
    }
    if (ids.length === 1 && ids[0] === '__spawn') return this.inspectSpawn(el);
    const sel = this.selectedItems();
    if (sel.length > 1) {
      el.append(h('div', { class: 'insp-title' }, h('div', { class: 'ico' }, '🧩'), h('div', {}, h('b', {}, `${sel.length} things selected`), h('small', {}, 'Drag the gizmo to move them together'))),
        this.actionsRow(),
        h('div', { class: 'sec' }, h('h4', {}, 'Layer'), this.layerSelect((v) => this.doc.apply(sel.filter((s) => s.c === 'objects').map(({ it }) => ({ o: 'set', c: 'objects', id: it.id, patch: { layer: v } })), { label: 'Set layer' }))));
      return;
    }
    const { c, it } = sel[0] || {};
    if (!it) return;
    if (c === 'logic') return this.inspectLogic(el, it);
    const item = this.catalog.get(it.asset) || (it.kind === 'text' ? this.catalog.get('text') : null);
    const img = h('img');
    if (item) this.thumbs.request(item, img);
    el.append(h('div', { class: 'insp-title' }, img, h('div', {}, h('b', {}, item?.name || 'Missing asset'), h('small', {}, it.asset || it.kind))));
    if (item?.levels?.length) el.append(h('div', {}, ...item.levels.map((l) => h('span', { class: 'tag-chip' }, LEVEL_NAMES[l] || l))));
    if (item?.cat === 'entities') el.append(h('p', { class: 'small muted' }, '👁 Entity — the host spawns it in co-op. Its AI may need nav-mesh to chase properly.'));
    const set = (patch, label) => this.doc.apply([{ o: 'set', c, id: it.id, patch }], { label });
    el.append(
      this.vecField('Position', it.pos.map((v) => v / 100), 'm', (v) => set({ pos: v.map((x) => Math.round(x * 100)) }, 'Move'), 0.1),
      this.vecField('Rotation', it.rot, '°', (v) => set({ rot: v }, 'Rotate'), 5, ['Pitch', 'Yaw', 'Roll']),
      this.vecField('Scale', it.scale, '×', (v) => set({ scale: v.map((x) => x || 0.01) }, 'Scale'), 0.1),
      h('div', { class: 'field' }, h('span', {}, 'Layer'), this.layerSelect((v) => set({ layer: v }, 'Set layer'), it.layer)),
    );
    const props = it.props || {};
    const setProp = (k, v) => set({ props: { ...props, [k]: v } }, 'Edit ' + k);
    const sec = h('div', { class: 'sec' }, h('h4', {}, 'Properties'));
    let any = false;
    if (item?.builtin && /light/.test(item.builtin)) {
      any = true;
      sec.append(this.numField('Brightness', props.intensity ?? 5000, (v) => setProp('intensity', v), 250),
        this.numField('Range (m)', (props.radius ?? 1000) / 100, (v) => setProp('radius', v * 100), 1),
        h('div', { class: 'field' }, h('span', {}, 'Colour'), h('input', { type: 'color', value: props.color || '#fff3c4', onchange: (e) => setProp('color', e.target.value) })));
    }
    if (it.kind === 'text') {
      any = true;
      sec.append(h('div', { class: 'field' }, h('span', {}, 'Text'), h('input', { type: 'text', value: props.text || '', onchange: (e) => setProp('text', e.target.value) })),
        this.numField('Size', props.size ?? 40, (v) => setProp('size', v), 5),
        h('div', { class: 'field' }, h('span', {}, 'Colour'), h('input', { type: 'color', value: props.color || '#ffffff', onchange: (e) => setProp('color', e.target.value) })));
    }
    if (it.kind === 'mesh') {
      any = true;
      sec.append(h('label', { class: 'row', style: 'align-items:center' }, h('input', { type: 'checkbox', checked: !!props.noCollision, onchange: (e) => setProp('noCollision', e.target.checked) }), ' Walk through it (no collision)'));
    }
    if (any) el.append(sec);
    el.append(h('div', { class: 'sec' }, this.actionsRow()));
  }
  inspectLogic(el, it) {
    const t = LOGIC_TYPES.find((x) => x.type === it.type) || { name: it.type, color: '#fff' };
    const set = (patch, label) => this.doc.apply([{ o: 'set', c: 'logic', id: it.id, patch }], { label });
    el.append(h('div', { class: 'insp-title' }, h('div', { class: 'ico', style: `background:${t.color}33;color:${t.color}` }, '🎯'), h('div', {}, h('b', {}, t.name), h('small', {}, t.desc))));
    el.append(
      this.vecField('Position', it.pos.map((v) => v / 100), 'm', (v) => set({ pos: v.map((x) => Math.round(x * 100)) }, 'Move'), 0.1),
      this.vecField('Size', (it.size || [200, 200, 200]).map((v) => v / 100), 'm', (v) => set({ size: v.map((x) => Math.max(10, Math.round(x * 100))) }, 'Resize'), 0.5),
    );
    if (it.type === 'message' || it.type === 'exit') el.append(h('div', { class: 'field' }, h('span', {}, 'Text'), h('input', { type: 'text', value: it.text || '', onchange: (e) => set({ text: e.target.value }, 'Edit text') })));
    if (it.type === 'exit') {
      const dl = h('datalist', { id: 'lvl-list' }, ...this.catalog.levels.map((l) => h('option', { value: l }, LEVEL_NAMES[l] || l)));
      el.append(dl, h('div', { class: 'field' }, h('span', {}, 'Then go to'), h('input', { type: 'text', list: 'lvl-list', placeholder: '(stay — just show text)', value: it.next || '', onchange: (e) => set({ next: e.target.value.trim() }, 'Exit target') })),
        h('p', { class: 'small muted' }, 'Optional: name of a real game level (e.g. Level0, Poolrooms). The host sends everyone there.'));
    }
    if (it.type === 'entityspawn') this.inspectSpawnGroup(el, it, set);
    if (it.type === 'teleport') {
      el.append(this.vecField('Target', (it.to || it.pos).map((v) => v / 100), 'm', (v) => set({ to: v.map((x) => Math.round(x * 100)) }, 'Teleport target'), 0.5),
        h('button', { class: 'small', onclick: () => { const p = this.viewport.cursorPoint; if (p) set({ to: [Math.round(p.x * 100), Math.round(p.z * 100), Math.round(p.y * 100) + 100] }, 'Teleport target'); } }, '⌖ Set target to last mouse point'));
    }
    el.append(h('div', { class: 'sec' }, this.actionsRow()));
  }
  defaultSpawnGroup() {
    const ents = this.catalog.items.filter((i) => i.cat === 'entities');
    const hound = ents.find((i) => /BP_Hound\.BP_Hound_C$/.test(i.id)) || ents[0];
    return { entity: hound?.id || '', min: 20, max: 50, maxAlive: 2, startDelay: 10 };
  }
  inspectSpawnGroup(el, it, set) {
    const groups = this.doc.map.settings.spawnGroups || {};
    const g = it.group || 'Group 1';
    const G = { ...this.defaultSpawnGroup(), ...(groups[g] || {}) };
    const setG = (patch) => this.doc.apply([{ o: 'cfg', k: 'settings', patch: { spawnGroups: { ...groups, [g]: { ...G, ...patch } } } }], { label: 'Edit spawn group' });
    const areas = this.doc.map.logic.filter((l) => l.type === 'entityspawn' && (l.group || 'Group 1') === g).length;
    const gsel = h('select', { onchange: async (e) => {
      let v = e.target.value;
      if (v === '__new') { v = await this.askText('New spawn group', 'Areas in the same group share one timer — an entity appears in ONE of them at a time.'); if (!v) return this.renderInspector(); }
      this.lastSpawnGroup = v;
      const ops = [{ o: 'set', c: 'logic', id: it.id, patch: { group: v } }];
      if (!groups[v]) ops.push({ o: 'cfg', k: 'settings', patch: { spawnGroups: { ...groups, [v]: { ...G } } } });
      this.doc.apply(ops, { label: 'Set spawn group' });
    } });
    for (const name of [...new Set([g, ...Object.keys(groups)])]) gsel.append(h('option', { value: name, selected: name === g }, name));
    gsel.append(h('option', { value: '__new' }, '+ New group…'));
    const ents = this.catalog.items.filter((i) => i.cat === 'entities').sort((a, b) => a.name.localeCompare(b.name));
    const esel = h('select', { onchange: (e) => setG({ entity: e.target.value }) });
    for (const e of ents) esel.append(h('option', { value: e.id, selected: e.id === G.entity }, e.name));
    el.append(h('div', { class: 'sec' }, h('h4', {}, '👁 Spawn group'),
      h('div', { class: 'field' }, h('span', {}, 'Group'), gsel),
      h('p', { class: 'small muted', style: 'margin-top:-2px' }, `${areas} area${areas === 1 ? '' : 's'} in this group. Each spawn picks one of them at random, then a random spot inside it.`),
      h('div', { class: 'field' }, h('span', {}, 'Entity'), esel),
      h('div', { class: 'field' }, h('span', {}, 'Every'), h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:center' },
        h('input', { type: 'number', min: 1, value: G.min, style: 'width:64px', onchange: (e) => setG({ min: Math.max(1, +e.target.value), max: Math.max(+e.target.value, G.max) }) }), '–',
        h('input', { type: 'number', min: 1, value: G.max, style: 'width:64px', onchange: (e) => setG({ max: Math.max(+e.target.value, G.min) }) }), 'seconds')),
      this.numField('Max alive', G.maxAlive, (v) => setG({ maxAlive: Math.max(1, Math.round(v)) }), 1),
      this.numField('First after (s)', G.startDelay, (v) => setG({ startDelay: Math.max(0, v) }), 5),
      h('p', { class: 'small muted' }, 'Only the host spawns entities; everyone in the lobby sees them.')));
  }
  inspectSpawn(el) {
    const sp = this.doc.map.settings.spawn;
    const set = (patch) => this.doc.apply([{ o: 'cfg', k: 'settings', patch: { spawn: { ...sp, ...patch } } }], { label: 'Move spawn' });
    el.append(h('div', { class: 'insp-title' }, h('div', { class: 'ico', style: 'color:#4fd1ff' }, '🧍'), h('div', {}, h('b', {}, 'Player Spawn'), h('small', {}, 'Everyone starts here. The arrow is the way they face.'))),
      this.vecField('Position', sp.pos.map((v) => v / 100), 'm', (v) => set({ pos: v.map((x) => Math.round(x * 100)) }), 0.1),
      this.numField('Facing (°)', sp.yaw || 0, (v) => set({ yaw: v }), 15));
  }
  actionsRow() {
    return h('div', { class: 'row' },
      h('button', { onclick: () => this.duplicateSelected(), title: 'Ctrl+D' }, '⧉ Duplicate'),
      h('button', { onclick: () => this.viewport.focusSelection(), title: 'F' }, '🎯 Focus'),
      h('button', { onclick: () => this.dropToFloor(), title: 'End' }, '⤓ Drop to floor'),
      h('button', { class: 'danger', onclick: () => this.deleteSelected(), title: 'Delete' }, '🗑 Delete'));
  }
  vecField(label, vals, unit, onchange, step, names) {
    const inputs = vals.map((v, i) => h('input', { type: 'number', step, value: r1(v), title: names ? names[i] : ['X (forward)', 'Y (right)', 'Z (up)'][i] }));
    const fire = () => onchange(inputs.map((x) => +x.value || 0));
    inputs.forEach((x) => { x.onchange = fire; x.onkeydown = (e) => { if (e.key === 'Enter') x.blur(); }; });
    return h('div', { class: 'field' }, h('span', {}, `${label} ${unit ? '(' + unit + ')' : ''}`), h('div', { class: 'vec' }, inputs));
  }
  numField(label, v, onchange, step = 1) {
    const i = h('input', { type: 'number', step, value: r1(v) }); i.onchange = () => onchange(+i.value || 0);
    return h('div', { class: 'field' }, h('span', {}, label), i);
  }
  layers() { return [...new Set(['Default', ...this.doc.map.objects.map((o) => o.layer || 'Default'), this.activeLayer])]; }
  layerSelect(onchange, value) {
    const s = h('select', { onchange: async (e) => {
      if (e.target.value !== '__new') return onchange(e.target.value);
      e.target.value = value || 'Default';
      const n = await this.askText('New layer', 'Name it after a part of your level, e.g. “Upstairs” or “Pool area”.');
      if (n) { this.activeLayer = n; onchange(n); }
    } });
    for (const l of this.layers()) s.append(h('option', { value: l, selected: l === (value || 'Default') }, l));
    s.append(h('option', { value: '__new' }, '+ New layer…'));
    return s;
  }

  // ================================================================ outliner
  renderOutlinerSoon() { clearTimeout(this._olT); this._olT = setTimeout(() => this.renderOutliner(), 150); }
  renderOutliner() {
    const el = $('#tab-outliner'); if (el.hidden) return;
    const keepQ = $('#ol-q')?.value || '';
    el.innerHTML = '';
    const q = h('input', { id: 'ol-q', placeholder: 'Filter…', value: keepQ, style: 'width:100%;margin-bottom:8px', oninput: () => this.renderOutliner() });
    el.append(q);
    const f = keepQ.toLowerCase();
    // layers
    const lay = h('div', { class: 'sec', style: 'margin-top:0;border-top:none;padding-top:0' }, h('h4', {}, 'Layers'));
    for (const l of this.layers()) {
      const n = this.doc.map.objects.filter((o) => (o.layer || 'Default') === l).length;
      lay.append(h('div', { class: 'ol-item' + (l === this.activeLayer ? ' on' : ''), onclick: () => { this.activeLayer = l; this.renderOutliner(); } },
        h('span', { title: 'Show/hide', onclick: (e) => { e.stopPropagation(); this.hiddenLayers.has(l) ? this.hiddenLayers.delete(l) : this.hiddenLayers.add(l); this.applyLayerVisibility(); this.renderOutliner(); } }, this.hiddenLayers.has(l) ? '🙈' : '👁'),
        l, h('span', { class: 'lk muted' }, `${n}${l === this.activeLayer ? ' · active' : ''}`)));
    }
    el.append(lay);
    const list = h('div', { class: 'sec' }, h('h4', {}, 'Objects'));
    const rows = [{ id: '__spawn', name: '🧍 Player Spawn' }];
    for (const l of this.doc.map.logic) rows.push({ id: l.id, name: '🎯 ' + (LOGIC_TYPES.find((t) => t.type === l.type)?.name || l.type) });
    for (const o of this.doc.map.objects) rows.push({ id: o.id, name: (this.catalog.get(o.asset)?.name || (o.kind === 'text' ? 'Text: ' + (o.props?.text || '') : o.asset)), layer: o.layer });
    const shown = rows.filter((r) => !f || r.name.toLowerCase().includes(f));
    for (const r of shown.slice(0, 600)) {
      const lk = this.viewport.locks.get(r.id);
      list.append(h('div', { class: 'ol-item' + (this.viewport.selection.has(r.id) ? ' on' : ''), 'data-id': r.id, onclick: (e) => this.viewport.select([r.id], { add: e.shiftKey, toggle: e.ctrlKey }), ondblclick: () => this.viewport.focusSelection() }, r.name, lk ? h('span', { class: 'lk', style: `color:${lk.color}` }, '🔒 ' + lk.name) : null));
    }
    if (shown.length > 600) list.append(h('div', { class: 'muted small' }, `…and ${shown.length - 600} more (use the filter)`));
    el.append(list);
  }
  renderOutlinerSel() { $$('#tab-outliner .ol-item[data-id]').forEach((r) => r.classList.toggle('on', this.viewport.selection.has(r.dataset.id))); }
  applyLayerVisibility() {
    for (const o of this.doc.map.objects) { const obj = this.viewport.objects.get(o.id); if (obj) obj.visible = !this.hiddenLayers.has(o.layer || 'Default'); }
  }

  // ================================================================ level settings
  renderLevel() {
    const el = $('#tab-level'); el.innerHTML = '';
    const m = this.doc.map, s = m.settings;
    const meta = (patch) => this.doc.apply([{ o: 'cfg', k: 'meta', patch }], { label: 'Edit level info' });
    const cfg = (patch) => this.doc.apply([{ o: 'cfg', k: 'settings', patch }], { label: 'Edit level settings' });
    el.append(
      h('div', { class: 'field' }, h('span', {}, 'Name'), h('input', { type: 'text', value: m.meta.name || '', onchange: (e) => meta({ name: e.target.value }) })),
      h('div', { class: 'field' }, h('span', {}, 'Author'), h('input', { type: 'text', value: m.meta.author || '', onchange: (e) => meta({ author: e.target.value }) })),
      h('div', { class: 'field' }, h('span', {}, 'About'), h('textarea', { rows: 3, onchange: (e) => meta({ description: e.target.value }) }, m.meta.description || '')),
      h('div', { class: 'sec' }, h('h4', {}, 'In game'),
        this.numField('Build height (m)', (s.offset?.[2] ?? 200000) / 100, (v) => cfg({ offset: [s.offset?.[0] || 0, s.offset?.[1] || 0, Math.round(v * 100)] }), 100),
        h('p', { class: 'small muted', style: 'margin-top:-4px' }, 'Your level is built this high above whatever game level you load it from, so it never overlaps.'),
        this.numField('Fall death (m)', (s.killZ ?? -3000) / 100, (v) => cfg({ killZ: Math.round(v * 100) }), 5),
        h('p', { class: 'small muted', style: 'margin-top:-4px' }, 'Falling this far below your level respawns the player.')),
      h('div', { class: 'sec' }, h('h4', {}, 'Stats'),
        h('div', { class: 'muted' }, `${m.objects.length.toLocaleString()} objects · ${m.logic.length} logic zones · ${m.objects.filter((o) => o.asset?.includes('Light')).length} lights`),
        h('div', { class: 'muted small' }, 'Builders: ' + ([m.meta.author, ...(m.meta.collaborators || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'))),
      h('div', { class: 'sec' }, h('h4', {}, 'Share'),
        h('p', { class: 'small muted' }, 'Get a code friends can type in-game (etbr fetch CODE) to download this level — no file sending needed.'),
        h('button', { onclick: () => this.shareCode() }, '🔗 Get share code')),
    );
  }
  async shareCode() {
    try {
      this.toast('Uploading…');
      const r = await fetch(this.settings.serverUrl.replace(/\/$/, '') + '/api/share', { method: 'POST', body: this.doc.serialize() });
      const j = await r.json(); if (!j.code) throw new Error(j.error || 'failed');
      this.modal('Share code', `<div class="room-code">${j.code}</div><p>Friends with the ETBR loader installed: open the console in Escape the Backrooms and type<br><code>etbr fetch ${j.code}</code></p>`);
    } catch (e) { this.toast('Share failed: ' + e.message); }
  }

  // ================================================================ people / collab
  renderPeople() {
    const el = $('#tab-people'); el.innerHTML = '';
    const c = this.collab;
    $('#btn-collab').classList.toggle('live', c.connected);
    $('#btn-collab').textContent = c.connected ? `🟢 ${c.room}` : '🤝 Collab';
    $('#people-count').textContent = c.connected ? `(${c.users.size})` : '';
    if (!c.connected) {
      el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🤝'), h('b', {}, 'Build together, live'), h('p', { class: 'small' }, 'Start a session and send your friends the code. Everyone sees each other\'s cursors and changes instantly.')),
        h('button', { class: 'primary', style: 'width:100%;margin-bottom:8px', onclick: () => this.hostRoom() }, '▶ Start a live session'),
        h('button', { style: 'width:100%', onclick: () => this.joinDialog() }, '🔑 Join with a code'),
        h('p', { class: 'small muted', style: 'margin-top:14px' }, `You appear as `, h('b', { style: `color:${this.settings.color}` }, this.settings.name), '. Change it on the start screen.'));
      return;
    }
    el.append(h('div', { class: 'muted small' }, 'Room code — send this to friends'), h('div', { class: 'room-code', title: 'Click to copy', onclick: () => { navigator.clipboard.writeText(c.room); this.toast('Code copied'); } }, c.room));
    const ppl = h('div', { class: 'sec' }, h('h4', {}, `In this room (${c.users.size})`));
    for (const u of c.users.values()) ppl.append(h('div', { class: 'person' }, h('i', { class: 'dot', style: `background:${u.color}` }), u.name, u.id === c.you ? h('span', { class: 'muted small' }, ' (you)') : null));
    for (const g of c.gamePlayers.values()) ppl.append(h('div', { class: 'person' }, h('i', { class: 'dot', style: `background:${g.color}` }), '🎮 ' + g.name, h('span', { class: 'muted small' }, ' in game')));
    el.append(ppl);
    const chat = h('div', { class: 'chat', id: 'chat-log' });
    for (const m of this.chatLog || []) chat.append(this.chatRow(m));
    const input = h('input', { placeholder: 'Say something…', style: 'width:100%', onkeydown: (e) => { if (e.key === 'Enter') { c.chat(e.target.value); e.target.value = ''; } } });
    el.append(h('div', { class: 'sec' }, h('h4', {}, 'Chat'), chat, input), h('div', { class: 'sec' }, h('button', { class: 'danger', onclick: () => { c.leave(); this.toast('Left the session — your copy of the level stays open'); } }, 'Leave session')));
    chat.scrollTop = 1e9;
  }
  chatRow(m) { const u = this.collab.users.get(m.id); return h('div', { class: 'm' }, h('b', { style: `color:${u?.color || '#fff'}` }, m.name), m.text); }
  addChat(m) {
    (this.chatLog = this.chatLog || []).push(m); if (this.chatLog.length > 200) this.chatLog.shift();
    const log = $('#chat-log'); if (log) { log.append(this.chatRow(m)); log.scrollTop = 1e9; }
    if ($('#tab-people').hidden) this.toast(`💬 ${m.name}: ${m.text}`);
  }
  async hostRoom() {
    try { const code = await this.collab.create(); this.tab('people'); this.modal('You\'re live! 🎉', `<p>Send friends this code. They open ETBR Mapper → <b>Join a friend</b>.</p><div class="room-code">${code}</div>`); }
    catch (e) { this.modal('Could not start session', `<p>${esc(e.message)}</p>`); }
  }
  joinDialog() {
    return new Promise((res) => {
      const input = h('input', { maxlength: 6, placeholder: 'ABC123', style: 'font:700 26px Consolas,monospace;letter-spacing:6px;text-transform:uppercase;width:100%;text-align:center' });
      const go = async () => { const code = input.value.trim(); if (code.length !== 6) return this.toast('Codes are 6 letters/numbers'); close(); res(await this.joinRoom(code)); };
      input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      const close = this.modal('Join a friend', [h('p', {}, 'Type the 6-letter room code your friend sees in their People tab.'), input], [{ label: 'Cancel', onclick: () => res(false) }, { label: 'Join', class: 'primary', onclick: go, keep: true }]);
      setTimeout(() => input.focus(), 50);
    });
  }
  async joinRoom(code) {
    if (!(await this.confirmDiscard())) return false;
    try { await this.collab.join(code); this.filePath = null; this.tab('people'); setTimeout(() => this.viewport.focusSelection(), 400); return true; }
    catch (e) { this.modal('Could not join', `<p>${esc(e.message)}</p>`); return false; }
  }

  // ================================================================ test in the real game (live)
  async playInGame() {
    const name = (this.doc.map.meta.name || 'MyLevel').replace(/[^\w-]/g, '_');
    const inst = await api.game.installMap({ text: this.doc.serialize(), name }); // offline copy too
    if (!inst.ok) return this.modal('Can\'t test yet', `<p>${esc(inst.error)}</p><p>Run <b>ETBR-Mapper-Setup.exe</b> (the installer) once — it adds the loader mod to Escape the Backrooms.</p>`);
    // live testing needs a room: make a private one if we aren't collaborating yet
    if (!this.collab.connected) {
      try { await this.collab.create(); } catch (e) { return this.modal('Could not reach the live server', `<p>${esc(e.message)}</p><p>You can still test offline: in game press <span class="kbd">~</span> and type <code>etbr load ${esc(name)}</code></p>`); }
    }
    const live = await api.game.writeLive({ room: this.collab.room, server: this.settings.serverUrl, name: this.settings.name, color: this.settings.color });
    if (!live.ok) return this.modal('Can\'t test yet', `<p>${esc(live.error)}</p>`);
    const { running } = await api.game.launch();
    this.modal('🎮 Test in game', `
      <p>${running ? 'Escape the Backrooms is already running.' : 'Launching Escape the Backrooms through Steam…'}</p>
      <ol class="steps">
        <li>Start a game (any level — singleplayer or a co-op lobby you host).</li>
        <li>Press <span class="kbd">F7</span>. Your level builds and stays <b>live</b>: anything you or friends change here appears in the game within a second.</li>
        <li>Press <span class="kbd">F6</span> to go to the spawn. You'll show up as a 🎮 avatar in everyone's editor.</li>
      </ol>
      <p><b>Testing together:</b> friends join room <code>${esc(this.collab.room)}</code> in their editor, click <b>🎮 Test in game</b>, then join your Steam lobby and press <span class="kbd">F7</span>. The host's <span class="kbd">F6</span> brings everyone to the spawn.</p>
      <p class="small">F8 removes the level · <code>etbr tp</code> back to spawn · <code>etbr lowfx on</code> only if your PC lags.</p>`);
  }

  // ================================================================ misc UI
  tab(name) {
    $$('#side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    for (const t of ['inspector', 'outliner', 'level', 'people']) $('#tab-' + t).hidden = t !== name;
    if (name === 'outliner') this.renderOutliner();
    if (name === 'level') this.renderLevel();
    if (name === 'people') this.renderPeople();
    if (name === 'inspector') this.renderInspector();
  }
  status() {
    const vp = this.viewport;
    $('#st-objects').textContent = `${this.doc.map.objects.length.toLocaleString()} objects · ${this.doc.map.logic.length} zones${vp.workY ? ` · floor height ${vp.workY} m` : ''}`;
    $('#st-sel').textContent = vp.selection.size ? `${vp.selection.size} selected` : '';
    $('#st-collab').textContent = this.collab?.connected ? `🟢 Live · ${this.collab.users.size} in room ${this.collab.room}` : '';
  }
  toast(msg, ms = 2600) {
    const t = h('div', { class: 'toast' }, msg); $('#toasts').append(t);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }
  modal(title, body, actions = [{ label: 'OK', class: 'primary' }]) {
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
    const close = () => bg.remove();
    const content = typeof body === 'string' ? h('div', { html: body }) : h('div', {}, body);
    const acts = h('div', { class: 'actions' }, ...actions.map((a) => h('button', { class: a.class || '', onclick: () => { if (!a.keep) close(); a.onclick?.(); } }, a.label)));
    bg.append(h('div', { class: 'modal' }, h('h2', {}, title), content, acts));
    $('#modal-root').append(bg);
    return close;
  }
  askText(title, text) {
    return new Promise((res) => {
      const input = h('input', { style: 'width:100%' });
      const ok = () => { const v = input.value.trim(); close(); res(v || null); };
      input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      const close = this.modal(title, [h('p', {}, text), input], [{ label: 'Cancel', onclick: () => res(null) }, { label: 'OK', class: 'primary', onclick: ok, keep: true }]);
      setTimeout(() => input.focus(), 50);
    });
  }
  help() {
    this.modal('Help & shortcuts', `
      <div class="keys">
        <span class="kbd">Right mouse + WASD</span><span>Fly around (Q/E down/up, Shift fast, wheel = speed)</span>
        <span class="kbd">Wheel</span><span>Zoom toward the mouse</span>
        <span class="kbd">Middle drag</span><span>Pan</span>
        <span class="kbd">Alt + drag</span><span>Orbit around the selection</span>
        <span class="kbd">F</span><span>Focus on selection</span>
        <span class="kbd">Click / Shift / Ctrl</span><span>Select / add / toggle — drag on empty space to box-select</span>
        <span class="kbd">W E R</span><span>Move · Rotate · Scale gizmo</span>
        <span class="kbd">X</span><span>Gizmo world/local space</span>
        <span class="kbd">G</span><span>Snapping on/off</span>
        <span class="kbd">B</span><span>Room builder</span>
        <span class="kbd">R (placing)</span><span>Rotate the object 90°</span>
        <span class="kbd">Ctrl+D / C / V</span><span>Duplicate · Copy · Paste at mouse</span>
        <span class="kbd">Delete</span><span>Delete selection</span>
        <span class="kbd">End</span><span>Drop selection to the floor</span>
        <span class="kbd">PageUp / PageDown</span><span>Build on the next / previous storey</span>
        <span class="kbd">L</span><span>Bright ↔ game-like lighting preview</span>
        <span class="kbd">Ctrl+Z / Ctrl+Y</span><span>Undo · Redo</span>
        <span class="kbd">Ctrl+S / Ctrl+Shift+S</span><span>Save · Export .etbrmap</span>
      </div>`, [{ label: 'Replay tutorial', onclick: () => this.tutorial.start() }, { label: 'Close', class: 'primary' }]);
  }
}

const app = new App();
window.app = app; // handy for debugging from devtools
app.boot().catch((e) => { console.error(e); document.body.append(h('pre', { style: 'position:fixed;bottom:0;left:0;color:#f66;z-index:99' }, e.stack)); });
