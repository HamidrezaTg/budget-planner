import crypto from 'node:crypto';
import { master, getUserDb, als, isAdmin } from './db.js';

const COOKIE = 'bp_session';

// Password policy: at least 8 characters for any new or changed password.
export const PASSWORD_MIN = 8;

// Absolute server-side session lifetime (matches the cookie maxAge).
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Cookie Secure flag: the app runs over plain HTTP on a home LAN by default.
// Enable `Secure` explicitly when serving behind HTTPS (e.g. a reverse proxy).
const COOKIE_SECURE = process.env.SECURE_COOKIE === '1';

export function hashPasswordAsync(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPasswordAsync(password, storedHash) {
  return new Promise((resolve) => {
    const [salt, hash] = String(storedHash ?? '').split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password ?? '', salt, 64, (err, derivedKey) => {
      if (err) return resolve(false);
      const a = Buffer.from(hash, 'hex');
      const b = derivedKey;
      if (a.length !== b.length) return resolve(false);
      resolve(crypto.timingSafeEqual(a, b));
    });
  });
}

export async function createUser(username, password, role = 'user') {
  const name = String(username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(name))
    throw new Error('Username must be 2–32 chars: letters, numbers, . _ -');
  if (!password || password.length < PASSWORD_MIN)
    throw new Error(`Password must be at least ${PASSWORD_MIN} characters`);
  master
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(name, await hashPasswordAsync(password), role);
  // admin-created users start from a neutral setup; the first (admin) account
  // gets the household seed
  getUserDb(name, { generic: role !== 'admin' });
  return name;
}

// Admin-only guard, used after requireAuth.
export function requireAdmin(req, res, next) {
  if (!isAdmin(req.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export async function verifyLogin(username, password) {
  const row = master
    .prepare('SELECT username, password_hash FROM users WHERE username = ?')
    .get(String(username ?? '').trim().toLowerCase());
  if (!row) return null;
  const ok = await verifyPasswordAsync(password ?? '', row.password_hash);
  return ok ? row.username : null;
}

export function userExists(username) {
  return !!master.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
}

export async function changePassword(username, currentPassword, newPassword) {
  if (!(await verifyLogin(username, currentPassword)))
    throw new Error('Current password is wrong');
  if (!newPassword || newPassword.length < PASSWORD_MIN)
    throw new Error(`New password must be at least ${PASSWORD_MIN} characters`);
  master
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(await hashPasswordAsync(newPassword), username);
  // invalidate every existing session, including the current one
  master.prepare('DELETE FROM sessions WHERE username = ?').run(username);
}

export function createSession(res, username) {
  const token = crypto.randomBytes(32).toString('hex');
  master.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, username);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
  });
}

export function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) master.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE);
}

// Validates the session and enters the AsyncLocalStorage context for this
// user's database — every handler downstream can just use the `db` proxy.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const sess = master
    .prepare('SELECT username, created_at FROM sessions WHERE token = ?')
    .get(token);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  if (Date.now() - Date.parse(sess.created_at.replace(' ', 'T') + 'Z') > SESSION_TTL_MS) {
    master.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.username = sess.username;
  als.run(getUserDb(sess.username), next);
}

// Remove stale sessions (called periodically / on startup).
export function sweepExpiredSessions() {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  master.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
}
