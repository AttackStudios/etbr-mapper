// Cutscenes tab: fly the camera, "Add shot", set times + captions, preview in the viewport.
// Stored in settings.cutscenes so they save, sync to collaborators, and reach the game live.
import * as THREE from 'three';
import { threeToUePos, ueToThreePos } from './coords.js';
import { icon } from './icons.js';
import { newId } from './doc.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export class Cutscenes {
  constructor(app) { this.app = app; this.current = null; this.playing = null; }
  list() { return this.app.doc.map.settings.cutscenes || []; }
  save(list) { this.app.doc.apply([{ o: 'cfg', k: 'settings', patch: { cutscenes: list } }], { label: 'Edit cutscene' }); this.render(); }
  update(fn) {
    const list = JSON.parse(JSON.stringify(this.list()));
    const c = list.find((x) => x.id === this.current); if (!c) return;
    fn(c); c.keys.sort((a, b) => a.t - b.t);
    this.save(list);
  }
  // editor camera <-> stored Unreal shot (FOV stored in Unreal's horizontal degrees)
  shotFromCamera(t) {
    const vp = this.app.viewport;
    return { t, pos: threeToUePos(vp.camera.position), rot: [Math.round(vp.camPitch * R2D * 10) / 10, Math.round((-vp.camYaw * R2D - 90) * 10) / 10, 0], fov: 90 };
  }
  applyShot(pos, pitch, yaw) {
    const vp = this.app.viewport;
    ueToThreePos(pos, vp.camera.position);
    vp.camPitch = pitch * D2R; vp.camYaw = (-yaw - 90) * D2R; vp._applyCamRot();
  }

  render() {
    const el = document.getElementById('tab-cutscenes'); if (!el || el.hidden) return;
    const h = this.app.h;
    el.innerHTML = '';
    const list = this.list();
    if (!list.find((c) => c.id === this.current)) this.current = list[0]?.id || null;
    el.append(h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('button', { class: 'primary', onclick: () => {
        const id = newId('c');
        this.current = id;
        this.save([...this.list(), { id, name: 'Cutscene ' + (list.length + 1), trigger: 'zone', fadeIn: 0.5, fadeOut: 0.5, keys: [], captions: [] }]);
      } }, icon('plus', 14), ' New cutscene')));
    if (!list.length) {
      el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, icon('film', 34)), h('b', {}, 'Make a camera scene'),
        h('p', { class: 'small' }, 'Fly the camera to a spot, click Add shot, move, add another. The camera glides between your shots in game.')));
      return;
    }
    const sel = h('select', { style: 'width:100%;margin-bottom:8px', onchange: (e) => { this.current = e.target.value; this.render(); } },
      ...list.map((c) => h('option', { value: c.id, selected: c.id === this.current }, c.name)));
    el.append(sel);
    const c = list.find((x) => x.id === this.current);
    const num = (v, on, step = 0.5, min = 0) => { const i = h('input', { type: 'number', value: v, step, min }); i.onchange = () => on(Math.max(min, +i.value || 0)); return i; };
    const name = h('input', { type: 'text', value: c.name }); name.onchange = () => this.update((x) => (x.name = name.value.trim() || x.name));
    const trig = h('select', { onchange: (e) => this.update((x) => (x.trigger = e.target.value)) },
      h('option', { value: 'start', selected: c.trigger === 'start' }, 'When the level starts'),
      h('option', { value: 'zone', selected: c.trigger !== 'start' }, 'From a Cutscene Zone (Logic tab)'));
    el.append(
      h('div', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'field' }, h('span', {}, 'Plays'), trig),
      h('div', { class: 'field' }, h('span', {}, 'Fade in (s)'), num(c.fadeIn ?? 0, (v) => this.update((x) => (x.fadeIn = v)), 0.25)),
      h('div', { class: 'field' }, h('span', {}, 'Fade out (s)'), num(c.fadeOut ?? 0, (v) => this.update((x) => (x.fadeOut = v)), 0.25)),
      h('div', { class: 'row' },
        h('button', { onclick: () => this.update((x) => { const last = x.keys[x.keys.length - 1]; x.keys.push(this.shotFromCamera(last ? last.t + 3 : 0)); }) }, icon('film', 14), ' Add shot from camera'),
        h('button', { disabled: c.keys.length < 2, onclick: () => this.preview(c) }, icon('play', 14), ' Preview')));
    const shots = h('div', { class: 'sec' }, h('h4', {}, `Shots (${c.keys.length})`));
    if (!c.keys.length) shots.append(h('p', { class: 'small muted' }, 'Fly the camera (right mouse + WASD), then click Add shot. You need at least two.'));
    c.keys.forEach((k, i) => shots.append(h('div', { class: 'shot' }, h('b', {}, i + 1), num(k.t, (v) => this.update((x) => (x.keys[i].t = v)), 0.5),
      h('span', { class: 'muted small' }, 'seconds'),
      h('span', { class: 'row', style: 'flex-wrap:nowrap' },
        h('button', { class: 'small', title: 'Look through this shot', onclick: () => this.applyShot(k.pos, k.rot[0], k.rot[1]) }, icon('eye', 13)),
        h('button', { class: 'small', title: 'Replace with the current camera', onclick: () => this.update((x) => { x.keys[i] = this.shotFromCamera(k.t); }) }, icon('reset', 13)),
        h('button', { class: 'small danger', title: 'Delete shot', onclick: () => this.update((x) => x.keys.splice(i, 1)) }, icon('trash', 13))))));
    el.append(shots);
    const caps = h('div', { class: 'sec' }, h('h4', {}, 'Captions'));
    (c.captions || []).forEach((cp, i) => {
      const txt = h('input', { type: 'text', value: cp.text || '' }); txt.onchange = () => this.update((x) => (x.captions[i].text = txt.value));
      caps.append(h('div', { class: 'shot cap' }, num(cp.t || 0, (v) => this.update((x) => (x.captions[i].t = v)), 0.5), num(cp.dur || 3, (v) => this.update((x) => (x.captions[i].dur = v)), 0.5), txt,
        h('button', { class: 'small danger', onclick: () => this.update((x) => x.captions.splice(i, 1)) }, icon('close', 12))));
    });
    if ((c.captions || []).length) caps.prepend(h('div', { class: 'muted small' }, 'start (s) · length (s) · text'));
    caps.append(h('button', { class: 'small', onclick: () => this.update((x) => { x.captions = x.captions || []; const l = x.captions[x.captions.length - 1]; x.captions.push({ t: l ? l.t + l.dur : 0, dur: 3, text: 'Caption' }); }) }, icon('plus', 13), ' Add caption'));
    el.append(caps,
      h('div', { class: 'sec' }, h('button', { class: 'danger', onclick: () => this.save(this.list().filter((x) => x.id !== c.id)) }, icon('trash', 14), ' Delete cutscene')));
  }

  // viewport preview: same easing + timing as the in-game player
  preview(def) {
    if (this.playing) return this.stop();
    const vp = this.app.viewport;
    const keys = [...def.keys].sort((a, b) => a.t - b.t);
    const len = keys[keys.length - 1].t;
    const saved = { pos: vp.camera.position.clone(), yaw: vp.camYaw, pitch: vp.camPitch };
    const ov = document.getElementById('cut-overlay'), fade = document.getElementById('cut-fade'), capEl = document.getElementById('cut-caption');
    ov.hidden = false; vp.gizmo.detach();
    const start = performance.now();
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    const angle = (a, b, f) => a + ((((b - a + 540) % 360) + 360) % 360 - 180) * f;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.stop(); } };
    window.addEventListener('keydown', onKey, true);
    const frame = () => {
      if (!this.playing) return;
      const t = (performance.now() - start) / 1000;
      if (t >= len) return this.stop();
      let a = keys[0], b = keys[keys.length - 1];
      for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
      let f = Math.min(1, Math.max(0, (t - a.t) / Math.max(0.001, b.t - a.t))); f = f * f * (3 - 2 * f);
      ueToThreePos(a.pos, pa); ueToThreePos(b.pos, pb);
      vp.camera.position.lerpVectors(pa, pb, f);
      vp.camPitch = angle(a.rot[0], b.rot[0], f) * D2R; vp.camYaw = (-angle(a.rot[1], b.rot[1], f) - 90) * D2R; vp._applyCamRot();
      const cap = (def.captions || []).find((c) => t >= c.t && t < c.t + (c.dur || 3));
      capEl.textContent = cap ? cap.text : '';
      const fi = def.fadeIn || 0, fo = def.fadeOut || 0;
      fade.style.opacity = fi && t < fi ? 1 - t / fi : fo && t > len - fo ? (t - (len - fo)) / fo : 0;
      requestAnimationFrame(frame);
    };
    this.playing = { saved, onKey };
    this.app.toast('Previewing. Esc stops.', 2000);
    frame();
  }
  stop() {
    const p = this.playing; if (!p) return;
    this.playing = null;
    window.removeEventListener('keydown', p.onKey, true);
    const vp = this.app.viewport;
    document.getElementById('cut-overlay').hidden = true;
    document.getElementById('cut-fade').style.opacity = 0;
    vp.camera.position.copy(p.saved.pos); vp.camYaw = p.saved.yaw; vp.camPitch = p.saved.pitch; vp._applyCamRot();
    vp._refreshGizmo();
  }
}
