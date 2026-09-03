import { Router } from 'express';
import {
  hasAnyUser,
  getUserDb,
  als,
  listUsers,
  deleteUser,
  closeUserDb,
  isAdmin,
  master,
  safeDbFilename,
  DATA_DIR,
} from '../db.js';
import {
  createUser,
  verifyLogin,
  createSession,
  destroySession,
  changePassword,
  hashPasswordAsync,
  renameUser,
  requireAuth,
  requireAdmin,
  PASSWORD_MIN,
} from '../auth.js';
import { getSetting, setSetting, db } from '../db.js';
import {
  rateLimit,
  consume,
  clear,
  loginCooldownRemaining,
  recordLoginFailure,
  clearLoginFailures,
} from '../rate-limit.js';
import { pauseRequests, resumeRequests } from '../request-gate.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const router = Router();

const SETUP_TOKEN = String(process.env.SETUP_TOKEN || '').trim();

function isLoopback(ip) {
  const normalized = String(ip || '').replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

// Behind a reverse proxy without TRUST_PROXY=1, every request appears to come
// from 127.0.0.1 — which would both open /setup to the world and merge all
// users into one rate-limit bucket. A direct localhost connection never
// carries proxy headers, so:
// - setup treats any forwarded request as remote (SETUP_TOKEN required), and
// - rate limiting keys on the rightmost XFF hop, which the local proxy itself
//   appended (the leftmost entry is client-controlled and spoofable).
function behindProxy(req) {
  return ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some((h) => req.headers[h]);
}

function rateLimitIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (isLoopback(req.ip) && typeof xff === 'string' && xff.trim()) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.ip;
}

function hasSetupToken(req) {
  const presented = String(req.get('X-Setup-Token') || '');
  if (!SETUP_TOKEN || !presented) return false;
  const expected = Buffer.from(SETUP_TOKEN);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireLocalSetup(req, res, next) {
  if (hasSetupToken(req) || (isLoopback(req.ip) && !behindProxy(req))) return next();
  return res.status(403).json({
    error: 'Initial setup is limited to localhost; set SETUP_TOKEN for remote setup',
  });
}

router.get('/status', (req, res) => {
  res.json({ passwordSet: hasAnyUser() }); // true = at least one account exists
});

// First-run: create the initial account (becomes admin). Rate-limited by IP so
// a LAN scan cannot hammer the endpoint.
router.post(
  '/setup',
  rateLimit({ windowMs: 60 * 1000, max: 5 }),
  requireLocalSetup,
  async (req, res) => {
    if (hasAnyUser())
      return res.status(400).json({ error: 'An account already exists — please log in' });
    const { username, password } = req.body ?? {};
    try {
      const name = await createUser(username, password, 'admin');
      als.run(getUserDb(name), () => setSetting('currency', 'EUR'));
      createSession(res, name, req);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
);

// Login is rate-limited per IP+username (10 tries / minute), with a generic
// error so usernames cannot be enumerated.
router.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '')
    .trim()
    .toLowerCase();
  // Two buckets: per-IP+username AND a wider per-IP bucket, so rotating
  // usernames cannot dodge the per-username throttle. Behind a local proxy the
  // bucket keys fall back to the real client IP (see rateLimitIp).
  const ip = rateLimitIp(req);
  const key = `${ip}|${username}`;
  const ipKey = `ip|${ip}`;
  const cooldown = loginCooldownRemaining(key);
  if (cooldown > 0) {
    res.setHeader('Retry-After', Math.ceil(cooldown / 1000));
    return res.status(429).json({ error: 'Too many attempts — try again later' });
  }
  if (consume(ipKey, 60 * 1000, 30) || consume(key, 60 * 1000, 10))
    return res.status(429).json({ error: 'Too many attempts — try again in a minute' });
  const user = await verifyLogin(username, req.body?.password);
  if (!user) {
    recordLoginFailure(key);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  clear(key);
  clearLoginFailures(key);
  createSession(res, user, req);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    username: req.username,
    admin: isAdmin(req.username),
    currency: getSetting('currency') || 'EUR',
  });
});

// Throttled: it verifies the current password, so an attacker with a hijacked
// session must not be able to brute-force it without limit.
router.post(
  '/change-password',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 5, key: (req) => `pw|${req.username}` }),
  async (req, res) => {
    const { current_password, new_password } = req.body ?? {};
    try {
      await changePassword(req.username, current_password, new_password);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  },
);

// Rename the logged-in user. Requires the current password (a hijacked
// session can't rename you). Drained under the request gate so the on-disk
// rename of the user's database file doesn't race an in-flight query.
router.patch(
  '/me',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 3, key: (req) => `rename|${req.username}` }),
  async (req, res) => {
    const { username: newUsername, current_password } = req.body ?? {};
    if (!newUsername || !current_password)
      return res.status(400).json({ error: 'username and current_password are required' });
    try {
      const oldName = req.username;
      let acquired = false;
      await pauseRequests();
      acquired = true;
      try {
        const newName = await renameUser(oldName, newUsername, current_password);
        // All old sessions are invalidated. Issue a fresh one for the new
        // username so the caller stays signed in.
        createSession(res, newName, req);
        res.json({ ok: true, username: newName });
      } finally {
        if (acquired) resumeRequests();
      }
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  },
);

// Admin-only: rename any user without a password check. Same drain.
router.patch('/users/:username', requireAuth, requireAdmin, async (req, res) => {
  const target = String(req.params.username ?? '').toLowerCase();
  const { username: newUsername } = req.body ?? {};
  if (!newUsername) return res.status(400).json({ error: 'username is required' });
  const exists = master.prepare('SELECT 1 FROM users WHERE username = ?').get(target);
  if (!exists) return res.status(404).json({ error: 'User not found' });
  try {
    let acquired = false;
    await pauseRequests();
    acquired = true;
    try {
      const newName = await renameUser(target, newUsername);
      // The target's sessions are invalidated; if the renamed user happens
      // to be the caller, re-issue a session cookie so the admin stays in.
      if (req.username === target) createSession(res, newName, req);
      res.json({ ok: true, username: newName });
    } finally {
      if (acquired) resumeRequests();
    }
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// ------------------------------------------------------ admin: manage users
router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(listUsers());
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const name = await createUser(username, password, 'user');
    als.run(getUserDb(name), () => {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
        'currency',
        'EUR',
      );
    });
    res.json({ ok: true, username: name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/users/:username/password', requireAuth, requireAdmin, async (req, res) => {
  const target = String(req.params.username ?? '').toLowerCase();
  const { new_password } = req.body ?? {};
  const row = master.prepare('SELECT username FROM users WHERE username = ?').get(target);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (!new_password || new_password.length < PASSWORD_MIN)
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters` });
  master
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(await hashPasswordAsync(new_password), target);
  // force re-login everywhere
  master.prepare('DELETE FROM sessions WHERE username = ?').run(target);
  res.json({ ok: true });
});

router.delete('/users/:username', requireAuth, requireAdmin, (req, res) => {
  const target = String(req.params.username ?? '').toLowerCase();
  if (target === req.username)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  const row = master.prepare('SELECT username FROM users WHERE username = ?').get(target);
  if (!row) return res.status(404).json({ error: 'User not found' });
  closeUserDb(target);
  deleteUser(target);
  // remove their database file as well
  const safe = safeDbFilename(target);
  const dataDir = DATA_DIR;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(path.join(dataDir, 'users', `${safe}.db${suffix}`));
    } catch {}
  }
  res.json({ ok: true });
});

export default router;
