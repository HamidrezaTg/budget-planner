// Budget Planner desktop client — a thin shell around your self-hosted server.
// Contains no backend: it loads the URL the user configured on first run.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
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
      sandbox: true,
    },
  });
  navigate();
  // Navigation lock-in: the shell renders exactly one origin (the configured
  // server). Anything else — redirects, window.open, injected links — either
  // stays in-frame at that origin or opens in the system browser. The origin
  // is re-read per event so a config change takes effect immediately.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedOrigin(url, getUrl())) event.preventDefault();
  });
  // will-navigate does not fire for server-initiated redirects; without this
  // guard a 302 from the server could silently move the window to another
  // origin — the classic Electron escape hatch.
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedOrigin(url, getUrl())) event.preventDefault();
  });
  // Remote content gets no privileged permissions (geolocation, notifications,
  // media, …) — a finance shell needs none of them.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !isAllowedOrigin(url, getUrl())) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (isMain) win.webContents.send('load-failed', { code, desc, url: getUrl() });
  });
  win.on('closed', () => { win = null; });
}

function isAllowedOrigin(url, base) {
  try {
    const u = new URL(url);
    const b = new URL(base || '');
    return u.origin === b.origin;
  } catch {
    return false;
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });

// Only the app's own window may talk over IPC; reject any other sender.
function assertOwnSender(event) {
  if (!win || event.sender !== win.webContents) {
    throw new Error('IPC request rejected');
  }
}

ipcMain.handle('get-config', (e) => {
  assertOwnSender(e);
  return { url: getUrl() };
});
ipcMain.handle('save-url', (e, raw) => {
  assertOwnSender(e);
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(url)) throw new Error('Address must start with http:// or https://');
  fs.mkdirSync(path.dirname(confPath()), { recursive: true });
  fs.writeFileSync(confPath(), JSON.stringify({ url }, null, 2));
  if (win) navigate();
  return true;
});
