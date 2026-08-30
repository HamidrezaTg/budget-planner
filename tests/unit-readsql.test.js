import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const readSql = await import('../server/services/read-sql.js');
const { validateReadOnlySql, runReadOnlySql } = readSql;
const readDb = dbm.getUserDb('read-user');
after(() => { cleanup(dir); });

test('allows a plain SELECT on an allowed table', () => {
  assert.equal(validateReadOnlySql('SELECT * FROM transactions'), 'SELECT * FROM transactions LIMIT 200');
});

test('rejects write/DDL statements', () => {
  const reject = (sql) => assert.throws(() => validateReadOnlySql(sql), /Only SELECT|forbidden|single/);
  reject('DELETE FROM transactions');
  reject('DROP TABLE transactions');
  reject('INSERT INTO transactions VALUES (1)');
  reject('ALTER TABLE transactions ADD COLUMN x');
});

test('rejects multiple statements', () => {
  assert.throws(() => validateReadOnlySql('SELECT 1; SELECT 2'), /single statement/);
});

test('rejects the settings table (holds the AI API key)', () => {
  assert.throws(() => validateReadOnlySql('SELECT * FROM settings'), /not available/);
});

test('rejects arbitrary user limits above the cap', () => {
  assert.throws(() => validateReadOnlySql('SELECT * FROM transactions LIMIT 999999'), /LIMIT may not exceed/);
  assert.equal(validateReadOnlySql('SELECT * FROM transactions LIMIT 50'), 'SELECT * FROM transactions LIMIT 50');
});

test('joins are checked too', () => {
  assert.throws(() => validateReadOnlySql('SELECT * FROM transactions JOIN settings ON 1=1'), /not available/);
  assert.equal(
    validateReadOnlySql('SELECT * FROM transactions JOIN categories ON 1=1'),
    'SELECT * FROM transactions JOIN categories ON 1=1 LIMIT 200'
  );
});

test('comma-join hidden in a subquery is rejected (allowlist bypass)', () => {
  assert.throws(
    () => validateReadOnlySql('SELECT 1 FROM accounts WHERE id IN (SELECT 1 FROM accounts, settings)'),
    /Comma-joined table sources/
  );
  assert.throws(
    () => validateReadOnlySql('SELECT (SELECT count(*) FROM accounts, settings) FROM accounts'),
    /Comma-joined table sources/
  );
});

test('self-joins are rejected (synchronous event-loop DoS)', () => {
  assert.throws(
    () => validateReadOnlySql('SELECT count(*) FROM transactions t1 JOIN transactions t2 ON abs(t1.amount)=abs(t2.amount)'),
    /same table twice/
  );
  assert.throws(
    () => validateReadOnlySql('WITH x AS (SELECT * FROM accounts) SELECT * FROM x JOIN accounts ON 1=1'),
    /same table twice/
  );
  assert.doesNotThrow(() => validateReadOnlySql('SELECT * FROM transactions JOIN categories ON 1=1'));
});

test('a LIMIT inside a string literal cannot suppress the row cap', () => {
  assert.equal(
    validateReadOnlySql("SELECT * FROM transactions WHERE description = 'no limit'"),
    "SELECT * FROM transactions WHERE description = 'no limit' LIMIT 200"
  );
});

test('a LIMIT inside a subquery does not bound the outer result', () => {
  assert.equal(
    validateReadOnlySql('SELECT * FROM transactions WHERE category_id IN (SELECT id FROM categories LIMIT 5)'),
    'SELECT * FROM transactions WHERE category_id IN (SELECT id FROM categories LIMIT 5) LIMIT 200'
  );
  assert.throws(
    () => validateReadOnlySql('SELECT * FROM transactions WHERE category_id IN (SELECT id FROM categories LIMIT 500)'),
    /LIMIT may not exceed/
  );
});

test('execution authorizer rejects disallowed comma-joined tables', () => {
  assert.throws(
    () => dbm.als.run(readDb, () => runReadOnlySql('SELECT * FROM transactions, settings')),
    /Table "settings" is not available|Comma-joined table sources/
  );
  dbm.closeUserDb('read-user');
});
