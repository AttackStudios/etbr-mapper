// ETBR Mapper — Electron main process
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const USER = app.getPath('userData');
const LIB = path.join(USER, 'library');
const SETTINGS_FILE = path.join(USER, 'settings.json');
const DEFAULT_SERVER = 'https://etbr-collab.onrender.com';
const LOADER_REL = ['EscapeTheBackrooms', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'ETBRLoader'];

protocol.registerSchemesAsPrivileged([{ scheme: 'etbrlib', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// ---------- settings ----------
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch {} // tolerate a BOM from hand edits
  return Object.assign({ serverUrl: DEFAULT_SERVER, name: '', color: '', gameDir: '', recent: [], tutorialDone: false }, s);
}
function writeSettings(patch) {
  const s = Object.assign(readSettings(), patch);
  fs.mkdirSync(USER, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  return s;
}

// ---------- game detection ----------
function steamLibraries() {
  const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary'];
  const libs = new Set();
  for (const r of roots) {
    const vdf = path.join(r, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(path.join(r, 'steamapps'))) libs.add(r);
    try {
      const t = fs.readFileSync(vdf, 'utf8');
      for (const m of t.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  return [...libs];
}
function isGameDir(d) {
  return d && fs.existsSync(path.join(d, 'EscapeTheBackrooms', 'Content', 'Paks'));
}
function detectGame() {
  const s = readSettings();
  if (isGameDir(s.gameDir)) return s.gameDir;
  for (const lib of steamLibraries()) {
    const d = path.join(lib, 'steamapps', 'common', 'EscapeTheBackrooms');
    if (isGameDir(d)) { writeSettings({ gameDir: d }); return d; }
  }
  return '';
}

// ---------- extractor ----------
function extractorPath() {
  const packed = path.join(process.resourcesPath || '', 'extractor', 'Extractor.exe');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, '..', 'extractor', 'pub', 'Extractor.exe');
}
let buildProc = null;
function buildLibrary(win, force) {
  return new Promise((resolve) => {
    const gameDir = detectGame();
    if (!gameDir) return resolve({ ok: false, error: 'Escape the Backrooms not found. Pick its folder in Settings.' });
    const exe = extractorPath();
    if (!fs.existsSync(exe)) return resolve({ ok: false, error: 'Extractor.exe missing: ' + exe });
    fs.mkdirSync(LIB, { recursive: true });
    const args = ['library', gameDir, LIB]; if (force) args.push('--force');
    buildProc = spawn(exe, args, { windowsHide: true });
    let tail = '';
    const onData = (d) => {
      const s = d.toString(); tail = (tail + s).slice(-4000);
      for (const line of s.split(/\r?\n/)) {
        const m = line.match(/^PROGRESS (\d+)\/(\d+) (.*)$/);
        if (m) win.webContents.send('library:progress', { done: +m[1], total: +m[2], label: m[3] });
        else if (line.trim()) win.webContents.send('library:log', line);
      }
    };
    buildProc.stdout.on('data', onData); buildProc.stderr.on('data', onData);
    buildProc.on('close', (code) => { buildProc = null; resolve(code === 0 ? { ok: true } : { ok: false, error: 'Extractor failed (code ' + code + ')\n' + tail }); });
  });
}

// ---------- window ----------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1100, minHeight: 700,
    backgroundColor: '#14120c', title: 'ETBR Mapper', autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault(); win.webContents.send('app:closing');
  });
}

app.whenReady().then(() => {
  protocol.handle('etbrlib', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const full = path.normalize(path.join(LIB, rel));
    if (!full.startsWith(LIB)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch));
ipcMain.handle('game:detect', () => detectGame());
ipcMain.handle('game:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select the EscapeTheBackrooms folder', properties: ['openDirectory'] });
  if (r.canceled) return '';
  const d = r.filePaths[0];
  if (!isGameDir(d)) return { error: 'That folder does not contain EscapeTheBackrooms\\Content\\Paks' };
  writeSettings({ gameDir: d }); return d;
});
ipcMain.handle('library:status', () => {
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(LIB, 'catalog.json'), 'utf8'));
    return { ok: true, catalog: cat };
  } catch { return { ok: false }; }
});
ipcMain.handle('library:build', (_e, force) => buildLibrary(win, force));
ipcMain.handle('library:saveThumb', (_e, id, dataUrl) => {
  const f = path.join(LIB, 'thumbs', id.replace(/[^a-z0-9_.-]/gi, '_') + '.png');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return true;
});

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open level', filters: [{ name: 'ETBR Map', extensions: ['etbrmap'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('file:openPath', async (_e, p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
ipcMain.handle('file:save', async (_e, { path: p, text, name, saveAs }) => {
  if (!p || saveAs) {
    const r = await dialog.showSaveDialog(win, { title: 'Export level', defaultPath: (name || 'MyLevel').replace(/[^\w -]/g, '') + '.etbrmap', filters: [{ name: 'ETBR Map', extensions: ['etbrmap'] }] });
    if (r.canceled) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, text);
  const s = readSettings();
  writeSettings({ recent: [p, ...s.recent.filter((x) => x !== p)].slice(0, 8) });
  return p;
});
ipcMain.handle('game:installMap', (_e, { text, name }) => {
  const gameDir = detectGame();
  if (!gameDir) return { ok: false, error: 'Game folder not found' };
  const loader = path.join(gameDir, ...LOADER_REL);
  if (!fs.existsSync(loader)) return { ok: false, error: 'The ETBR loader mod is not installed — run ETBR-Mapper-Setup.exe first.' };
  const dir = path.join(loader, 'maps'); fs.mkdirSync(dir, { recursive: true });
  const file = (name || 'MyLevel').replace(/[^\w-]/g, '_') + '.etbrmap';
  fs.writeFileSync(path.join(dir, file), text);
  return { ok: true, file, command: 'etbr load ' + file.replace(/\.etbrmap$/, '') };
});
// Live test: tell the in-game loader which collab room to follow (F7 in game picks it up)
ipcMain.handle('game:writeLive', (_e, live) => {
  const gameDir = detectGame();
  if (!gameDir) return { ok: false, error: 'Game folder not found' };
  const loader = path.join(gameDir, ...LOADER_REL);
  if (!fs.existsSync(loader)) return { ok: false, error: 'The ETBR loader mod is not installed — run ETBR-Mapper-Setup.exe first.' };
  fs.writeFileSync(path.join(loader, 'live.json'), JSON.stringify({ ...live, written: new Date().toISOString(), epoch: Math.floor(Date.now() / 1000) }, null, 1));
  return { ok: true };
});
ipcMain.handle('game:launch', async () => {
  const running = await new Promise((res) => {
    require('child_process').exec('tasklist /FI "IMAGENAME eq Backrooms-Win64-Shipping.exe" /NH', (err, out) => res(!err && /Backrooms-Win64-Shipping/i.test(out || '')));
  });
  if (!running) await shell.openExternal('steam://rungameid/1943950');
  return { running };
});
// ---------- custom assets (.etbrObject / .etbrEntity / .etbrItem) ----------
const CUSTOM = path.join(USER, 'custom');
const ASSET_EXT = { object: 'etbrObject', entity: 'etbrEntity', item: 'etbrItem' };
ipcMain.handle('custom:list', () => {
  fs.mkdirSync(CUSTOM, { recursive: true });
  return fs.readdirSync(CUSTOM).filter((f) => f.endsWith('.json')).map((f) => { try { return fs.readFileSync(path.join(CUSTOM, f), 'utf8'); } catch { return null; } }).filter(Boolean);
});
ipcMain.handle('custom:save', (_e, text) => {
  const a = JSON.parse(text);
  if (a.format !== 'etbr-asset' || !/^[\w-]{4,64}$/.test(a.id)) throw new Error('not a custom asset');
  fs.mkdirSync(CUSTOM, { recursive: true });
  fs.writeFileSync(path.join(CUSTOM, a.id + '.json'), text);
  return true;
});
ipcMain.handle('custom:delete', (_e, id) => { try { fs.unlinkSync(path.join(CUSTOM, String(id).replace(/[^\w-]/g, '') + '.json')); } catch {} return true; });
ipcMain.handle('custom:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import custom content', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'ETBR custom content', extensions: ['etbrObject', 'etbrEntity', 'etbrItem'] }] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
});
ipcMain.handle('custom:export', async (_e, text) => {
  const a = JSON.parse(text);
  const ext = ASSET_EXT[a.kind] || 'etbrObject';
  const r = await dialog.showSaveDialog(win, { title: 'Export custom content', defaultPath: (a.name || 'Custom').replace(/[^\w -]/g, '') + '.' + ext, filters: [{ name: ext, extensions: [ext] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, text);
  return r.filePath;
});
// pick a file and hand its bytes to the renderer (models, textures, sounds, scripts)
ipcMain.handle('file:pickBytes', async (_e, { title, filters, multi }) => {
  const r = await dialog.showOpenDialog(win, { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), b64: fs.readFileSync(p).toString('base64'), dir: path.dirname(p) }));
});
// sibling files (.gltf buffers/textures, .obj .mtl + textures) resolved relative to the model
ipcMain.handle('file:readSibling', (_e, dir, rel) => {
  const full = path.normalize(path.join(dir, decodeURIComponent(rel)));
  if (!full.startsWith(path.normalize(dir))) return null;
  try { return fs.readFileSync(full).toString('base64'); } catch { return null; }
});
ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:quit', () => { win.__forceClose = true; win.close(); });
