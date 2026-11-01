// Real-time collaboration client (server: /server/index.js on Render).
const COLORS = ['#ff6b6b', '#4fd1ff', '#4ade80', '#facc15', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];

export class Collab extends EventTarget {
  constructor(app) {
    super();
    this.app = app; this.doc = app.doc; this.vp = app.viewport;
    this.ws = null; this.room = null; this.you = null; this.users = new Map();
    this.pending = [];
    this.lastCursor = 0;
    this.wantRoom = null;
  }
  get connected() { return this.ws && this.ws.readyState === 1 && !!this.room; }
  wsUrl() { return this.app.settings.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'; }
  me() { return { name: this.app.settings.name || 'Builder', color: this.app.settings.color || COLORS[Math.floor(Math.random() * COLORS.length)] }; }

  // host: start a room from the current map
  create() { return this._open({ t: 'create', ...this.me(), map: this.doc.map }); }
  join(code) { return this._open({ t: 'join', room: code.trim().toUpperCase(), ...this.me() }); }

  _open(hello) {
    this.leave(true);
    this.app.toast('Connecting… (the free server can take ~30 s to wake up)', 4000);
    return new Promise((resolve, reject) => {
      // wake the Render instance with a plain HTTP hit first; WS upgrades fail on a sleeping dyno
      fetch(this.app.settings.serverUrl.replace(/\/$/, '') + '/health').catch(() => {}).finally(() => {
        const ws = this.ws = new WebSocket(this.wsUrl());
        let settled = false;
        const to = setTimeout(() => { if (!settled) { settled = true; ws.close(); reject(new Error('Server did not answer — check your internet and try again.')); } }, 45000);
        ws.onopen = () => ws.send(JSON.stringify(hello));
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          if (!settled && msg.t === 'error') { settled = true; clearTimeout(to); reject(new Error(msg.msg)); ws.close(); return; }
          if (!settled && msg.t === 'welcome') { settled = true; clearTimeout(to); this._welcome(msg, hello); resolve(msg.room); return; }
          this._msg(msg);
        };
        ws.onclose = () => {
          if (!settled) { settled = true; clearTimeout(to); reject(new Error('Could not connect')); return; }
          if (this.room && this.wantRoom) this._reconnect();
        };
      });
    });
  }
  _welcome(msg, hello) {
    this.room = msg.room; this.you = msg.you; this.wantRoom = msg.room; this.hello = hello;
    this.users = new Map(msg.users.map((u) => [u.id, u]));
    // adopt the room's map (for joiners; for the creator it's identical)
    this.doc.load(msg.map);
    for (const u of msg.users) if (u.id !== this.you && u.sel?.length) this.vp.setRemoteSelection(u.id, u, u.sel);
    this.doc.sendHook = (ops) => this._send({ t: 'op', ops });
    this.app.settings.lastRoom = msg.room; window.etbr.settings.set({ lastRoom: msg.room });
    this.dispatchEvent(new Event('change'));
    this.app.toast(`🟢 Live in room ${msg.room}`);
  }
  async _reconnect() {
    this.dispatchEvent(new Event('change'));
    for (let i = 0; i < 10 && this.wantRoom; i++) {
      this.app.toast(`Connection lost — reconnecting (${i + 1})…`, 2500);
      await new Promise((r) => setTimeout(r, 1500 + i * 1500));
      try { await this._open({ ...this.hello, t: 'join', room: this.wantRoom, map: undefined }); return; } catch {}
    }
    this.app.toast('Could not reconnect. Your level is still here — Save it, then rejoin.');
    this.leave();
  }
  leave(silent) {
    this.wantRoom = null;
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch {} }
    this.ws = null; this.room = null; this.doc.sendHook = null;
    for (const id of this.users.keys()) this.vp.removeRemote(id);
    this.users.clear();
    if (!silent) this.dispatchEvent(new Event('change'));
  }
  _send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }

  sendLive(ops) { if (this.connected && ops.length) this._send({ t: 'op', ops, live: true }); }
  sendCursor(p) {
    const now = performance.now();
    if (!this.connected || now - this.lastCursor < 80) return;
    this.lastCursor = now; this._send({ t: 'cursor', p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
  }
  sendSelection(ids) { if (this.connected) this._send({ t: 'select', ids }); }
  chat(text) { if (this.connected && text.trim()) this._send({ t: 'chat', text }); }

  _msg(msg) {
    switch (msg.t) {
      case 'op': this.doc.apply(msg.ops, { record: false, source: 'remote' }); break;
      case 'reject': this.app.toast('⚠️ ' + msg.reason); this._resync(); break;
      case 'user+': this.users.set(msg.user.id, msg.user); this.app.toast(`👋 ${msg.user.name} joined`); this.dispatchEvent(new Event('change')); break;
      case 'user-': { const u = this.users.get(msg.id); this.users.delete(msg.id); this.vp.removeRemote(msg.id); if (u) this.app.toast(`${u.name} left`); this.dispatchEvent(new Event('change')); break; }
      case 'cursor': { const u = this.users.get(msg.id); if (u) this.vp.setRemoteCursor(msg.id, u, msg.p); break; }
      case 'select': { const u = this.users.get(msg.id); if (u) { u.sel = msg.ids; this.vp.setRemoteSelection(msg.id, u, msg.ids); } break; }
      case 'chat': this.dispatchEvent(new CustomEvent('chat', { detail: msg })); break;
    }
  }
  async _resync() {
    // a rejected op means our copy drifted — pull the authoritative map
    try {
      const r = await fetch(`${this.app.settings.serverUrl.replace(/\/$/, '')}/api/room/${this.room}/map`);
      if (r.ok) { const sel = [...this.vp.selection]; this.doc.load(await r.json()); this.vp.select(sel.filter((id) => this.vp.objects.has(id))); }
    } catch {}
  }
}
