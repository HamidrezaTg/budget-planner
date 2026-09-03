import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  consume,
  clear,
  loginCooldownMs,
  loginCooldownRemaining,
  recordLoginFailure,
  clearLoginFailures,
} from '../server/rate-limit.js';
import { freshDataDir, cleanup, loadDb, loadAuth } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const authm = await loadAuth(dir);
after(() => {
  cleanup(dir);
});

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
  dbm.master
    .prepare('INSERT INTO sessions (token, username) VALUES (?, ?)')
    .run('tok-1', 'pwsecure');
  dbm.master
    .prepare('INSERT INTO sessions (token, username) VALUES (?, ?)')
    .run('tok-2', 'pwsecure');
  assert.equal(
    dbm.master.prepare('SELECT COUNT(*) c FROM sessions WHERE username = ?').get('pwsecure').c,
    2,
  );

  await authm.changePassword('pwsecure', 'correct-horse-battery', 'a-new-secure-password');
  assert.equal(
    dbm.master.prepare('SELECT COUNT(*) c FROM sessions WHERE username = ?').get('pwsecure').c,
    0,
  );
});

test('disabled users cannot log in and disabling the only admin is rejected', async () => {
  await authm.createUser('pwadmin', 'another-admin-password', 'admin');
  await authm.createUser('pwuser2', 'another-secure-password');
  authm.setUserDisabled('pwuser2', true);
  assert.equal(await authm.verifyLogin('pwuser2', 'another-secure-password'), null);
  authm.setUserDisabled('pwuser2', false);
  assert.equal(await authm.verifyLogin('pwuser2', 'another-secure-password'), 'pwuser2');
  assert.throws(() => authm.setUserDisabled('pwadmin', true), /only enabled admin/);
});

test('rate limiter returns 429 after exceeding the limit and clears on success', () => {
  const key = '127.0.0.1|testuser';
  for (let i = 0; i < 10; i++) assert.equal(consume(key, 60_000, 10), false);
  assert.equal(consume(key, 60_000, 10), true);
  clear(key);
  assert.equal(consume(key, 60_000, 10), false);
});

test('login cooldown grows progressively and clears after a successful login', () => {
  const key = 'login-cooldown-test';
  clearLoginFailures(key);
  assert.equal(loginCooldownMs(1), 0);
  assert.equal(loginCooldownMs(2), 0);
  assert.equal(loginCooldownMs(3), 1_000);
  assert.equal(loginCooldownMs(4), 2_000);
  assert.equal(loginCooldownMs(10), 60_000);

  recordLoginFailure(key);
  recordLoginFailure(key);
  assert.equal(loginCooldownRemaining(key), 0);
  recordLoginFailure(key);
  assert.ok(loginCooldownRemaining(key) > 0);
  clearLoginFailures(key);
  assert.equal(loginCooldownRemaining(key), 0);
});
