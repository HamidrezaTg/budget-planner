import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { master, getUserDb, als, isAdmin, safeDbFilename, DATA_DIR, closeUserDb } from './db.js';

const COOKIE = 'bp_session';

// Password policy: at least 8 characters for any new or changed password.
export const PASSWORD_MIN = 8;

// Absolute server-side session lifetime (matches the cookie maxAge).
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Cookie Secure flag. The app runs over plain HTTP on a trusted home LAN by
// default, so `Secure` cannot be set unconditionally (it would break login).
// It is applied when explicitly configured via SECURE_COOKIE=1, or
// automatically when the request itself is TLS — including behind a reverse
// proxy or Tailscale Serve with TRUST_PROXY=1 and X-Forwarded-Proto: https.
export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIE === '1' || Boolean(req?.secure),
    maxAge: SESSION_TTL_MS,
  };
}

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
  const name = String(username ?? '')
    .trim()
    .toLowerCase();
  // "." and "-" are excluded: they collided with "_" under the legacy
  // filename sanitizer and must never enter the system again (new usernames).
  if (!/^[a-z0-9_]{2,32}$/.test(name))
    throw new Error('Username must be 2–32 chars: letters, numbers, _');
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

export async function adminResetPassword(username, newPassword) {
  const target = normalizeUsername(username);
  if (!newPassword || newPassword.length < PASSWORD_MIN)
    throw new Error(`New password must be at least ${PASSWORD_MIN} characters`);
  const row = master.prepare('SELECT username FROM users WHERE username = ?').get(target);
  if (!row) throw new Error('User not found');
  master
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(await hashPasswordAsync(newPassword), target);
  master.prepare('DELETE FROM sessions WHERE username = ?').run(target);
}

export function setUserDisabled(username, disabled) {
  const target = normalizeUsername(username);
  const row = master
    .prepare('SELECT username, role, disabled FROM users WHERE username = ?')
    .get(target);
  if (!row) throw new Error('User not found');
  if (disabled && row.role === 'admin' && !row.disabled) {
    const enabledAdmins = master
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0")
      .get().count;
    if (enabledAdmins <= 1) throw new Error('Cannot disable the only enabled admin account');
  }
  master.prepare('UPDATE users SET disabled = ? WHERE username = ?').run(disabled ? 1 : 0, target);
  if (disabled) master.prepare('DELETE FROM sessions WHERE username = ?').run(target);
}

// Constant-time-ish login: an unknown username must cost the same scrypt work
// as a known one, or response timing reveals which usernames exist.
// Format matches hashPasswordAsync (`salt:hash`) so it runs full scrypt work
// and never matches any password.
const DUMMY_HASH =
  'TgUqIPyhFmzoIhLhX8FGyw==:5fd9cd424d71a2c3f48e4566788ab09d12e3f4a5b6c7d8910e2f4c3adeaf90b2';
export async function verifyLogin(username, password) {
  const row = master
    .prepare('SELECT username, password_hash, disabled FROM users WHERE username = ?')
    .get(
      String(username ?? '')
        .trim()
        .toLowerCase(),
    );
  if (!row) {
    await verifyPasswordAsync(password ?? '', DUMMY_HASH);
    return null;
  }
  const ok = await verifyPasswordAsync(password ?? '', row.password_hash);
  return ok && !row.disabled ? row.username : null;
}

// Admin-only guard, used after requireAuth.
export function requireAdmin(req, res, next) {
  if (!isAdmin(req.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function userExists(username) {
  return !!master.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
}

const USERNAME_RE = /^[a-z0-9_]{2,32}$/;

// Validate a candidate username (lowercased). Returns the normalized name or
// throws an Error. Same rules as createUser: a-z, 0-9, _, 2-32 chars.
export function normalizeUsername(username) {
  const name = String(username ?? '')
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(name)) throw new Error('Username must be 2–32 chars: letters, numbers, _');
  return name;
}

// Rename a user. Optionally verifies the caller's current password first
// (used for the self-service endpoint) or skips the check (admin override).
// Atomic: the rename runs inside the request gate so no in-flight request
// can hold the old handle. All sessions for the old name are invalidated
// (a re-login is required) and a new session is created for the new name.
export async function renameUser(currentName, newUsername, verifyWithPassword = null) {
  const target = normalizeUsername(newUsername);
  if (verifyWithPassword !== null) {
    if (!(await verifyLogin(currentName, verifyWithPassword))) {
      throw new Error('Current password is wrong');
    }
  }
  if (target === currentName) return target; // authenticated no-op
  // Reject if the new name is already in use.
  const exists = master.prepare('SELECT 1 FROM users WHERE username = ?').get(target);
  if (exists) throw new Error('That username is already taken');
  // The request gate has drained other API work, so the cached SQLite handle
  // can be closed before moving its database files.
  closeUserDb(currentName);
  // Move the files first, then update master.db. If the database update fails,
  // the returned undo function puts every moved file back.
  let undoFiles;
  try {
    undoFiles = await renameUserFiles(currentName, target);
  } catch (e) {
    getUserDb(currentName);
    throw e;
  }
  try {
    master.exec('BEGIN');
    // Invalidate every session for the old name. The caller will receive a
    // fresh session in the self-service route.
    master.prepare('DELETE FROM sessions WHERE username = ?').run(currentName);
    master.prepare('UPDATE users SET username = ? WHERE username = ?').run(target, currentName);
    master.exec('COMMIT');
  } catch (e) {
    try {
      master.exec('ROLLBACK');
    } catch {}
    try {
      undoFiles();
    } catch {}
    getUserDb(currentName);
    throw e;
  }
  return target;
}

async function renameUserFiles(oldName, newName) {
  const usersDir = path.join(DATA_DIR, 'users');
  const oldSafe = safeDbFilename(oldName);
  const newSafe = safeDbFilename(newName);
  const oldPath = path.join(usersDir, `${oldSafe}.db`);
  const newPath = path.join(usersDir, `${newSafe}.db`);
  const moves = [];
  const move = (from, to) => {
    if (!fs.existsSync(from)) return;
    if (fs.existsSync(to)) throw new Error(`rename target already exists: ${to}`);
    fs.renameSync(from, to);
    moves.push([to, from]);
  };
  try {
    if (oldPath !== newPath) {
      for (const suffix of ['', '-wal', '-shm']) move(oldPath + suffix, newPath + suffix);
    }
    // Upload directory rename (also uses the encoded username).
    const oldUploads = path.join(DATA_DIR, 'uploads', oldSafe);
    const newUploads = path.join(DATA_DIR, 'uploads', newSafe);
    if (oldUploads !== newUploads) move(oldUploads, newUploads);
  } catch (e) {
    for (const [from, to] of moves.reverse()) {
      try {
        fs.renameSync(from, to);
      } catch {}
    }
    throw new Error(`Could not rename user data: ${e.message}`);
  }
  return () => {
    for (const [from, to] of moves.reverse()) {
      try {
        fs.renameSync(from, to);
      } catch {}
    }
  };
}

export async function changePassword(username, currentPassword, newPassword) {
  if (!(await verifyLogin(username, currentPassword))) throw new Error('Current password is wrong');
  if (!newPassword || newPassword.length < PASSWORD_MIN)
    throw new Error(`New password must be at least ${PASSWORD_MIN} characters`);
  master
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(await hashPasswordAsync(newPassword), username);
  // invalidate every existing session, including the current one
  master.prepare('DELETE FROM sessions WHERE username = ?').run(username);
}

export function createSession(res, username, req = null) {
  const token = crypto.randomBytes(32).toString('hex');
  master.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, username);
  res.cookie(COOKIE, token, sessionCookieOptions(req));
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
    .prepare(
      `SELECT s.username, s.created_at, u.disabled
       FROM sessions s JOIN users u ON u.username = s.username
       WHERE s.token = ?`,
    )
    .get(token);
  if (!sess || sess.disabled) {
    master.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
