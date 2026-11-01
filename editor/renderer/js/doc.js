// Map document: single source of truth. Every change is an op (same shape the collab
// server uses), so undo/redo, collab sync and the 3D scene all stay in lockstep.
//   op = {o:'add', c, item} | {o:'set', c, id, patch} | {o:'del', c, id} | {o:'cfg', k, patch} | {o:'replace', map}
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function blankMap(name = 'Untitled Level', author = '') {
  const now = new Date().toISOString();
  return {
    format: 'etbrmap', version: 1,
    meta: { name, author, description: '', created: now, modified: now, collaborators: [], editor: 'ETBR Mapper 1.0.0' },
    settings: { spawn: { pos: [0, 0, 100], yaw: 0 }, offset: [0, 0, 200000], fog: { density: 0.02, color: '#c9b77a' }, light: { intensity: 3, color: '#fff3c4' }, killZ: -3000 },
    objects: [], logic: [],
  };
}

let idCounter = 0;
export function newId(prefix = 'o') {
  idCounter = (idCounter + 1) % 1e6;
  return prefix + '_' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
}

export class Doc {
  constructor() {
    this.map = blankMap();
    this.index = { objects: new Map(), logic: new Map() };
    this.undoStack = []; this.redoStack = [];
    this.listeners = new Set();
    this.dirty = false;
    this.sendHook = null; // set by collab: (ops) => void
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ops, source) { for (const fn of this.listeners) fn(ops, source); }

  load(map) {
    if (!map || map.format !== 'etbrmap') throw new Error('Not an .etbrmap file');
    map.objects = map.objects || []; map.logic = map.logic || [];
    map.meta = map.meta || {}; map.settings = Object.assign(blankMap().settings, map.settings || {});
    this.map = map; this.reindex();
    this.undoStack = []; this.redoStack = []; this.dirty = false;
    this.emit([{ o: 'replace', map }], 'load');
  }
  reindex() { for (const c of ['objects', 'logic']) { this.index[c] = new Map(); this.map[c].forEach((it) => this.index[c].set(it.id, it)); } }
  get(c, id) { return this.index[c].get(id); }
  all(c) { return this.map[c]; }

  // apply ops locally. record=true → undoable + broadcast to collaborators
  apply(ops, { record = true, source = 'local', label = '' } = {}) {
    if (!ops.length) return;
    const inverse = [];
    for (const op of ops) {
      const inv = this._apply(op);
      if (inv) inverse.unshift(inv);
    }
    this.dirty = true;
    this.map.meta.modified = new Date().toISOString();
    if (record) {
      this.undoStack.push({ ops: clone(ops), inverse, label });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
    }
    if (source === 'local' && this.sendHook) this.sendHook(ops);
    this.emit(ops, source);
  }

  _apply(op) {
    const c = op.c === 'logic' ? 'logic' : 'objects';
    switch (op.o) {
      case 'add': {
        if (this.index[c].has(op.item.id)) return null;
        const it = clone(op.item);
        this.map[c].push(it); this.index[c].set(it.id, it);
        return { o: 'del', c, id: it.id };
      }
      case 'set': {
        const it = this.index[c].get(op.id); if (!it) return null;
        const old = {};
        for (const k of Object.keys(op.patch)) old[k] = clone(it[k]);
        Object.assign(it, clone(op.patch));
        return { o: 'set', c, id: op.id, patch: old };
      }
      case 'del': {
        const it = this.index[c].get(op.id); if (!it) return null;
        const i = this.map[c].indexOf(it);
        this.map[c].splice(i, 1); this.index[c].delete(op.id);
        return { o: 'add', c, item: it };
      }
      case 'cfg': {
        const k = op.k === 'meta' ? 'meta' : 'settings';
        const old = {};
        for (const key of Object.keys(op.patch)) old[key] = clone(this.map[k][key]);
        Object.assign(this.map[k], clone(op.patch));
        return { o: 'cfg', k, patch: old };
      }
      case 'replace': {
        const prev = this.map;
        this.map = clone(op.map); this.reindex();
        return { o: 'replace', map: prev };
      }
    }
    return null;
  }

  undo() {
    const e = this.undoStack.pop(); if (!e) return false;
    this.apply(e.inverse, { record: false });
    this.redoStack.push(e); return true;
  }
  redo() {
    const e = this.redoStack.pop(); if (!e) return false;
    const inverse = [];
    for (const op of e.ops) { const inv = this._apply(op); if (inv) inverse.unshift(inv); }
    e.inverse = inverse; this.undoStack.push(e);
    if (this.sendHook) this.sendHook(e.ops);
    this.emit(e.ops, 'local');
    return true;
  }

  serialize() {
    const m = clone(this.map);
    m.meta.modified = new Date().toISOString();
    return JSON.stringify(m, null, 1);
  }
}
