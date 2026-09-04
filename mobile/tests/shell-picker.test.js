const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'www', 'shell-picker.js'), 'utf8');

function storage(values = {}) {
  return {
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    },
  };
}

function load(
  values,
  fetch = async () => ({ ok: true, json: async () => ({ name: 'Gulden', api: '/api' }) }),
) {
  const localStorage = storage(values);
  const window = { localStorage };
  vm.runInNewContext(source, { window, localStorage, URL, AbortSignal, fetch });
  return window.BudgetPlannerShell;
}

test('shell picker accepts valid HTTP and HTTPS server URLs only', () => {
  const shell = load();
  assert.equal(shell.isSupportedUrl('http://192.168.1.20:2026'), true);
  assert.equal(shell.isSupportedUrl('https://budget.example.ts.net:2026/'), true);
  assert.equal(shell.isHttpUrl('http://192.168.1.20:2026'), true);
  assert.equal(shell.isHttpUrl('https://budget.example.ts.net'), false);
  assert.equal(shell.isSupportedUrl('ftp://server.example'), false);
  assert.equal(shell.isSupportedUrl('http://user:password@server.example'), false);
  assert.equal(shell.isSupportedUrl('http://server.example/#budget'), false);
  assert.equal(shell.isSupportedUrl('not a URL'), false);
});

test('saved URLs migrate and retain both supported schemes', () => {
  const shell = load({
    'bp-server-urls': JSON.stringify([
      'http://192.168.1.20:2026/',
      'https://budget.example.ts.net',
      'ftp://invalid.example',
    ]),
  });
  assert.deepEqual(Array.from(shell.readSavedUrls()), [
    'http://192.168.1.20:2026',
    'https://budget.example.ts.net',
  ]);
});

test('probe validates the server discovery endpoint for HTTP and HTTPS', async () => {
  let requested;
  const shell = load({}, async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ name: 'Gulden', api: '/api' }) };
  });
  await shell.probe('http://192.168.1.20:2026/');
  assert.equal(requested, 'http://192.168.1.20:2026/.well-known/budget-planner');
  await assert.rejects(shell.probe('ftp://server.example'), /http:\/\/ or https:\/\//);
});
