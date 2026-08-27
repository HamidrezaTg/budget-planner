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

test('execution authorizer rejects disallowed comma-joined tables', () => {
  assert.throws(
    () => dbm.als.run(readDb, () => runReadOnlySql('SELECT * FROM transactions, settings')),
    /Table "settings" is not available|Comma-joined table sources/
  );
  dbm.closeUserDb('read-user');
});
