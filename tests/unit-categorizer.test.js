import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const categorizer = await import('../server/services/categorizer.js');
const { learnRule } = categorizer;
const db = dbm.getUserDb('rule-user');
const run = (fn, ...args) => dbm.als.run(db, fn, ...args);
const q = (sql, ...p) => db.prepare(sql).all(...p);
after(() => { cleanup(dir); });

function setup() {
  db.exec('DELETE FROM transactions');
  db.exec('DELETE FROM category_rules');
  db.exec('DELETE FROM categories');
  const cat = db.prepare('INSERT INTO categories (name) VALUES (?)').run('Groceries').lastInsertRowid;
  const ins = db.prepare(
    'INSERT INTO transactions (date, description, amount, dedup_key, needs_review) VALUES (?, ?, ?, ?, 1)'
  );
  ins.run('2026-01-01', 'REWE SAGT DANKE', -10, 'k1');
  ins.run('2026-01-02', 'Rewe  Market', -20, 'k2');   // substring, extra spacing
  ins.run('2026-01-03', 'NETFLIX  .COM', -12, 'k3');  // needs whitespace normalization
  ins.run('2026-01-04', '50% OFF store', -5, 'k4');   // must NOT match keyword "50"
  ins.run('2026-01-05', 'Other shop', -7, 'k5');
  return cat;
}

test('learnRule retro-applies category AND clears review flag together', () => {
  const cat = run(setup);
  run(() => learnRule('rewe', cat));
  const rows = q("SELECT description, category_id, needs_review FROM transactions ORDER BY id");
  assert.deepEqual(
    rows.map((r) => [r.category_id, r.needs_review]),
    [
      [cat, 0], // exact match after normalization (case-insensitive)
      [cat, 0], // substring match
      [null, 1], // untouched stays in the review queue
      [null, 1],
      [null, 1],
    ]
  );
});

test('learnRule uses import-time normalization, not raw LIKE', () => {
  const cat = run(setup);
  run(() => learnRule('netflix .com', cat));
  const row = q("SELECT category_id, needs_review FROM transactions WHERE description = 'NETFLIX  .COM'")[0];
  assert.equal(row.category_id, cat);
  assert.equal(row.needs_review, 0);
});

test('keywords containing LIKE wildcards do not over-match', () => {
  const cat = run(setup);
  run(() => learnRule('50', cat));
  // "50% OFF store" contains "50" → categorized; nothing else may match
  const matched = q('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?', cat)[0].c;
  assert.equal(matched, 1);
  const flagged = q('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')[0].c;
  assert.equal(flagged, 4);
});
