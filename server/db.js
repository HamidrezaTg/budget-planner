import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
fs.mkdirSync(USERS_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// Master DB: user accounts + sessions only.
export const master = new DatabaseSync(path.join(DATA_DIR, 'master.db'));
master.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// migration: role column; the first account ever created becomes admin
try {
  master.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
} catch {}
const firstUser = master.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
if (firstUser) {
  master.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUser.id);
}

// Per-user budget databases, cached open handles.
const dbCache = new Map();

export function listUsernames() {
  return master.prepare('SELECT username FROM users ORDER BY id').all().map((r) => r.username);
}

export function hasAnyUser() {
  return master.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
}

export function isAdmin(username) {
  const row = master.prepare('SELECT role FROM users WHERE username = ?').get(username);
  return row?.role === 'admin';
}

export function listUsers() {
  return master
    .prepare('SELECT username, role, created_at FROM users ORDER BY id')
    .all();
}

export function deleteUser(username) {
  master.prepare('DELETE FROM sessions WHERE username = ?').run(username);
  master.prepare('DELETE FROM users WHERE username = ?').run(username);
}

export function getUserDb(username, opts = {}) {
  if (dbCache.has(username)) return dbCache.get(username);
  const safe = username.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const inst = new DatabaseSync(path.join(USERS_DIR, `${safe}.db`));
  initUserSchema(inst, opts);
  inst.exec('PRAGMA journal_mode = WAL;');
  dbCache.set(username, inst);
  return inst;
}

// Close and forget a user's cached handle (used when deleting a user, so a
// recreated username starts from a fresh file).
export function closeUserDb(username) {
  const inst = dbCache.get(username);
  if (inst) {
    try { inst.close(); } catch {}
    dbCache.delete(username);
  }
}

function initUserSchema(db, { generic = false } = {}) {
  db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  group_id INTEGER REFERENCES category_groups(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  monthly_budget REAL NOT NULL DEFAULT 0,
  active_from TEXT,
  active_to TEXT,                            -- YYYY-MM, NULL = active
  is_active INTEGER NOT NULL DEFAULT 1,
  roll_overs INTEGER NOT NULL DEFAULT 0      -- underspend carries to next month
);

CREATE TABLE IF NOT EXISTS category_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'sparkasse',
  is_spending_pot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  planned_amount REAL NOT NULL,
  UNIQUE(category_id, month)
);

CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  monthly_amount REAL NOT NULL DEFAULT 0,
  start_month TEXT NOT NULL,
  end_month TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  fund_id INTEGER,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  monthly_contribution REAL NOT NULL DEFAULT 0,
  start_month TEXT NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  target_amount REAL,
  target_date TEXT                            -- YYYY-MM, optional
);

CREATE TABLE IF NOT EXISTS fund_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'withdrawal',
  scheduled INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  current_amount REAL NOT NULL DEFAULT 0,
  recurring INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  UNIQUE(source_id, month)
);

CREATE TABLE IF NOT EXISTS balance_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  balance REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, month)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  tx_type TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  source_file TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  split_group TEXT,                          -- set on all parts of a split
  split_of INTEGER REFERENCES transactions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_cat ON transactions(category_id);

CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description_contains TEXT,
  amount_min REAL,
  amount_max REAL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  tx_type TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,                      -- signed: negative = expense
  day_of_month INTEGER NOT NULL,             -- 1..28
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  auto_post INTEGER NOT NULL DEFAULT 0,      -- post automatically when due
  active INTEGER NOT NULL DEFAULT 1,
  last_posted_month TEXT                     -- YYYY-MM of last auto/manual post
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,                    -- generated name on disk
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multi-currency support: monthly reference rates converting transaction
-- currency to the user's base (display) currency. rate = base units per
-- 1 unit of "currency". Rates are never stored for the base currency itself.
CREATE TABLE IF NOT EXISTS fx_rates (
  month TEXT NOT NULL,                       -- YYYY-MM this rate applies to
  currency TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',     -- manual | ecb
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (month, currency)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok'
);
`);

// migrations for databases created before the v3 money-engine features
for (const col of ['split_group TEXT', 'split_of INTEGER REFERENCES transactions(id) ON DELETE CASCADE']) {
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN ${col}`);
  } catch {}
}
try {
  db.exec('ALTER TABLE categories ADD COLUMN roll_overs INTEGER NOT NULL DEFAULT 0');
} catch {}
try {
  db.exec('ALTER TABLE funds ADD COLUMN target_amount REAL');
} catch {}
try {
  db.exec('ALTER TABLE funds ADD COLUMN target_date TEXT');
} catch {}

  const seed = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (seed === 0) seedGeneric(db);
}

// Neutral starter setup for users created by the admin: no household-specific
// names. Everything is renameable on the Categories / Budgets pages.
function seedGeneric(db) {
  const q = (sql, ...args) => db.prepare(sql).run(...args);
  const one = (sql, ...args) => db.prepare(sql).run(...args);

  const accBank = one(`INSERT INTO accounts (name, kind) VALUES ('Bank account', 'sparkasse')`).lastInsertRowid;
  const accCard = one(`INSERT INTO accounts (name, kind, is_spending_pot) VALUES ('Card', 'revolut', 1)`).lastInsertRowid;

  const groups = ['Housing', 'Food', 'Transport', 'Lifestyle', 'Other'];
  const gid = {};
  groups.forEach((g, i) => {
    gid[g] = one(`INSERT INTO category_groups (name, sort) VALUES (?, ?)`, g, i).lastInsertRowid;
  });
  q(`INSERT INTO income_sources (name, current_amount) VALUES ('Salary', 0)`);
  q(`INSERT INTO income_sources (name, current_amount, recurring) VALUES ('Other income', 0, 0)`);

  const CATS = [
    ['Rent', 'Housing', accBank],
    ['Utilities', 'Housing', accBank],
    ['Internet & phone', 'Housing', accBank],
    ['Groceries', 'Food', accCard],
    ['Dining out', 'Food', accCard],
    ['Transport', 'Transport', accCard],
    ['Subscriptions', 'Lifestyle', accCard],
    ['Shopping', 'Lifestyle', accCard],
    ['Health', 'Lifestyle', accCard],
    ['Fun', 'Lifestyle', accCard],
    ['Savings', 'Other', accBank],
    ['Other', 'Other', accCard],
  ];
  for (const [name, grp, acc] of CATS) {
    q(`INSERT INTO categories (name, group_id, account_id, monthly_budget) VALUES (?, ?, ?, 0)`,
      name, gid[grp], acc);
  }
}

// ---------------------------------------------------------- request context
// Request-scoped access to the current user's database.
export const als = new AsyncLocalStorage();

export const db = new Proxy(
  {},
  {
    get(_t, prop) {
      const inst = als.getStore();
      if (!inst) throw new Error('No user database context');
      const v = inst[prop];
      return typeof v === 'function' ? v.bind(inst) : v;
    },
  }
);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}
