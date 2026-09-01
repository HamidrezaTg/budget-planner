import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const {
  project,
  currentMonth,
  addMonths,
  plannedForCategory,
  monthView,
  actualByCategory,
  fundBalanceAt,
  accountBalanceAt,
  convertCurrency,
  transferToRevolut,
  completedTransferToRevolut,
} = await import('../server/services/model.js');
after(() => {
  cleanup(dir);
});

function prepareProjectionData() {
  dbm.getUserDb('proj-user');
  dbm.closeUserDb('proj-user');
  const raw = new DatabaseSync(`${dir}/users/proj-user.db`);
  raw.prepare("INSERT INTO categories (name, monthly_budget) VALUES ('RentX', 1000)").run();
  const acc = raw.prepare("INSERT INTO accounts (name) VALUES ('Bank')").run().lastInsertRowid;
  const from = currentMonth();
  const anchor = addMonths(from, -3); // three months before the start
  raw
    .prepare('INSERT INTO balance_observations (account_id, month, balance) VALUES (?, ?, ?)')
    .run(acc, anchor, 5000);
  raw
    .prepare(
      `INSERT INTO income_sources (name, current_amount, recurring) VALUES ('Salary', 3000, 1)`,
    )
    .run();
  raw.close();
  return from;
}

test('projection rolls forward when the latest observation predates the start month', () => {
  const from = prepareProjectionData();
  const db = dbm.getUserDb('proj-user');
  const out = dbm.als.run(db, () => project(6, from));
  const scenario = dbm.als.run(db, () =>
    project(6, from, {
      monthly_income_delta: 100,
      monthly_outgoings_delta: 0,
      one_offs: [],
    }),
  );
  // The test only creates a Bank account with opening_balance 0; the anchor
  // observed is 5000 and the model sees 2000/month net income with no spend,
  // so predicted total at the anchor = 5000 (the observed). The 2 intervening
  // months + the first forecast month roll free forward by 3 * 2000, but
  // free_savings is the liquid portion = total - committed - opening.
  assert.equal(out.anchored_at, addMonths(from, -3));
  const first = out.months[0];
  assert.equal(first.month, from);
  assert.equal(first.total_predicted, 5000 + 3 * 2000);
  assert.equal(scenario.anchored_at, out.anchored_at);
  assert.equal(scenario.months[0].total_predicted - first.total_predicted, 100);
  dbm.closeUserDb('proj-user');
});

test('account balances remain in account currency while aggregate conversion uses FX rates', () => {
  const db = dbm.getUserDb('currency-user');
  dbm.als.run(db, () => {
    const account = db
      .prepare(
        "INSERT INTO accounts (name, display_currency, opening_balance) VALUES ('USD bank', 'USD', 100)",
      )
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO transactions (date, description, amount, currency, account_id, dedup_key)
       VALUES ('2026-08-15', 'Pay', -10, 'USD', ?, 'currency-test')`,
    ).run(account);
    db.prepare(
      "INSERT INTO fx_rates (month, currency, rate, source) VALUES ('2026-08', 'USD', 0.9, 'manual')",
    ).run();
    assert.equal(accountBalanceAt(account, '2026-08'), 90);
    assert.equal(convertCurrency(90, 'USD', 'EUR', '2026-08'), 81);
  });
  dbm.closeUserDb('currency-user');
});

test('budget rollover accumulates across multiple months', () => {
  const db = dbm.getUserDb('roll-user');
  dbm.als.run(db, () => {
    const setup = (sql, ...args) => db.prepare(sql).run(...args);
    setup(`INSERT INTO categories (name, monthly_budget, roll_overs) VALUES ('RollCat', 100, 1)`);
    const catId = db.prepare("SELECT id FROM categories WHERE name = 'RollCat'").get().id;
    const accId = setup(`INSERT INTO accounts (name) VALUES ('B')`).lastInsertRowid;
    const m0 = addMonths(currentMonth(), -3);
    const m1 = addMonths(currentMonth(), -2);
    const m2 = addMonths(currentMonth(), -1);
    const m3 = currentMonth();
    // Activity + tiny spend each month: 10 of 100(+carry) spent each time.
    for (const [m, day] of [
      [m0, '05'],
      [m1, '05'],
      [m2, '05'],
    ]) {
      setup(
        `INSERT INTO transactions (date, description, amount, currency, category_id, account_id, dedup_key)
         VALUES (?, 'spend', -10, 'EUR', ?, ?, ?)`,
        `${m}-${day}`,
        catId,
        accId,
        `roll-${m}`,
      );
    }
    // m3 planning: m2 effective plan = 100 + carry(m1) ...
    const planned = plannedForCategory(
      { id: catId, is_active: 1, monthly_budget: 100, roll_overs: 1 },
      m3,
    );
    // Three months of 10/100 spending: carries 90, 180, 270 → month 3 = 100+270.
    assert.equal(planned, 100 + 270);
  });
  dbm.closeUserDb('roll-user');
});

// ----------------- v3.11: transfer rows + fund-linked transactions -------

test('transfer rows are excluded from category spend and from month totals', () => {
  const db = dbm.getUserDb('xfer-user');
  dbm.als.run(db, () => {
    const setup = (sql, ...args) => db.prepare(sql).run(...args);
    // Wipe the seed data so we can use 'Bank' and 'Card' as test account names.
    setup('DELETE FROM transactions');
    setup('DELETE FROM attachments');
    setup('DELETE FROM fund_movements');
    setup('DELETE FROM funds');
    setup('DELETE FROM balance_observations');
    setup('DELETE FROM income_entries');
    setup('DELETE FROM income_sources');
    setup('DELETE FROM recurrences');
    setup('DELETE FROM budget_lines');
    setup('DELETE FROM commitments');
    setup('DELETE FROM category_rules');
    setup('DELETE FROM category_automation_rules');
    setup('DELETE FROM categories');
    setup('DELETE FROM category_groups');
    setup('DELETE FROM accounts');
    const acc = setup("INSERT INTO accounts (name) VALUES ('Bank')").lastInsertRowid;
    const card = setup("INSERT INTO accounts (name) VALUES ('Card')").lastInsertRowid;
    const cat = setup(
      "INSERT INTO categories (name, account_id) VALUES ('Groceries', ?)",
      card,
    ).lastInsertRowid;
    const m = currentMonth();
    // 80 of real groceries.
    setup(
      `INSERT INTO transactions (date, description, amount, currency, category_id, account_id, dedup_key)
       VALUES (?, 'REWE', -80, 'EUR', ?, ?, 'groc')`,
      `${m}-05`,
      cat,
      card,
    );
    // 100 transfer out of Bank, 100 transfer into Card — both sides get a
    // shared transfer_group, so neither counts.
    setup(
      `INSERT INTO transactions (date, description, amount, currency, account_id, transfer_group, dedup_key)
       VALUES (?, 'TOP-UP', -100, 'EUR', ?, 'tg-1', 'xfer-a')`,
      `${m}-01`,
      acc,
    );
    setup(
      `INSERT INTO transactions (date, description, amount, currency, account_id, transfer_group, dedup_key)
       VALUES (?, 'TOP-UP', 100, 'EUR', ?, 'tg-1', 'xfer-b')`,
      `${m}-01`,
      card,
    );

    // Only Groceries should be in the category sum (80).
    const actuals = actualByCategory(m);
    assert.equal(actuals[cat], 80);

    // monthView.actual_total should equal -80, not 0 (transfer cancels) and
    // not 100 (transfer counted).
    const view = monthView(m);
    assert.equal(view.actual_total, 80);
  });
  dbm.closeUserDb('xfer-user');
});

test('Revolut transfer need subtracts completed incoming transfers', () => {
  const db = dbm.getUserDb('revolut-user');
  dbm.als.run(db, () => {
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM accounts').run();
    const revolut = db
      .prepare("INSERT INTO accounts (name, kind) VALUES ('Sparkasse Revolut', 'card')")
      .run().lastInsertRowid;
    db.prepare(
      "INSERT INTO categories (name, monthly_budget, account_id) VALUES ('Daily spend', 250, ?)",
    ).run(revolut);
    const month = currentMonth();
    db.prepare(
      `INSERT INTO transactions (date, description, amount, currency, account_id, transfer_group, dedup_key)
       VALUES (?, 'Top up', 100, 'EUR', ?, 'transfer-1', 'revolut-transfer')`,
    ).run(`${month}-01`, revolut);
    assert.equal(completedTransferToRevolut(month), 100);
    assert.equal(transferToRevolut(month), 150);
    db.prepare('UPDATE transactions SET amount = 300').run();
    assert.equal(transferToRevolut(month), 0);
  });
  dbm.closeUserDb('revolut-user');
});

test('a transaction linked to a fund draws the fund balance down', () => {
  const db = dbm.getUserDb('fund-spend-user');
  dbm.als.run(db, () => {
    const setup = (sql, ...args) => db.prepare(sql).run(...args);
    const acc = setup("INSERT INTO accounts (name) VALUES ('Bank')").lastInsertRowid;
    const cat = setup("INSERT INTO categories (name) VALUES ('Vet')").lastInsertRowid;
    const m = currentMonth();
    const fund = setup(
      `INSERT INTO funds (name, start_month, monthly_contribution, opening_balance) VALUES (?, ?, 50, 0)`,
      'Vet fund',
      m,
    );
    setup(
      `INSERT INTO transactions (date, description, amount, currency, category_id, account_id, fund_id, dedup_key)
       VALUES (?, 'Vet bill', -30, 'EUR', ?, ?, ?, 'vet-1')`,
      `${m}-10`,
      cat,
      acc,
      fund.lastInsertRowid,
    );
    // The fund balance = opening 0 + 1 month × 50 contribution − 30 vet bill = 20.
    const bal = fundBalanceAt(
      db.prepare('SELECT * FROM funds WHERE id = ?').get(fund.lastInsertRowid),
      m,
    );
    assert.equal(Math.round(bal * 100) / 100, 20);
  });
  dbm.closeUserDb('fund-spend-user');
});

test('projection includes per-account opening_balance in the total predicted', () => {
  const db = dbm.getUserDb('opening-user');
  const from = dbm.als.run(db, () => {
    db.prepare("INSERT INTO accounts (name, opening_balance) VALUES ('Bank', 1000)").run();
    db.prepare(
      `INSERT INTO income_sources (name, current_amount, recurring) VALUES ('Salary', 0, 1)`,
    ).run();
    return currentMonth();
  });
  const out = dbm.als.run(db, () => project(2, from));
  // No anchor, no commitments, no categories → total predicted equals
  // sum of every account's predicted balance (opening + sum of transactions
  // on that account) at the forecast month. With one account at 1000 and no
  // transactions, the total is 1000.
  assert.equal(out.anchored_at, null);
  for (const m of out.months) {
    assert.equal(m.total_predicted, 1000);
  }
  dbm.closeUserDb('opening-user');
});

test('projection applies transient monthly and one-off scenario deltas', () => {
  const db = dbm.getUserDb('scenario-model-user');
  const from = dbm.als.run(db, () => {
    db.prepare("UPDATE income_sources SET current_amount = 1000 WHERE name = 'Salary'").run();
    return currentMonth();
  });

  const baseline = dbm.als.run(db, () => project(2, from));
  const scenario = dbm.als.run(db, () =>
    project(2, from, {
      monthly_income_delta: 200,
      monthly_outgoings_delta: 50,
      one_offs: [{ month: addMonths(from, 1), amount: 100 }],
    }),
  );

  assert.equal(baseline.months[0].net, 1000);
  assert.equal(scenario.months[0].income, 1200);
  assert.equal(scenario.months[0].outgoings, 50);
  assert.equal(scenario.months[0].net, 1150);
  assert.equal(scenario.months[1].outgoings, 150);
  assert.equal(scenario.months[1].net, 1050);
  assert.equal(scenario.months[1].total_predicted - baseline.months[1].total_predicted, 200);
  dbm.closeUserDb('scenario-model-user');
});
