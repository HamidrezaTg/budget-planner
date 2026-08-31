import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
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

test('healthz responds without authentication', async () => {
  const r = await fetch(`${srv.url}/healthz`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.uptime === 'number');
});

test('recurrence posting is idempotent and future posts do not suppress the current month', async () => {
  const accs = await api('/accounts', 'GET', null, cookies).catch(() => null);
  // /api/accounts may not exist; the categories route is enough for a valid category
  const cats = await api('/categories', 'GET', null, cookies);
  const catId = cats.find?.((c) => c.id)?.id ?? cat.id;

  const rec = await api('/recurrences', 'POST', {
    name: 'Integration Rent',
    amount: -50,
    day_of_month: 1,
    account_id: null,
    category_id: catId,
    auto_post: true,
  }, cookies);
  assert.ok(rec.id);

  // Invalid month is rejected before any transaction exists.
  const bad = await fetch(`${srv.url}/api/recurrences/${rec.id}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ month: 'not-a-month' }),
  });
  assert.equal(bad.status, 400);

  // Post a FUTURE month explicitly.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nextMonth = now.getMonth() === 11
    ? `${now.getFullYear() + 1}-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;
  const posted = await api(`/recurrences/${rec.id}/post`, 'POST', { month: nextMonth }, cookies);
  assert.equal(posted.ok, true);

  // Listing runs autoPost: the CURRENT month must still be posted even though
  // last_posted_month now points at the future month (never moves backwards,
  // and a future post must not suppress this month).
  const list = await api('/recurrences', 'GET', null, cookies);
  assert.equal(list.autoPosted >= 1, true);
  const mine = list.recurrences.find((r) => r.id === rec.id);
  assert.equal(mine.last_posted_month, nextMonth);

  // Both months exist exactly once — re-listing must not duplicate anything.
  const before = (await api('/transactions?limit=1000', 'GET', null, cookies))
    .rows.filter((t) => t.description === 'Integration Rent').length;
  const listed2 = await api('/recurrences', 'GET', null, cookies);
  const after = (await api('/transactions?limit=1000', 'GET', null, cookies))
    .rows.filter((t) => t.description === 'Integration Rent').length;
  assert.equal(listed2.autoPosted, 0); // nothing due anymore this run
  assert.equal(after, before);

  // Posting the same future month again changes nothing (idempotent dedup).
  await api(`/recurrences/${rec.id}/post`, 'POST', { month: nextMonth }, cookies);
  const finalCount = (await api('/transactions?limit=1000', 'GET', null, cookies))
    .rows.filter((t) => t.description === 'Integration Rent').length;
  assert.equal(finalCount, after);

  await api(`/recurrences/${rec.id}`, 'DELETE', null, cookies);
});

test('restore rejects garbage and table-less files without touching live data', async () => {
  const before = (await api('/transactions?limit=1', 'GET', null, cookies)).total;

  const notDbFd = new FormData();
  notDbFd.append('file', new Blob(['this is definitely not a sqlite database']), 'garbage.db');
  const notDb = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: notDbFd,
  });
  assert.equal(notDb.status, 400);
  const dbErr = (await notDb.json()).error;
  assert.match(dbErr, /not a database|valid budget backup|integrity|missing|Not a valid/i);

  // A valid SQLite file that is NOT a budget backup must be refused too.
  const tmp = mkdtempSync(path.join(tmpdir(), 'restore-'));
  const emptyPath = path.join(tmp, 'empty.db');
  const e = new DatabaseSync(emptyPath);
  e.exec('CREATE TABLE unrelated (x)');
  e.close();
  const emptyFd = new FormData();
  emptyFd.append('file', new Blob([readFileSync(emptyPath)]), 'empty.db');
  const emptyRestore = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: emptyFd,
  });
  assert.equal(emptyRestore.status, 400);
  assert.match((await emptyRestore.json()).error, /missing/);
  rmSync(tmp, { recursive: true, force: true });

  const after = (await api('/transactions?limit=1', 'GET', null, cookies)).total;
  assert.equal(after, before); // live data untouched
});

test('backup → restore round trip preserves the data', async () => {
  const txBefore = (await api('/transactions?limit=1', 'GET', null, cookies)).total;

  const backup = await fetch(`${srv.url}/api/settings/backup`, { headers: { Cookie: cookies } });
  assert.equal(backup.status, 200);
  const buf = Buffer.from(await backup.arrayBuffer());

  const restoreFd = new FormData();
  restoreFd.append('file', new Blob([buf]), 'budget-backup.db');
  const restore = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: restoreFd,
  });
  assert.equal(restore.status, 200);
  const body = await restore.json();
  assert.equal(body.ok, true);
  assert.equal(body.transactions, txBefore);

  const after = (await api('/transactions?limit=1', 'GET', null, cookies)).total;
  assert.equal(after, txBefore);
});

test('re-importing the same statement inserts nothing; duplicates within one file both import', async () => {
  const csv = [
    'Started Date,Description,Amount,Currency',
    '2026-05-10,Coffee Bar,-4.50,EUR',
    '2026-05-10,Coffee Bar,-4.50,EUR', // two genuinely different purchases
  ].join('\n');
  const upload = async () => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'coffee.csv');
    const up = await fetch(`${srv.url}/api/import/upload`, {
      method: 'POST',
      headers: { Cookie: cookies },
      body: fd,
    });
    assert.equal(up.status, 200);
    return up.json();
  };

  // First pass: both rows in one file are distinct occurrences — preview shows
  // both as new, confirm inserts both.
  const first = await upload();
  assert.equal(first.summary.toImport, 2);
  const firstDone = await api('/import/confirm', 'POST', { token: first.token, account_id: null }, cookies);
  assert.equal(firstDone.inserted, 2);

  // Re-import of the same file: preview flags both as duplicates, confirm inserts nothing.
  const second = await upload();
  assert.equal(second.summary.toImport, 0);
  assert.equal(second.summary.duplicates, 2);
  const secondDone = await api('/import/confirm', 'POST', { token: second.token, account_id: null }, cookies);
  assert.equal(secondDone.inserted, 0);
  assert.equal(secondDone.skippedDuplicates, 2);
});

test('xlsx monthly export round-trips through the maintained spreadsheet package', async () => {
  const r = await fetch(`${srv.url}/api/reports/export/monthly/2026-05.xlsx`, {
    headers: { Cookie: cookies },
  });
  assert.equal(r.status, 200);
  assert.equal(
    r.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  assert.equal(wb.SheetNames[0], 'Transactions');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Transactions']);
  const coffee = rows.filter((row) => row.Description === 'Coffee Bar');
  assert.equal(coffee.length, 2);
  assert.equal(coffee[0].Amount, -4.5);
  assert.equal(coffee[0].Currency, 'EUR');
});

test('yearly report includes per-category monthly spending', async () => {
  const report = await api('/reports/yearly/2026', 'GET', null, cookies);
  assert.ok(Array.isArray(report.byCategoryMonthly));
  assert.ok(report.byCategoryMonthly.some((row) => (
    row.month === '2026-05' && row.name === 'Uncategorized' && row.spent < 0
  )));
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
