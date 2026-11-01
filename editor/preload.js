'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('etbr', {
  settings: { get: inv('settings:get'), set: inv('settings:set') },
  game: { detect: inv('game:detect'), pick: inv('game:pick'), installMap: inv('game:installMap'), writeLive: inv('game:writeLive'), launch: inv('game:launch') },
  library: {
    status: inv('library:status'), build: inv('library:build'), saveThumb: inv('library:saveThumb'),
    onProgress: (fn) => ipcRenderer.on('library:progress', (_e, p) => fn(p)),
    onLog: (fn) => ipcRenderer.on('library:log', (_e, l) => fn(l)),
  },
  file: { open: inv('file:open'), openPath: inv('file:openPath'), save: inv('file:save') },
  shell: { open: inv('shell:open'), showItem: inv('shell:showItem') },
  app: { quit: inv('app:quit'), onClosing: (fn) => ipcRenderer.on('app:closing', fn) },
});
