import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const categorizer = await import('../server/services/categorizer.js');
const { learnRule, unlearnRule, applyCategorization, categorizeTransaction } = categorizer;
const db = dbm.getUserDb('choice-user');
const run = (fn, ...args) => dbm.als.run(db, fn, ...args);
const q = (sql, ...p) => db.prepare(sql).all(...p);
after(() => {
  cleanup(dir);
});

function setup() {
  db.exec('DELETE FROM transactions');
  db.exec('DELETE FROM category_choice_rule_categories');
  db.exec('DELETE FROM category_choice_rules');
  db.exec('DELETE FROM category_automation_rules');
  db.exec('DELETE FROM category_rules');
  db.exec('DELETE FROM categories');
  const ins = db.prepare('INSERT INTO categories (name) VALUES (?)');
  const household = ins.run('Household').lastInsertRowid;
  const electronics = ins.run('Electronics').lastInsertRowid;
  const groceries = ins.run('Groceries').lastInsertRowid;
  const txIns = db.prepare(
    'INSERT INTO transactions (date, description, amount, dedup_key, needs_review) VALUES (?, ?, ?, ?, 1)',
  );
  txIns.run('2026-01-01', 'AMAZON MARKETPLACE', -30, 'c1');
  txIns.run('2026-01-02', 'REWE SAGT DANKE', -10, 'c2');
  return { household, electronics, groceries };
}

function createChoiceRule(keyword, categoryIds, extra = {}) {
  const r = db
    .prepare(
      `INSERT INTO category_choice_rules (keyword, amount_min, amount_max, account_id, tx_type, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      keyword,
      extra.amount_min ?? null,
      extra.amount_max ?? null,
      extra.account_id ?? null,
      extra.tx_type ?? null,
      extra.enabled === 0 ? 0 : 1,
    );
  const ins = db.prepare(
    'INSERT INTO category_choice_rule_categories (rule_id, category_id) VALUES (?, ?)',
  );
  for (const id of categoryIds) ins.run(r.lastInsertRowid, id);
  return r.lastInsertRowid;
}

test('a choice rule sends matching transactions to review with candidates', () => {
  const { household, electronics } = run(setup);
  run(() => createChoiceRule('amazon', [household, electronics]));
  const [row] = run(() =>
    applyCategorization([{ description: 'AMAZON MARKETPLACE', amount: -30 }]),
  );
  assert.equal(row.suggested_category_id, null);
  assert.equal(row.needs_review, 1);
  assert.equal(row.review_reason, 'choice_rule');
  assert.deepEqual(
    row.choice_candidates.map((c) => c.category_id).sort(),
    [household, electronics].sort(),
  );
});

test('a choice rule overrides a learned keyword rule for the same keyword', () => {
  const { household, electronics, groceries } = run(setup);
  run(() => learnRule('amazon', groceries)); // previously learned
  run(() => createChoiceRule('amazon', [household, electronics]));
  const outcome = run(() => categorizeTransaction({ description: 'amazon', amount: -5 }));
  assert.equal(outcome.choice, true);
  assert.equal(outcome.category_id, undefined);
});

test('an advanced rule outranks a choice rule', () => {
  const { household, electronics, groceries } = run(setup);
  run(() => createChoiceRule('amazon', [household, electronics]));
  db.run;
  run(() =>
    categorizer.createAutomationRule({
      description_contains: 'amazon marketplace',
      category_id: groceries,
      priority: 10,
    }),
  );
  const outcome = run(() =>
    categorizeTransaction({ description: 'AMAZON MARKETPLACE', amount: -5 }),
  );
  assert.equal(outcome.choice, undefined);
  assert.equal(outcome.category_id, groceries);
});

test('disabled choice rules do not fire', () => {
  const { household, electronics, groceries } = run(setup);
  run(() => createChoiceRule('amazon', [household, electronics], { enabled: 0 }));
  run(() => learnRule('amazon', groceries));
  const outcome = run(() => categorizeTransaction({ description: 'amazon', amount: -5 }));
  assert.equal(outcome.category_id, groceries);
});

test('unchecking remember deletes a learned rule unique to that transaction', () => {
  const { groceries } = run(setup);
  const cat = groceries;
  db.prepare(
    "INSERT INTO transactions (date, description, amount, dedup_key, needs_review, category_id) VALUES ('2026-01-01', 'UNIQUE MERCHANT X', -9, 'u1', 0, ?)",
  ).run(cat);
  const tx = q("SELECT id FROM transactions WHERE dedup_key = 'u1'")[0];
  run(() => learnRule('unique merchant x', cat));
  assert.equal(
    q("SELECT COUNT(*) AS c FROM category_rules WHERE keyword = 'unique merchant x'")[0].c,
    1,
  );
  const deleted = run(() => unlearnRule('UNIQUE MERCHANT X', cat, tx.id));
  assert.equal(deleted, true);
  assert.equal(
    q("SELECT COUNT(*) AS c FROM category_rules WHERE keyword = 'unique merchant x'")[0].c,
    0,
  );
});

test('unchecking remember keeps manual and shared rules', () => {
  const { groceries } = run(setup);
  const cat = groceries;
  const ins = db.prepare(
    'INSERT INTO transactions (date, description, amount, dedup_key, needs_review, category_id) VALUES (?, ?, ?, ?, 0, ?)',
  );
  ins.run('2026-01-01', 'AMAZON EU', -9, 's1', cat);
  ins.run('2026-01-02', 'AMAZON DE', -9, 's2', cat);
  const tx1 = q("SELECT id FROM transactions WHERE dedup_key = 's1'")[0];

  // Shared: two categorized transactions with the same keyword
  run(() => learnRule('amazon eu', cat, true, 'learned'));
  db.prepare("UPDATE category_rules SET keyword = 'amazon' WHERE keyword = 'amazon eu'").run();
  let deleted = run(() => unlearnRule('AMAZON EU', cat, tx1.id));
  assert.equal(deleted, false); // 'amazon de' still normalizes to contain 'amazon'
  assert.equal(q("SELECT COUNT(*) AS c FROM category_rules WHERE keyword = 'amazon'")[0].c, 1);

  // Manual: origin='manual' rules are never deleted by un-remember
  db.prepare("UPDATE category_rules SET origin = 'manual' WHERE keyword = 'amazon'").run();
  deleted = run(() =>
    unlearnRule('AMAZON DE', cat, q("SELECT id FROM transactions WHERE dedup_key = 's2'")[0].id),
  );
  assert.equal(deleted, false);
  assert.equal(q("SELECT COUNT(*) AS c FROM category_rules WHERE keyword = 'amazon'")[0].c, 1);
});

test('unchecking remember keeps a rule that was retargeted to another category', () => {
  const { groceries, household } = run(setup);
  db.prepare(
    "INSERT INTO transactions (date, description, amount, dedup_key, needs_review, category_id) VALUES ('2026-01-01', 'RETARGETED SHOP', -9, 'r1', 0, ?)",
  ).run(groceries);
  const tx = q("SELECT id FROM transactions WHERE dedup_key = 'r1'")[0];
  run(() => learnRule('retargeted shop', household));
  const deleted = run(() => unlearnRule('RETARGETED SHOP', groceries, tx.id));
  assert.equal(deleted, false);
  assert.equal(
    q("SELECT COUNT(*) AS c FROM category_rules WHERE keyword = 'retargeted shop'")[0].c,
    1,
  );
});
