// First-run coach marks: spotlight one part of the UI at a time.
const STEPS = [
  { sel: '#palette', title: '1 · Grab something', text: 'This is every object in Escape the Backrooms. “Level Kits” groups pieces by the level that uses them — Level 0 is selected. Click any object…', side: 'right' },
  { sel: '#viewport', title: '2 · Place it', text: '…then click in the world to drop it. Keep clicking to place more. Press R to turn it, Esc when you\'re done.', side: 'center' },
  { sel: '#viewport', title: '3 · Fly around', text: 'Hold the RIGHT mouse button and use W A S D to fly (Q/E down/up). Scroll to zoom toward the mouse. Press F to jump to what you selected.', side: 'center' },
  { sel: '#tools', title: '4 · Move, turn, resize', text: 'Click an object, then drag the coloured arrows. W = move, E = rotate, R = scale. Snapping keeps everything lined up — G toggles it.', side: 'below' },
  { sel: '#tools [data-tool=room]', title: '5 · Build rooms in one drag', text: 'The Room tool (B) builds floor, walls, ceiling and lights from the real Level 0 pieces. Drag a rectangle — done. Ctrl+Z if you don\'t like it.', side: 'below' },
  { sel: '#pal-cats', title: '6 · Make it a level', text: 'Open “Logic” to place the Player Spawn, an Exit Zone, checkpoints and death zones. Entities & Items have the monsters and almond water.', side: 'right' },
  { sel: '#btn-collab', title: '7 · Build with friends', text: 'Start a live session and send the 6-letter code — you\'ll see each other\'s cursors and edits instantly.', side: 'below' },
  { sel: '[data-act=play]', title: '8 · Play it!', text: 'Click Play in game to install your level, then press F7 in Escape the Backrooms. Export .etbrmap to send the file to anyone.', side: 'below' },
];

export class Tutorial {
  constructor(app) { this.app = app; }
  start() {
    this.stop(); this.i = 0;
    this.ring = document.createElement('div'); this.ring.className = 'tut-ring';
    this.card = document.createElement('div'); this.card.className = 'tut-card';
    document.body.append(this.ring, this.card);
    this.onResize = () => this.show(); window.addEventListener('resize', this.onResize);
    this.show();
  }
  stop() { this.ring?.remove(); this.card?.remove(); this.ring = this.card = null; window.removeEventListener('resize', this.onResize); }
  finish() {
    this.stop();
    this.app.settings.tutorialDone = true; window.etbr.settings.set({ tutorialDone: true });
    this.app.toast('You\'re ready. Press ? any time for shortcuts.');
  }
  show() {
    const s = STEPS[this.i]; if (!s) return this.finish();
    const el = document.querySelector(s.sel); if (!el) { this.i++; return this.show(); }
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(this.ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    this.card.innerHTML = `<h3>${s.title}</h3><p>${s.text}</p><div class="row"><button class="ghost small" data-k="skip">Skip tutorial</button><span class="muted small">${this.i + 1} / ${STEPS.length}</span><button class="primary" data-k="next">${this.i === STEPS.length - 1 ? 'Let\'s build!' : 'Next →'}</button></div>`;
    this.card.querySelector('[data-k=skip]').onclick = () => this.finish();
    this.card.querySelector('[data-k=next]').onclick = () => { this.i++; this.show(); };
    const cw = 330, ch = this.card.offsetHeight || 170;
    let x, y;
    if (s.side === 'right') { x = r.right + 18; y = r.top + 40; }
    else if (s.side === 'below') { x = r.left + r.width / 2 - cw / 2; y = r.bottom + 16; }
    else { x = r.left + r.width / 2 - cw / 2; y = r.top + r.height / 2 - ch / 2; }
    x = Math.max(12, Math.min(innerWidth - cw - 12, x)); y = Math.max(12, Math.min(innerHeight - ch - 12, y));
    Object.assign(this.card.style, { left: x + 'px', top: y + 'px' });
  }
}
