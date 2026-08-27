import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
after(() => { cleanup(dir); });

test('foreign keys are enabled on the master and user databases', () => {
  assert.equal(dbm.master.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const db = dbm.getUserDb('fk-user');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  dbm.closeUserDb('fk-user');
});

test('deleting a split parent cascades to its children', () => {
  const db = dbm.getUserDb('split-user');
  const acc = db.prepare("INSERT INTO accounts (name) VALUES ('Bank')").run().lastInsertRowid;
  const cat = db.prepare("INSERT INTO categories (name) VALUES ('SplitCat')").run().lastInsertRowid;
  const parent = db
    .prepare(`INSERT INTO transactions (date, description, amount, currency, account_id, category_id, dedup_key, split_group)
              VALUES ('2026-05-01', 'Shop', -100, 'EUR', ?, ?, 'split-x', 'grp1')`)
    .run(acc, cat).lastInsertRowid;
  db.prepare(`INSERT INTO transactions (date, description, amount, currency, account_id, category_id, dedup_key, split_group, split_of)
              VALUES ('2026-05-01', 'Shop', -60, 'EUR', ?, ?, 'split-y', 'grp1', ?)`).run(acc, cat, parent);
  db.prepare(`INSERT INTO transactions (date, description, amount, currency, account_id, category_id, dedup_key, split_group, split_of)
              VALUES ('2026-05-01', 'Shop', -40, 'EUR', ?, ?, 'split-z', 'grp1', ?)`).run(acc, cat, parent);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions WHERE split_of = ?').get(parent).c, 2);
  db.prepare('DELETE FROM transactions WHERE id = ?').run(parent);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions WHERE split_of = ?').get(parent).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 0);
  dbm.closeUserDb('split-user');
});

test('foreign keys reject references to missing rows', () => {
  const db = dbm.getUserDb('fk-strict');
  assert.throws(() => {
    db.prepare("INSERT INTO transactions (date, description, amount, currency, dedup_key, category_id) VALUES ('2026-05-01','X',-1,'EUR','fk-c', 999999)").run();
  }, /FOREIGN KEY|constraint/i);
  dbm.closeUserDb('fk-strict');
});

test('dedup keys are migrated to a currency-aware format once', () => {
  // Simulate a legacy DB: rows with currency-less keys and user_version = 0.
  dbm.getUserDb('mig-user');
  dbm.closeUserDb('mig-user');
  const raw = new DatabaseSync(`${dir}/users/mig-user.db`);
  raw.exec('PRAGMA user_version = 0');
  const cat = raw.prepare('SELECT id FROM categories ORDER BY id LIMIT 1').get().id;
  raw.prepare(`INSERT INTO transactions (date, description, amount, currency, category_id, dedup_key)
               VALUES ('2026-05-01','Coffee',-4.5,'EUR',?,'2026-05-01|-4.50|coffee')`).run(cat);
   raw.prepare(`INSERT INTO transactions (date, description, amount, currency, category_id, dedup_key)
                VALUES ('2026-05-02','Coffee',-4.5,'USD',?,'2026-05-02|-4.50|coffee')`).run(cat);
   raw.prepare(`INSERT INTO transactions (date, description, amount, currency, category_id, dedup_key)
                VALUES ('2026-05-03','Recurring',-10,'EUR',?,'rec|7|2026-05')`).run(cat);
   raw.prepare(`INSERT INTO transactions (date, description, amount, currency, category_id, dedup_key)
                VALUES ('2026-05-04','Split part',-5,'EUR',?,'split|7|0')`).run(cat);
   raw.close();

  const db = dbm.getUserDb('mig-user');
  const keys = db.prepare('SELECT dedup_key FROM transactions ORDER BY id').all().map((r) => r.dedup_key);
   assert.deepEqual(keys, [
     '2026-05-01|-4.50|EUR|coffee',
     '2026-05-02|-4.50|USD|coffee',
     'rec|7|2026-05',
     'split|7|0',
   ]);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  // A re-import computes the same key, so it deduplicates against migrated rows.
  assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE dedup_key = '2026-05-01|-4.50|EUR|coffee'").get().c, 1);
  dbm.closeUserDb('mig-user');
});
