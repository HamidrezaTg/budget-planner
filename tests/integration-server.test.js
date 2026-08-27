import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, startServer } from './helpers.js';

const dir = freshDataDir();
let srv;
let cookies = '';

before(async () => {
  srv = await startServer(dir);
});
after(async () => {
  await srv?.stop();
  cleanup(dir);
});

test('security headers are present and X-Powered-By is gone', async () => {
  const r = await fetch(`${srv.url}/api/auth/status`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"));
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('setup rejects short passwords', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'short' }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /at least 8 characters/);
});

test('setup creates the admin account and logs in', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'correct-horse-battery' }),
  });
  assert.equal(r.status, 200);
  cookies = r.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  assert.ok(cookies.length > 0);

  const me = await fetch(`${srv.url}/api/auth/me`, { headers: { Cookie: cookies } });
  assert.equal(me.status, 200);
  const info = await me.json();
  assert.equal(info.username, 'alice');
  assert.equal(info.admin, true);
});

test('setup refuses to run once an account exists', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'another-secure-pw' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already exists/);
});

test('staged imports cannot be confirmed by another user', async () => {
  await api('/auth/users', 'POST', { username: 'bob', password: 'another-secure-pw' }, cookies);

  const csv = 'Started Date,Description,Amount,Currency\n2026-05-02,Private,-12,EUR\n';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'private.csv');
  const up = await fetch(`${srv.url}/api/import/upload`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: fd,
  });
  assert.equal(up.status, 200);
  const { token } = await up.json();

  const login = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'another-secure-pw' }),
  });
  assert.equal(login.status, 200);
  const bobCookies = login.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';

  const confirm = await fetch(`${srv.url}/api/import/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bobCookies },
    body: JSON.stringify({ token }),
  });
  assert.equal(confirm.status, 400);
  assert.match((await confirm.json()).error, /Unknown or expired/);
});

test('failed logins are rate-limited', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong-pass' }),
    });
    assert.equal(r.status, 401);
  }
  const r = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'wrong-pass' }),
  });
  assert.equal(r.status, 429);
});

test('full import → split → delete-parent flow removes split children via the API', async () => {
  const cat = await api('/categories', 'POST', { name: 'FoodInt' }, cookies);
  const catId = cat.id;

  // Import one transaction from a CSV (the standard parser detects Revolut columns).
  const csv = 'Started Date,Description,Amount,Currency\n2026-05-01,Shop,-100,EUR\n';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
  const up = await fetch(`${srv.url}/api/import/upload`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: fd,
  });
  assert.equal(up.status, 200);
  const { token, summary } = await up.json();
  assert.equal(summary.toImport, 1);

  const done = await api('/import/confirm', 'POST', { token, account_id: null }, cookies);
  assert.equal(done.inserted, 1);

  const listed = await api('/transactions', 'GET', null, cookies);
  const tx = listed.rows.find((r) => r.description === 'Shop');
  assert.ok(tx);

  const parts = await api(`/transactions/${tx.id}/split`, 'POST', {
    parts: [
      { category_id: catId, amount: -60 },
      { category_id: catId, amount: -40 },
    ],
  }, cookies);
  assert.equal(parts.parts, 2);

  const listedSplit = await api('/transactions', 'GET', null, cookies);
  assert.equal(listedSplit.rows.filter((r) => r.split_of === tx.id).length, 2);

  const child = listedSplit.rows.find((r) => r.split_of === tx.id);
  const childDelete = await fetch(`${srv.url}/api/transactions/${child.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookies },
  });
  assert.equal(childDelete.status, 400);

  await api(`/transactions/${tx.id}`, 'DELETE', null, cookies);
  const listedAfter = await api('/transactions', 'GET', null, cookies);
  assert.equal(listedAfter.rows.filter((r) => r.split_of === tx.id).length, 0);
  assert.equal(listedAfter.rows.length, 0);
});

test('unknown API routes return a JSON 404', async () => {
  const r = await fetch(`${srv.url}/api/definitely-not-a-route`);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Not found' });
});

async function api(path, method, body, cookie) {
  const r = await fetch(`${srv.url}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
