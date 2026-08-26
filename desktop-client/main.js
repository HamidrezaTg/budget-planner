// Budget Planner desktop client — a thin shell around your self-hosted server.
// Contains no backend: it loads the URL the user configured on first run.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const confPath = () => path.join(app.getPath('userData'), 'config.json');

function getUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(confPath(), 'utf8'));
    const url = String(cfg.url || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

let win = null;

function navigate() {
  const url = getUrl();
  if (url) win.loadURL(url + '/');
  else win.loadFile('setup.html');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    autoHideMenuBar: true,
    title: 'Budget Planner',
    backgroundColor: '#f5f3ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  navigate();
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (isMain) win.webContents.send('load-failed', { code, desc, url: getUrl() });
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });

ipcMain.handle('get-config', () => ({ url: getUrl() }));
ipcMain.handle('save-url', (_e, raw) => {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(url)) throw new Error('Address must start with http:// or https://');
  fs.mkdirSync(path.dirname(confPath()), { recursive: true });
  fs.writeFileSync(confPath(), JSON.stringify({ url }, null, 2));
  if (win) navigate();
  return true;
});
