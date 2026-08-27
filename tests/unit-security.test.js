import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { consume, clear } from '../server/rate-limit.js';
import { freshDataDir, cleanup, loadDb, loadAuth } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const authm = await loadAuth(dir);
after(() => { cleanup(dir); });

test('passwords shorter than 8 characters are rejected', async () => {
  await assert.rejects(() => authm.createUser('pwalice', 'short'), /at least 8 characters/);
});

test('an 8+ character password creates a user successfully', async () => {
  const name = await authm.createUser('pwsecure', 'correct-horse-battery');
  assert.equal(name, 'pwsecure');
});

test('verifyLogin accepts the right password and rejects the wrong one', async () => {
  assert.equal(await authm.verifyLogin('pwsecure', 'correct-horse-battery'), 'pwsecure');
  assert.equal(await authm.verifyLogin('pwsecure', 'wrong-password'), null);
  assert.equal(await authm.verifyLogin('no-such-user', 'correct-horse-battery'), null);
});

test('changing a password invalidates every session', async () => {
  dbm.master.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run('tok-1', 'pwsecure');
  dbm.master.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run('tok-2', 'pwsecure');
  assert.equal(dbm.master.prepare('SELECT COUNT(*) c FROM sessions WHERE username = ?').get('pwsecure').c, 2);

  await authm.changePassword('pwsecure', 'correct-horse-battery', 'a-new-secure-password');
  assert.equal(dbm.master.prepare('SELECT COUNT(*) c FROM sessions WHERE username = ?').get('pwsecure').c, 0);
});

test('rate limiter returns 429 after exceeding the limit and clears on success', () => {
  const key = '127.0.0.1|testuser';
  for (let i = 0; i < 10; i++) assert.equal(consume(key, 60_000, 10), false);
  assert.equal(consume(key, 60_000, 10), true);
  clear(key);
  assert.equal(consume(key, 60_000, 10), false);
});
