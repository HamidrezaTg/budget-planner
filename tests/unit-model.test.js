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
  fundCashFlowsAt,
  fundBalanceAt,
  accountBalanceAt,
  convertCurrency,
  transferToRevolut,
  completedTransferToRevolut,
  incomeForMonth,
  fundContributionForMonth,
} = await import('../server/services/model.js');
const { ensureCommitmentCategory, retireCommitmentCategory } = dbm;
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

test('income follows its start and end months; out-of-period actuals count as zero', () => {
  const username = 'income-schedule-user';
  const db = dbm.getUserDb(username);
  const start = addMonths(currentMonth(), 1);
  const end = addMonths(currentMonth(), 2);
  const after = addMonths(currentMonth(), 3);
  const sourceId = db
    .prepare(
      `INSERT INTO income_sources (name, current_amount, recurring, start_month, end_month)
     VALUES ('Future salary', 2500, 1, ?, ?)`,
    )
    .run(start, end).lastInsertRowid;

  assert.equal(dbm.als.run(db, () => incomeForMonth(currentMonth())).total, 0);
  assert.equal(dbm.als.run(db, () => incomeForMonth(start)).total, 2500);
  assert.equal(dbm.als.run(db, () => incomeForMonth(end)).total, 2500);
  assert.equal(dbm.als.run(db, () => incomeForMonth(after)).total, 0);

  // A recorded actual outside the period is masked to zero (the schedule
  // governs everything); the row itself stays in the database untouched.
  db.prepare('INSERT INTO income_entries (source_id, month, amount) VALUES (?, ?, ?)').run(
    sourceId,
    after,
    900,
  );
  assert.equal(dbm.als.run(db, () => incomeForMonth(after)).total, 0);
  assert.equal(
    db
      .prepare('SELECT amount FROM income_entries WHERE source_id = ? AND month = ?')
      .get(sourceId, after)?.amount,
    900,
  );
  // Inside the period an actual overrides the usual amount.
  db.prepare('INSERT INTO income_entries (source_id, month, amount) VALUES (?, ?, ?)').run(
    sourceId,
    start,
    2800,
  );
  assert.equal(dbm.als.run(db, () => incomeForMonth(start)).total, 2800);
  // A source with no end month continues indefinitely.
  const openId = db
    .prepare(
      `INSERT INTO income_sources (name, current_amount, recurring, start_month)
     VALUES ('Ongoing rent income', 300, 1, ?)`,
    )
    .run(addMonths(currentMonth(), -2)).lastInsertRowid;
  assert.equal(
    dbm.als
      .run(db, () => incomeForMonth(addMonths(currentMonth(), 24)))
      .parts.find((p) => p.source.id === openId).amount,
    300,
  );
  dbm.closeUserDb(username);
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

test('fund cash-flow totals include every source and reconcile with the balance', () => {
  const db = dbm.getUserDb('fund-reconcile-user');
  dbm.als.run(db, () => {
    const setup = (sql, ...args) => db.prepare(sql).run(...args);
    const month = currentMonth();
    const prior = addMonths(month, -1);
    const account = setup(
      "INSERT INTO accounts (name) VALUES ('Fund reconciliation bank')",
    ).lastInsertRowid;
    const fund = setup(
      `INSERT INTO funds (name, start_month, monthly_contribution, opening_balance)
       VALUES ('Reconciled fund', ?, 100, 50)`,
      prior,
    ).lastInsertRowid;
    setup(
      `INSERT INTO fund_movements (fund_id, month, amount, kind) VALUES (?, ?, 25, 'contribution')`,
      fund,
      prior,
    );
    setup(
      `INSERT INTO fund_movements (fund_id, month, amount, kind) VALUES (?, ?, -40, 'withdrawal')`,
      fund,
      month,
    );
    setup(
      `INSERT INTO transactions (date, description, amount, currency, account_id, fund_id, dedup_key)
       VALUES (?, 'Fund bill', -80, 'EUR', ?, ?, 'fund-reconcile-bill')`,
      `${prior}-05`,
      account,
      fund,
    );
    setup(
      `INSERT INTO transactions (date, description, amount, currency, account_id, fund_id, dedup_key)
       VALUES (?, 'Fund refund', 15, 'EUR', ?, ?, 'fund-reconcile-refund')`,
      `${month}-05`,
      account,
      fund,
    );
    setup(
      `INSERT INTO transactions (date, description, amount, currency, account_id, fund_id, transfer_group, dedup_key)
       VALUES (?, 'Internal transfer', 1000, 'EUR', ?, ?, 'fund-transfer', 'fund-reconcile-transfer')`,
      `${month}-06`,
      account,
      fund,
    );

    const fundRow = db.prepare('SELECT * FROM funds WHERE id = ?').get(fund);
    const flows = fundCashFlowsAt(fundRow, month);
    assert.equal(flows.contributed, 290); // opening 50 + 2 × 100 + 25 + refund 15
    assert.equal(flows.withdrawn, 120); // manual 40 + linked bill 80
    assert.equal(flows.balance, 170);
    assert.equal(fundBalanceAt(fundRow, month), flows.balance);
    assert.equal(flows.contributed - flows.withdrawn, fundBalanceAt(fundRow, month));
  });
  dbm.closeUserDb('fund-reconcile-user');
});

test('scheduled fund contributions reduce free cash while increasing reserved savings', () => {
  const db = dbm.getUserDb('fund-projection-user');
  dbm.als.run(db, () => {
    const month = currentMonth();
    db.prepare(
      `INSERT INTO funds (name, start_month, monthly_contribution, opening_balance)
       VALUES ('Projection fund', ?, 50, 0)`,
    ).run(month);
    db.prepare("INSERT INTO categories (name, monthly_budget) VALUES ('Normal plan', 100)").run();
    const out = project(1, month);
    const row = out.months[0];
    assert.equal(fundContributionForMonth(month), 50);
    assert.equal(row.variable, 100);
    assert.equal(row.fund_contributions, 50);
    assert.equal(row.outgoings, 150);
    assert.equal(row.net, -150);
    assert.equal(row.committed_savings, 50);
    assert.equal(row.total_predicted, -100);
  });
  dbm.closeUserDb('fund-projection-user');
});

test('fund-funded spending gets a one-month category plan and remains actual spending', () => {
  const db = dbm.getUserDb('fund-category-user');
  dbm.als.run(db, () => {
    const month = currentMonth();
    const account = db
      .prepare("INSERT INTO accounts (name) VALUES ('Fund bank')")
      .run().lastInsertRowid;
    const category = db
      .prepare("INSERT INTO categories (name, monthly_budget) VALUES ('Trip budget', 40)")
      .run().lastInsertRowid;
    const fund = db
      .prepare(
        "INSERT INTO funds (name, start_month, monthly_contribution) VALUES ('Trip fund', ?, 0)",
      )
      .run(month).lastInsertRowid;
    db.prepare(
      `INSERT INTO transactions (date, description, amount, account_id, category_id, fund_id, dedup_key)
       VALUES (?, 'Trip bill', -100, ?, ?, ?, 'fund-category-bill')`,
    ).run(`${month}-10`, account, category, fund);
    const row = monthView(month).rows.find((item) => item.id === category);
    assert.equal(row.planned, 140);
    assert.equal(row.actual, 100);
    assert.equal(row.budget_actual, 100);
    assert.equal(row.budget_difference, 40);
  });
  dbm.closeUserDb('fund-category-user');
});

test('commitments get dated Loan categories and are counted once in projection', () => {
  const db = dbm.getUserDb('commitment-category-user');
  dbm.als.run(db, () => {
    const month = currentMonth();
    const id = db
      .prepare(
        `INSERT INTO commitments (name, monthly_amount, start_month, end_month)
         VALUES ('Installment', 125, ?, ?)`,
      )
      .run(month, addMonths(month, 2)).lastInsertRowid;
    const commitment = db.prepare('SELECT * FROM commitments WHERE id = ?').get(id);
    const categoryId = ensureCommitmentCategory(db, commitment);
    const category = db
      .prepare(
        `SELECT c.*, g.name AS group_name FROM categories c
         JOIN category_groups g ON g.id = c.group_id WHERE c.id = ?`,
      )
      .get(categoryId);
    assert.equal(category.group_name, 'Loans');
    assert.equal(category.monthly_budget, 125);
    assert.equal(category.active_from, month);
    assert.equal(category.active_to, addMonths(month, 2));
    const row = project(1, month).months[0];
    assert.equal(row.commitments, 125);
    assert.equal(row.variable, 0);
    assert.equal(row.outgoings, 125);
    retireCommitmentCategory(db, db.prepare('SELECT * FROM commitments WHERE id = ?').get(id));
    assert.equal(
      db.prepare('SELECT monthly_budget, is_active FROM categories WHERE id = ?').get(categoryId)
        .monthly_budget,
      0,
    );
  });
  dbm.closeUserDb('commitment-category-user');
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
