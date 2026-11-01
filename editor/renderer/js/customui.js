// CUSTOM tab + create/edit wizard for .etbrObject / .etbrEntity / .etbrItem
import * as THREE from 'three';
import { KINDS, defaultAsset, convertModel, assetPreview, newAssetId } from './custom.js';
import { icon } from './icons.js';

const api = window.etbr;
const SOUND_EXT = ['ogg', 'mp3', 'wav'];

export class CustomUI {
  constructor(app) { this.app = app; this.filter = 'all'; this.h = (...a) => app.h(...a); }

  // ---------------------------------------------------------------- library
  async loadLibrary() {
    const texts = await api.custom.list();
    let n = 0;
    for (const t of texts) { try { const a = JSON.parse(t); if (a.format === 'etbr-asset') { this.app.catalog.addCustom(a); n++; } } catch {} }
    return n;
  }
  async saveToLibrary(asset) {
    await api.custom.save(JSON.stringify(asset));
    this.app.catalog.addCustom(asset);
    // keep maps that already use it up to date (and collaborators via the asset op)
    if (this.app.doc.map.customAssets?.[asset.id]) this.app.doc.apply([{ o: 'asset', asset }], { record: false });
  }
  // every custom asset placed in a map travels inside the map (and to collaborators) exactly once
  ensureInMap(id) {
    const it = this.app.catalog.get(id);
    if (!it?.asset || this.app.doc.map.customAssets?.[id]) return;
    this.app.doc.apply([{ o: 'asset', asset: it.asset }], { record: false });
  }
  // a map (opened or joined) may carry custom assets we don't have yet: add them to the library
  async adoptMapAssets() {
    const ca = this.app.doc.map.customAssets || {};
    let added = 0;
    for (const a of Object.values(ca)) {
      if (!this.app.catalog.get(a.id)) { await api.custom.save(JSON.stringify(a)); this.app.catalog.addCustom(a); added++; }
    }
    if (added) { this.app.toast(`Added ${added} custom asset${added > 1 ? 's' : ''} from this level to your CUSTOM tab`); if (this.app.cat === 'custom') this.app.renderPalette(); }
  }
  async importFiles() {
    const files = await api.custom.import();
    let ok = 0;
    for (const f of files) {
      try {
        const a = JSON.parse(f.text);
        if (a.format !== 'etbr-asset' || !KINDS[a.kind]) throw new Error('not an ETBR custom asset');
        if (!/^[\w-]{4,64}$/.test(a.id)) a.id = newAssetId();
        await this.saveToLibrary(a); ok++;
      } catch (e) { this.app.toast(`Could not import ${f.path.split(/[\\/]/).pop()}: ${e.message}`); }
    }
    if (ok) { this.app.cat = 'custom'; this.app.renderCats(); this.app.renderPalette(); this.app.toast(`Imported ${ok} custom asset${ok > 1 ? 's' : ''}`); }
  }
  async exportAsset(asset) {
    const p = await api.custom.export(JSON.stringify(asset));
    if (p) this.app.toast('Exported ' + p.split(/[\\/]/).pop());
  }
  async removeAsset(asset) {
    const inMap = this.app.doc.map.objects.some((o) => o.asset === asset.id);
    await api.custom.remove(asset.id);
    this.app.catalog.removeCustom(asset.id);
    this.app.renderPalette();
    this.app.toast(inMap ? `Removed from your library (this level still contains its own copy)` : 'Removed from your library');
  }

  // palette header shown above the CUSTOM grid
  paletteHeader() {
    const h = this.h;
    const chip = (key, label) => h('button', { class: 'small' + (this.filter === key ? ' on' : ''), onclick: () => { this.filter = key; this.app.group = key; this.app.renderPalette(); } }, label);
    return h('div', { class: 'custom-head' },
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => this.importFiles(), title: 'Import .etbrObject / .etbrEntity / .etbrItem files' }, icon('import', 14), ' Import file'),
        h('button', { class: 'small primary', onclick: () => this.openWizard() }, icon('plus', 14), ' Create new')),
      h('div', { class: 'row', style: 'margin-top:6px' }, chip('all', 'All'), chip('object', 'Objects'), chip('entity', 'Entities'), chip('item', 'Items')));
  }

  // ---------------------------------------------------------------- wizard
  openWizard(existing) {
    const h = this.h;
    const asset = existing ? JSON.parse(JSON.stringify(existing)) : defaultAsset('object');
    let model = null; // loaded three model (only for a fresh model import)
    const st = { scale: 1, textureOverride: null, clipNames: Object.keys(asset.entity?.anims || {}) };

    const bg = h('div', { class: 'modal-bg' });
    const close = () => { cancelAnimationFrame(raf); renderer.dispose(); bg.remove(); };
    const body = h('div', { class: 'wiz-body' });
    const view = h('div', { class: 'wiz-view' });
    const stats = h('div', { class: 'muted small' }, 'No model yet');
    const modal = h('div', { class: 'modal wiz' },
      h('div', { class: 'wiz-top' }, h('h2', {}, existing ? 'Edit custom asset' : 'Create custom asset'), h('button', { class: 'ghost', onclick: close }, icon('close'))),
      h('div', { class: 'wiz-cols' }, body, h('div', { class: 'wiz-side' }, view, stats)),
      h('div', { class: 'actions' },
        h('button', { onclick: close }, 'Cancel'),
        h('button', { onclick: () => finish(true) }, icon('export', 14), ' Save + export file'),
        h('button', { class: 'primary', onclick: () => finish(false) }, icon('check', 14), ' Save to CUSTOM')));
    bg.append(modal); document.getElementById('modal-root').append(bg);

    // live preview
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(300, 300); renderer.outputColorSpace = THREE.SRGBColorSpace; view.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight('#fffbe8', '#4a4230', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5); sun.position.set(3, 5, 4); scene.add(sun);
    const grid = new THREE.GridHelper(4, 8, '#5a5238', '#3a3626'); scene.add(grid);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
    let preview = null, raf = 0, spin = 0;
    const refreshPreview = () => {
      if (preview) scene.remove(preview);
      preview = assetPreview(asset); scene.add(preview);
      const box = new THREE.Box3().setFromObject(preview);
      const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
      const r = Math.max(size.length() / 2, 0.3);
      cam.userData.r = r * 2.8; cam.userData.c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const tris = Object.values(asset.meshes || {}).reduce((n, m) => n + m.sections.reduce((k, s) => k + atob(s.i).length / 12, 0), 0);
      stats.textContent = box.isEmpty() ? 'No model yet' : `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m · ${Math.round(tris).toLocaleString()} triangles` + (tris > 60000 ? ' — heavy, consider simplifying' : '');
    };
    const loop = () => {
      raf = requestAnimationFrame(loop); spin += 0.006;
      const r = cam.userData.r || 3, c = cam.userData.c || new THREE.Vector3();
      cam.position.set(c.x + Math.sin(spin) * r, c.y + r * 0.45, c.z + Math.cos(spin) * r); cam.lookAt(c);
      renderer.render(scene, cam);
    };
    loop();

    const reconvert = () => {
      if (!model) return refreshPreview();
      const conv = convertModel(model, { kind: asset.kind, scale: st.scale, textureOverride: st.textureOverride });
      asset.meshes = conv.meshes; asset.textures = conv.textures;
      const first = Object.keys(conv.meshes)[0] || 'body';
      if (asset.kind === 'object') asset.object.mesh = first;
      if (asset.kind === 'item') { asset.item.ground.mesh = first; if (!asset.item.hand.custom) asset.item.hand.mesh = first; }
      if (asset.kind === 'entity') {
        asset.entity.parts = conv.parts; asset.entity.anims = conv.anims; st.clipNames = conv.clipNames;
        const guess = (re) => conv.clipNames.find((c) => re.test(c)) || '';
        asset.entity.map = { idle: guess(/idle|stand|breath/i), walk: guess(/walk/i), run: guess(/run|chase|sprint/i), attack: guess(/attack|kill|bite|hit/i) };
      }
      refreshPreview(); render();
    };

    // ----- form -----
    const field = (label, el, hint) => h('div', { class: 'field' }, h('span', {}, label), h('div', {}, el, hint ? h('div', { class: 'muted small' }, hint) : null));
    const num = (v, on, step = 1, min) => { const i = h('input', { type: 'number', value: v, step }); i.onchange = () => on(min != null ? Math.max(min, +i.value) : +i.value); return i; };
    const pickSound = async (slot) => {
      const [f] = await api.file.pickBytes({ title: 'Choose a sound', filters: [{ name: 'Sound', extensions: SOUND_EXT }] });
      if (!f) return;
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_');
      asset.sounds[name] = f.b64; slot(name); render();
    };

    const render = () => {
      body.innerHTML = '';
      // kind
      const kinds = h('div', { class: 'seg' }, ...Object.entries(KINDS).map(([k, d]) => h('button', {
        class: asset.kind === k ? 'on' : '', disabled: !!existing && asset.kind !== k,
        onclick: () => { if (asset.kind === k) return; const keep = { name: asset.name, description: asset.description, meshes: asset.meshes, textures: asset.textures, sounds: asset.sounds, id: asset.id }; Object.assign(asset, defaultAsset(k), keep); reconvert(); render(); },
      }, icon(d.icon, 16), ' ' + d.label)));
      body.append(kinds, h('p', { class: 'muted small', style: 'margin:6px 0 12px' }, KINDS[asset.kind].hint));
      const nameI = h('input', { type: 'text', value: asset.name }); nameI.oninput = () => (asset.name = nameI.value);
      const descI = h('textarea', { rows: 2 }, asset.description || ''); descI.oninput = () => (asset.description = descI.value);
      body.append(field('Name', nameI), field('About', descI));

      // model
      const modelBtn = h('button', { onclick: async () => {
        const [f] = await api.file.pickBytes({ title: 'Choose a 3D model', filters: [{ name: '3D model', extensions: ['glb', 'gltf', 'obj', 'fbx'] }] });
        if (!f) return;
        try {
          this.app.toast('Reading ' + f.name + '…');
          model = await (await import('./custom.js')).loadModelFile(f);
          // auto-scale silly sizes (FBX in centimetres etc.)
          const box = new THREE.Box3().setFromObject(model.scene); const sz = box.getSize(new THREE.Vector3()).length();
          st.scale = sz > 60 ? 0.01 : 1;
          if (asset.kind === 'entity' && sz * st.scale > 0) st.scale = Math.round((1.9 / (box.getSize(new THREE.Vector3()).y * st.scale)) * st.scale * 1000) / 1000;
          reconvert();
        } catch (e) { this.app.toast('Could not read that model: ' + e.message); }
      } }, icon('import', 14), ' Choose model (.glb .gltf .obj .fbx)');
      const texBtn = h('button', { class: 'small', onclick: async () => {
        const [f] = await api.file.pickBytes({ title: 'Texture for the whole model', filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }] });
        if (!f) return;
        st.textureOverride = await toPng(f); reconvert();
      } }, 'Use one texture for everything…');
      body.append(h('div', { class: 'sec' }, h('h4', {}, 'Model'), modelBtn, ' ', texBtn,
        model ? field('Scale', num(st.scale, (v) => { st.scale = v || 1; reconvert(); }, 0.05, 0.001), 'Multiplies the model size. The size is shown under the preview.') : null));

      // kind settings
      if (asset.kind === 'object') {
        const col = h('input', { type: 'checkbox', checked: asset.object.collision !== false }); col.onchange = () => (asset.object.collision = col.checked);
        body.append(h('div', { class: 'sec' }, h('h4', {}, 'Object'), h('label', { class: 'row', style: 'align-items:center' }, col, ' Solid (players collide with it)')));
      }
      if (asset.kind === 'entity') {
        const b = asset.entity.behavior;
        const mode = h('select', { onchange: (e) => (b.mode = e.target.value) },
          ...[['chase', 'Chase — hunts the nearest player it can see'], ['stalk', 'Stalk — only moves when nobody is looking at it'], ['wander', 'Wander — roams, chases when close'], ['static', 'Static — never moves (hazard / scare)']]
            .map(([v, l]) => h('option', { value: v, selected: b.mode === v }, l)));
        const kill = h('input', { type: 'checkbox', checked: b.kill }); kill.onchange = () => (b.kill = kill.checked);
        const animSel = (slot) => h('select', { onchange: (e) => (asset.entity.map[slot] = e.target.value) },
          h('option', { value: '' }, st.clipNames.length ? '(none)' : '(automatic bob)'), ...st.clipNames.map((c) => h('option', { value: c, selected: asset.entity.map?.[slot] === c }, c)));
        const snd = (slot) => h('span', { class: 'row', style: 'align-items:center;flex-wrap:nowrap' },
          h('span', { class: 'tag-chip' }, b.sounds[slot] || 'none'), h('button', { class: 'small', onclick: () => pickSound((n) => (b.sounds[slot] = n)) }, 'Choose…'));
        body.append(h('div', { class: 'sec' }, h('h4', {}, 'Behaviour'),
          field('Mode', mode),
          field('Walk speed', num(b.walkSpeed / 100, (v) => (b.walkSpeed = Math.round(v * 100)), 0.1, 0), 'metres per second (the player walks 3, sprints 6)'),
          field('Chase speed', num(b.runSpeed / 100, (v) => (b.runSpeed = Math.round(v * 100)), 0.1, 0)),
          field('Sees players within', num(b.sight / 100, (v) => (b.sight = Math.round(v * 100)), 1, 0), 'metres'),
          field('Kills', h('label', { class: 'row', style: 'align-items:center' }, kill, ' on touch, within', num(b.killRange / 100, (v) => (b.killRange = Math.round(v * 100)), 0.1, 0.2), 'm'))),
          h('div', { class: 'sec' }, h('h4', {}, 'Animations'),
            st.clipNames.length ? null : h('p', { class: 'muted small' }, 'No animations in this model, so it bobs and sways automatically. Rigid (non-skinned) glTF/FBX animation clips are supported.'),
            field('Idle', animSel('idle')), field('Walk', animSel('walk')), field('Chase', animSel('run')), field('Attack', animSel('attack'))),
          h('div', { class: 'sec' }, h('h4', {}, 'Sounds'), field('Idle loop', snd('idle')), field('Chasing', snd('chase')), field('Kill', snd('kill'))));
      }
      if (asset.kind === 'item') {
        const it = asset.item, u = it.use;
        const txt = h('input', { type: 'text', value: it.pickupText || '', placeholder: asset.name }); txt.oninput = () => (it.pickupText = txt.value);
        const type = h('select', { onchange: (e) => { u.type = e.target.value; render(); } },
          ...[['none', 'Nothing (just carry it)'], ['light', 'Light (flashlight / glowstick)'], ['sanity', 'Restore sanity'], ['stamina', 'Restore stamina'], ['script', 'Run the script\'s onUse']]
            .map(([v, l]) => h('option', { value: v, selected: u.type === v }, l)));
        const cons = h('input', { type: 'checkbox', checked: u.consume }); cons.onchange = () => (u.consume = cons.checked);
        const vec = (arr, on) => h('div', { class: 'vec' }, ...arr.map((v, i) => { const x = h('input', { type: 'number', value: v, step: 1 }); x.onchange = () => { arr[i] = +x.value; on && on(); }; return x; }));
        body.append(h('div', { class: 'sec' }, h('h4', {}, 'Item'),
          field('Pick-up name', txt, 'Shown as "E — pick up …"'),
          field('When used', type),
          u.type === 'light' ? field('Light', h('div', {}, num(u.light.intensity, (v) => (u.light.intensity = v), 250, 0), ' brightness  ', num(u.light.range / 100, (v) => (u.light.range = v * 100), 1, 1), ' m range')) : null,
          u.type === 'sanity' || u.type === 'stamina' ? field('Amount', num(u.amount, (v) => (u.amount = v), 5, 0)) : null,
          field('', h('label', { class: 'row', style: 'align-items:center' }, cons, ' Used up after one use')),
          field('In hand (cm)', vec(it.hand.pos), 'forward, right, up — relative to the camera')));
      }
      // script
      const code = h('textarea', { class: 'code', rows: 8, spellcheck: false }, asset.scripts['main.lua'] || '');
      code.oninput = () => (asset.scripts['main.lua'] = code.value);
      body.append(h('div', { class: 'sec' }, h('h4', {}, 'Script'), code,
        h('p', { class: 'muted small' }, 'Lua, sandboxed in game: no files, no programs. Helpers: etbr.message, etbr.sound, etbr.kill, etbr.sanity, etbr.after, etbr.nearestPlayer. Hooks: onSpawn, onTick, onSeePlayer, onTouch, onUse, onPickup.')));
    };

    const finish = async (alsoExport) => {
      if (!Object.keys(asset.meshes || {}).length) return this.app.toast('Choose a model first');
      asset.name = (asset.name || '').trim() || 'Custom ' + KINDS[asset.kind].label;
      asset.author = asset.author || this.app.settings.name || '';
      asset.icon = await this.app.thumbs.renderObject(assetPreview(asset));
      await this.saveToLibrary(asset);
      if (alsoExport) await this.exportAsset(asset);
      close();
      this.app.cat = 'custom'; this.app.renderCats(); this.app.renderPalette();
      this.app.toast(`Saved "${asset.name}" — find it in the CUSTOM tab`);
    };

    render(); refreshPreview();
  }
}

async function toPng(f) {
  if (f.ext === 'png') return f.b64;
  const img = new Image(); img.src = `data:image/${f.ext};base64,${f.b64}`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}
