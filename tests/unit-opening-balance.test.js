import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb, startServer } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const model = await import('../server/services/model.js');
const { accountBalanceAt, currentMonth, addMonths } = model;
const db = dbm.getUserDb('ob-user');
const run = (fn, ...args) => dbm.als.run(db, fn, ...args);
after(() => {
  cleanup(dir);
});

function setup({ withBaseline }) {
  db.exec('DELETE FROM transactions');
  db.exec('DELETE FROM balance_observations');
  db.exec('DELETE FROM accounts');
  db.exec('DELETE FROM funds');
  const accId = db
    .prepare('INSERT INTO accounts (name, opening_balance, opening_balance_month) VALUES (?, ?, ?)')
    .run('Bank', 1000, withBaseline ? '2026-06' : null).lastInsertRowid;
  const ins = db.prepare(
    'INSERT INTO transactions (date, description, amount, dedup_key, account_id) VALUES (?, ?, ?, ?, ?)',
  );
  // May (before baseline), June (baseline month), July (after baseline)
  ins.run('2026-05-10', 'before baseline', -100, 'ob1', accId);
  ins.run('2026-06-15', 'baseline month', -200, 'ob2', accId);
  ins.run('2026-07-20', 'after baseline', -300, 'ob3', accId);
  return accId;
}

test('without a baseline month the opening balance covers all history (legacy)', () => {
  const accId = run(setup, { withBaseline: false });
  // opening 1000 + May (-100) + June (-200) = 700 at end of June
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-06')),
    700,
  );
  // ...plus July (-300) = 400 at end of July
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-07')),
    400,
  );
});

test('with a baseline month the opening balance is true at END of that month', () => {
  const accId = run(setup, { withBaseline: true });
  // End of the baseline month: the baseline already includes June's txns.
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-06')),
    1000,
  );
  // Only transactions strictly AFTER the baseline month are added.
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-07')),
    700,
  );
  // Months before the baseline are unknown.
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-05')),
    null,
  );
  assert.equal(
    run(() => accountBalanceAt(accId, '2026-04')),
    null,
  );
});

test('projection stays finite when an observation predates a baseline month', () => {
  const accId = run(setup, { withBaseline: true });
  db.prepare('INSERT INTO balance_observations (account_id, month, balance) VALUES (?, ?, ?)').run(
    accId,
    '2026-05',
    900,
  ); // observation BEFORE the baseline
  const proj = run(() => model.project(3, '2026-08'));
  assert.ok(Number.isFinite(proj.months[0].total_predicted));
  assert.ok(proj.months.every((m) => Number.isFinite(m.total_predicted)));
});

test('accounts API validates the opening-balance month', async () => {
  const srv = await startServer(dir);
  after(() => srv.stop());
  // setup admin + login
  await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  });
  const login = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = (path, method = 'GET', body) =>
    fetch(`${srv.url}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });

  const badFormat = await api('/accounts', 'POST', {
    name: 'A1',
    opening_balance_month: '2026-13',
  });
  assert.equal(badFormat.status, 400);

  const [y, m] = currentMonth().split('-').map(Number);
  const future = `${y + 1}-${String(m).padStart(2, '0')}`;
  const futureRes = await api('/accounts', 'POST', {
    name: 'A2',
    opening_balance_month: future,
  });
  assert.equal(futureRes.status, 400);

  const created = await api('/accounts', 'POST', {
    name: 'Baseline account',
    opening_balance: 2500,
    opening_balance_month: addMonths(currentMonth(), -2),
  });
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.ok(body.opening_balance_month);

  const patched = await api(`/accounts/${body.id}`, 'PATCH', {
    opening_balance_month: null,
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).opening_balance_month, null);
});

test('GET /balances returns month-by-month history with consistent variance', async () => {
  const srv = await startServer(dir);
  after(() => srv.stop());
  await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  });
  const login = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = (path, method = 'GET', body) =>
    fetch(`${srv.url}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });

  const accounts = await (await api('/accounts')).json();
  const acc = accounts[0];
  const past = addMonths(currentMonth(), -2);
  const obs = await api('/balances', 'POST', {
    account_id: acc.id,
    month: past,
    balance: 555,
  });
  assert.equal(obs.status, 200);

  const invalidMonth = await api('/balances', 'POST', {
    account_id: acc.id,
    month: '2026-13',
    balance: 1,
  });
  assert.equal(invalidMonth.status, 400);

  const data = await (await api('/balances')).json();
  const monthRow = data.history.find((h) => h.month === past);
  assert.ok(monthRow, 'history must include months before the current month');
  const row = monthRow.accounts.find((r) => r.account_id === acc.id);
  assert.equal(row.observed, 555);
  assert.equal(row.variance, Math.round((row.calculated - 555) * 100) / 100);

  // Per-account summary compares at the observation month with the same sign.
  const summary = data.per_account.find((a) => a.id === acc.id);
  assert.equal(summary.latest_observation.month, past);
  assert.equal(summary.latest_variance, Math.round((row.calculated - 555) * 100) / 100);
});
