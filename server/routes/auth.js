import { Router } from 'express';
import { hasAnyUser, getUserDb, als, listUsers, deleteUser, closeUserDb, isAdmin, master } from '../db.js';
import {
  createUser,
  verifyLogin,
  createSession,
  destroySession,
  changePassword,
  hashPassword,
  requireAuth,
  requireAdmin,
} from '../auth.js';
import { getSetting, setSetting, db } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ passwordSet: hasAnyUser() }); // true = at least one account exists
});

// First-run: create the initial account (becomes admin)
router.post('/setup', (req, res) => {
  if (hasAnyUser()) return res.status(400).json({ error: 'An account already exists — please log in' });
  const { username, password } = req.body ?? {};
  try {
    const name = createUser(username, password, 'admin');
    als.run(getUserDb(name), () => setSetting('currency', 'EUR'));
    createSession(res, name);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });
  createSession(res, user);
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

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body ?? {};
  try {
    changePassword(req.username, current_password, new_password);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ------------------------------------------------------ admin: manage users
router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(listUsers());
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const name = createUser(username, password, 'user');
    als.run(getUserDb(name), () => {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('currency', 'EUR');
    });
    res.json({ ok: true, username: name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/users/:username/password', requireAuth, requireAdmin, (req, res) => {
  const target = String(req.params.username ?? '').toLowerCase();
  const { new_password } = req.body ?? {};
  const row = master.prepare('SELECT username FROM users WHERE username = ?').get(target);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (!new_password || new_password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  master
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(hashPassword(new_password), target);
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
  const safe = target.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(path.join(dataDir, 'users', `${safe}.db${suffix}`));
    } catch {}
  }
  res.json({ ok: true });
});

export default router;
