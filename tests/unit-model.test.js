import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const { project, currentMonth, addMonths } = await import('../server/services/model.js');
after(() => { cleanup(dir); });

function prepareProjectionData() {
  dbm.getUserDb('proj-user');
  dbm.closeUserDb('proj-user');
  const raw = new DatabaseSync(`${dir}/users/proj-user.db`);
  raw.prepare("INSERT INTO categories (name, monthly_budget) VALUES ('RentX', 1000)").run();
  const acc = raw.prepare("INSERT INTO accounts (name) VALUES ('Bank')").run().lastInsertRowid;
  const from = currentMonth();
  const y = Number(from.split('-')[0]);
  const mo = Number(from.split('-')[1]);
  const anchor = addMonths(from, -3); // three months before the start
  raw.prepare('INSERT INTO balance_observations (account_id, month, balance) VALUES (?, ?, ?)').run(acc, anchor, 5000);
  raw.prepare(`INSERT INTO income_sources (name, current_amount, recurring) VALUES ('Salary', 3000, 1)`).run();
  raw.close();
  return from;
}

test('projection rolls forward when the latest observation predates the start month', () => {
  const from = prepareProjectionData();
  const db = dbm.getUserDb('proj-user');
  const out = dbm.als.run(db, () => project(6, from));
  // free at anchor (5000) + nets for the 2 intervening months (from-2, from-1)
  // + the first forecast month's own net = 5000 + 3 * 2000
  assert.equal(out.anchored_at, addMonths(from, -3));
  const first = out.months[0];
  assert.equal(first.month, from);
  assert.equal(first.free_savings, 5000 + 3 * 2000);
  assert.equal(first.total_predicted, 5000 + 3 * 2000);
  dbm.closeUserDb('proj-user');
});
