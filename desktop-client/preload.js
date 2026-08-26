const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plannerClient', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveUrl: (url) => ipcRenderer.invoke('save-url', url),
  onLoadFailed: (cb) => ipcRenderer.on('load-failed', (_e, info) => cb(info)),
});
