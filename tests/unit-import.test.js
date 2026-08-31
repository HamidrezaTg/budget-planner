import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const { applyCategorization, createAutomationRule } =
  await import('../server/services/categorizer.js');
const { als } = dbm;
after(() => {
  cleanup(dir);
});

function categorizeWith(db, tx) {
  return als.run(db, () => applyCategorization([tx]))[0];
}

test('account-scoped automation rules only match once the account is assigned', () => {
  const db = dbm.getUserDb('import-acc');
  const accA = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name, kind) VALUES ('CardA', 'revolut')").run(),
  ).lastInsertRowid;
  const accB = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name, kind) VALUES ('CardB', 'sparkasse')").run(),
  ).lastInsertRowid;
  const cat = als.run(db, () =>
    db.prepare("INSERT INTO categories (name) VALUES ('StreamingAcc')").run(),
  ).lastInsertRowid;
  const rule = als.run(db, () =>
    createAutomationRule({
      description_contains: 'Netflix',
      account_id: accA,
      category_id: cat,
    }),
  );
  assert.ok(rule.id);

  // No account assigned -> rule cannot match (account is null).
  let out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: null });
  assert.equal(out.suggested_category_id, null);
  assert.equal(out.needs_review, 1);

  // Wrong account -> no match.
  out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: accB });
  assert.equal(out.suggested_category_id, null);

  // Correct account -> match.
  out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: accA });
  assert.equal(out.suggested_category_id, cat);
  assert.equal(out.needs_review, 0);

  dbm.closeUserDb('import-acc');
});

test('account-agnostic rules match regardless of account', () => {
  const db = dbm.getUserDb('import-any');
  const acc = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name) VALUES ('AnyAcc')").run(),
  ).lastInsertRowid;
  const cat = als.run(db, () =>
    db.prepare("INSERT INTO categories (name) VALUES ('MarketX')").run(),
  ).lastInsertRowid;
  als.run(db, () => createAutomationRule({ description_contains: 'REWE', category_id: cat }));

  const out = categorizeWith(db, { description: 'REWE Berlin', amount: -12.4, account_id: acc });
  assert.equal(out.suggested_category_id, cat);
  dbm.closeUserDb('import-any');
});
