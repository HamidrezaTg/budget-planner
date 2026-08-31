import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeDesc } from './services/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Restrict every file this process creates (databases, WAL sidecars, staged
// uploads, backups) to owner-only access. The systemd unit sets UMask=0077 as
// well; this protects manual/dev runs where no unit file is involved.
process.umask(0o077);

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
fs.mkdirSync(USERS_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// Defense in depth for the service account: financial data must not be
// readable by other local users. systemd ships UMask=0077 too; this covers
// manual/`npm start` runs where no unit file is involved.
for (const dir of [DATA_DIR, USERS_DIR, path.join(DATA_DIR, 'uploads')]) {
  try { fs.chmodSync(dir, 0o700); } catch {}
}

// Master DB: user accounts + sessions only.
export const master = new DatabaseSync(path.join(DATA_DIR, 'master.db'));
master.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
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
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);
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

// One-to-one username → filename encoding. The legacy sanitizer mapped every
// character outside [a-zA-Z0-9_-] to "_", so "a.b" and "a!b" collided with
// "a_b" — a cross-user data bleed. ("-" was always preserved and never
// collided.) Everything outside that safe set now becomes %XX, making the
// mapping reversible and collision-free.
export function safeDbFilename(username) {
  return String(username).replace(/[^a-zA-Z0-9_\-]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

export function getUserDb(username, opts = {}) {
  if (dbCache.has(username)) return dbCache.get(username);
  const safe = safeDbFilename(username);
  const target = path.join(USERS_DIR, `${safe}.db`);
  // Data-preserving migration: a username without "."/"-" keeps its old file
  // name (identical encoding); one WITH such characters gets its legacy file
  // renamed to the new encoding on first open.
  if (!fs.existsSync(target)) {
    const legacy = path.join(USERS_DIR, `${username.replace(/[^a-zA-Z0-9_\-]/g, '_')}.db`);
    if (legacy !== target && fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, target);
        for (const suffix of ['-wal', '-shm']) {
          try { fs.renameSync(legacy + suffix, target + suffix); } catch {}
        }
      } catch {}
    }
  }
  const inst = new DatabaseSync(target);
  initUserSchema(inst, opts);
  inst.exec('PRAGMA journal_mode = WAL;');
  // Foreign-key enforcement: declared ON DELETE CASCADE / SET NULL rules now
  // actually fire (e.g. split children removed when their parent is deleted).
  // Set AFTER initUserSchema so legacy ALTER TABLE ADD COLUMN migrations
  // (which may carry a REFERENCES clause) are not blocked by SQLite.
  inst.exec('PRAGMA foreign_keys = ON;');
  dbCache.set(username, inst);
  reportFkViolations(username, inst);
  return inst;
}

// Startup diagnostics: a legacy database can contain rows that predate
// foreign-key enforcement (orphans). Report them loudly instead of silently
// carrying broken references; repair is a deliberate, backed-up operation.
function reportFkViolations(username, inst) {
  try {
    const violations = inst.prepare('PRAGMA foreign_key_check').all();
    if (!violations.length) return;
    const detail = violations
      .slice(0, 20)
      .map((v) => `${v.table}#${v.rowid}`)
      .join(', ');
    console.error(
      `[fk-check] ${username}: ${violations.length} orphaned row(s) ` +
      `(first: ${detail}). Run "PRAGMA foreign_key_check" on the database and back up before repairing.`
    );
  } catch {}
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

export function initUserSchema(db, { generic = false } = {}) {
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
  is_spending_pot INTEGER NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0
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
CREATE INDEX IF NOT EXISTS idx_fund_mov ON fund_movements(fund_id, month);

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
  split_of INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,   -- a transaction can be paid from a fund
  transfer_group TEXT                        -- non-NULL: this row is part of a bank↔card transfer; excluded from spend/income sums
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_cat ON transactions(category_id);
-- FK columns used in correlated subqueries and cascades have no automatic
-- index in SQLite: without these, a page of transactions scans attachments
-- and split children once per row.
CREATE INDEX IF NOT EXISTS idx_tx_split_of ON transactions(split_of);
-- A transfer_group identifies a pair of rows that should be treated as one
-- movement. The index keeps the per-row exclusion in dashboard/report
-- queries fast even when a year of statements is loaded.
CREATE INDEX IF NOT EXISTS idx_tx_transfer_group ON transactions(transfer_group);
CREATE INDEX IF NOT EXISTS idx_tx_fund ON transactions(fund_id);

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
CREATE INDEX IF NOT EXISTS idx_att_tx ON attachments(transaction_id);

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

-- Scheduled reports: automatic month-end snapshots. Captured once, lazily,
-- the first time the app is viewed after a month closes — then frozen so
-- later edits/deletions never rewrite financial history.
CREATE TABLE IF NOT EXISTS monthly_reports (
  month TEXT PRIMARY KEY,                    -- YYYY-MM, always a closed month
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  income REAL NOT NULL DEFAULT 0,
  expenses REAL NOT NULL DEFAULT 0,          -- converted, negative
  planned REAL NOT NULL DEFAULT 0,
  result REAL NOT NULL DEFAULT 0,            -- planned minus spend; +=under
  transfer_to_revolut REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  by_category TEXT NOT NULL DEFAULT '[]'     -- JSON [{name,planned,actual}]
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
try {
  db.exec("ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
} catch {}
// v3.11 — fund link, transfer group, per-account opening balance
try { db.exec('ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN transfer_group TEXT'); } catch {}

// Deduplication fingerprint now includes the transaction currency. Recompute
// existing keys once (guarded by PRAGMA user_version) so re-imports of old
// statements still deduplicate against stored rows, and same-date/same-amount/
// same-description rows in different currencies no longer collide.
const v = db.prepare('PRAGMA user_version').get().user_version;
if (v < 1) {
  migrateDedupKeys(db);
  db.exec('PRAGMA user_version = 1');
}

  const seed = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (seed === 0) seedGeneric(db);
}

function migrateDedupKeys(inst) {
  const seen = new Map();
  const rows = inst
    .prepare('SELECT id, date, amount, currency, description, dedup_key FROM transactions ORDER BY id')
    .all();
  const updates = [];
  for (const tx of rows) {
    // Recurrence and split keys are application-owned identities, not imported
    // statement fingerprints. Rewriting them would break idempotent posting
    // and make existing split parts look like imported transactions.
    if (/^(?:rec|split)\|/.test(tx.dedup_key)) continue;
    const base = `${tx.date}|${Number(tx.amount).toFixed(2)}|${tx.currency || 'EUR'}|${normalizeDesc(tx.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    updates.push({ id: tx.id, key: n > 0 ? `${base}|#${n}` : base });
  }

  // Use temporary unique values first so an existing legacy key cannot collide
  // with a later migrated key during the rewrite.
  const temp = inst.prepare('UPDATE transactions SET dedup_key = ? WHERE id = ?');
  inst.exec('BEGIN');
  try {
    for (const update of updates) temp.run(`__dedup_migration__${update.id}`, update.id);
    for (const update of updates) temp.run(update.key, update.id);
    inst.exec('COMMIT');
  } catch (error) {
    inst.exec('ROLLBACK');
    throw error;
  }
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
