import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const accountsRoute = (await import('../server/routes/accounts.js')).default;
const personsRoute = (await import('../server/routes/persons.js')).default;
const { als } = dbm;
after(() => {
  cleanup(dir);
});

// Spin up an Express app that wraps every request in ALS for the test user.
function app() {
  const a = express();
  a.use(express.json());
  a.use((_req, _res, next) => als.run(dbm.getUserDb('test-user'), next));
  a.use('/api/accounts', accountsRoute);
  a.use('/api/persons', personsRoute);
  return a;
}
function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app().listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const data = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          method,
          host: '127.0.0.1',
          port,
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data ? Buffer.byteLength(data) : 0,
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => {
            buf += c;
          });
          res.on('end', () => {
            server.close();
            dbm.closeUserDb('test-user');
            resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
          });
        },
      );
      req.on('error', (e) => {
        server.close();
        dbm.closeUserDb('test-user');
        reject(e);
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

test('account: create + list', async () => {
  const c = await call('POST', '/api/accounts', { name: 'Savings', kind: 'bank' });
  assert.equal(c.status, 200);
  assert.ok(c.body.id);
  assert.equal(c.body.opening_balance, 0);
  const l = await call('GET', '/api/accounts');
  assert.equal(l.status, 200);
  assert.ok(l.body.some((a) => a.name === 'Savings'));
});

test('account: rejects duplicate name and bad kind', async () => {
  await call('POST', '/api/accounts', { name: 'X' });
  const dup = await call('POST', '/api/accounts', { name: 'X' });
  assert.equal(dup.status, 400);
  const bad = await call('POST', '/api/accounts', { name: 'Y', kind: 'unknown' });
  assert.equal(bad.status, 400);
});

test('account: partial PATCH (rename) preserves is_spending_pot', async () => {
  const c = await call('POST', '/api/accounts', { name: 'Old' });
  const r = await call('PATCH', `/api/accounts/${c.body.id}`, { name: 'New' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'New');
  assert.equal(r.body.is_spending_pot, 0);
});

test('account: delete refused when transactions reference it', async () => {
  const a = await call('POST', '/api/accounts', { name: 'Used' });
  const db = dbm.getUserDb('test-user');
  als.run(db, () =>
    db
      .prepare(
        'INSERT INTO transactions (date, description, amount, currency, account_id, dedup_key) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('2026-08-15', 'X', -1, 'EUR', a.body.id, 'a-test-1'),
  );
  const d = await call('DELETE', `/api/accounts/${a.body.id}`);
  assert.equal(d.status, 409);
});

test('person: create + list + rename + delete', async () => {
  const c = await call('POST', '/api/persons', { name: 'Alice' });
  assert.equal(c.status, 200);
  assert.ok(c.body.id);
  const dup = await call('POST', '/api/persons', { name: 'Alice' });
  assert.equal(dup.status, 400);
  const r = await call('PATCH', `/api/persons/${c.body.id}`, { name: 'Alicia' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Alicia');
  const d = await call('DELETE', `/api/persons/${c.body.id}`);
  assert.equal(d.status, 200);
});
