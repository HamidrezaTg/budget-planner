import { db } from '../db.js';

export const monthOf = (dateStr) => dateStr.slice(0, 7);
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthsBetween(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

// Planned amount for a category in a month: explicit budget line overrides,
// otherwise the category's standing monthly plan. Inactive categories plan 0.
// With roll_overs enabled, last month's underspend (only if that month had
// activity in the category) is added to this month's plan.
export function plannedForCategory(cat, month) {
  const active =
    cat.is_active &&
    (!cat.active_from || month >= cat.active_from) &&
    (!cat.active_to || month <= cat.active_to);
  if (!active) return 0;
  const line = db
    .prepare('SELECT planned_amount FROM budget_lines WHERE category_id = ? AND month = ?')
    .get(cat.id, month);
  const base = line ? line.planned_amount : cat.monthly_budget;

  if (!cat.roll_overs) return base;

  const prev = addMonths(month, -1);
  const hadActivity =
    db
      .prepare(
        'SELECT 1 FROM transactions WHERE category_id = ? AND substr(date,1,7) = ? LIMIT 1'
      )
      .get(cat.id, prev);
  if (!hadActivity) return base;

  const prevLine = db
    .prepare('SELECT planned_amount FROM budget_lines WHERE category_id = ? AND month = ?')
    .get(cat.id, prev);
  const prevPlan = prevLine ? prevLine.planned_amount : cat.monthly_budget;
  const prevActual = actualForCategoryMonth(cat.id, prev);
  const carry = Math.max(0, prevPlan - prevActual);
  return base + Math.round(carry * 100) / 100;
}

function actualForCategoryMonth(categoryId, month) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE category_id = ? AND substr(date,1,7) = ? AND ${NOT_PARENT('transactions')}`
      )
      .get(categoryId, month).s * -1
  );
}

export function getAllCategories() {
  return db
    .prepare(
      `SELECT c.*, g.name AS group_name, g.sort AS group_sort, a.name AS account_name
       FROM categories c
       LEFT JOIN category_groups g ON g.id = c.group_id
       LEFT JOIN accounts a ON a.id = c.account_id
       ORDER BY g.sort, c.name`
    )
    .all();
}

// A split parent (has split_group, no split_of) is excluded from all category
// sums — its children carry the amounts.
const NOT_PARENT = (alias = 't') =>
  `NOT (${alias}.split_of IS NULL AND ${alias}.split_group IS NOT NULL)`;

// Actual spending per category in a month, NET of refunds (spec §3.5):
// negative amounts are spend, positive ones (refunds) offset the same category.
export function actualByCategory(month) {
  const rows = db
    .prepare(
      `SELECT category_id, SUM(amount) AS net
       FROM transactions
       WHERE substr(date,1,7) = ? AND category_id IS NOT NULL AND ${NOT_PARENT('transactions')}
       GROUP BY category_id`
    )
    .all(month);
  const map = {};
  for (const r of rows) map[r.category_id] = -r.net;
  return map;
}

export function incomeForMonth(month) {
  const sources = db.prepare('SELECT * FROM income_sources ORDER BY id').all();
  let total = 0;
  const parts = sources.map((s) => {
    const entry = db
      .prepare('SELECT amount FROM income_entries WHERE source_id = ? AND month = ?')
      .get(s.id, month);
    const amount = entry ? entry.amount : s.recurring ? s.current_amount : 0;
    total += amount;
    return { source: s, amount };
  });
  return { total, parts };
}

// Sum of planned spend on Revolut-tagged categories — the monthly transfer.
export function transferToRevolut(month) {
  const cats = db
    .prepare(
      `SELECT c.* FROM categories c JOIN accounts a ON a.id = c.account_id
       WHERE a.kind = 'revolut'`
    )
    .all();
  return cats.reduce((sum, c) => sum + plannedForCategory(c, month), 0);
}

// Fund running balance at end of `month` (can go negative by design).
export function fundBalanceAt(fund, month) {
  let bal = fund.opening_balance;
  if (month >= fund.start_month && fund.monthly_contribution) {
    bal += fund.monthly_contribution * (monthsBetween(fund.start_month, month) + 1);
  }
  const moved = db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) AS s FROM fund_movements WHERE fund_id = ? AND month <= ?'
    )
    .get(fund.id, month).s;
  return bal + moved;
}

export function committedSavingsAt(month) {
  return db
    .prepare('SELECT * FROM funds')
    .all()
    .reduce((s, f) => s + fundBalanceAt(f, month), 0);
}

function latestAnchor(from) {
  // most recent month with at least one observation
  const row = db
    .prepare(
      `SELECT MAX(month) AS m FROM balance_observations WHERE month <= ?`
    )
    .get(from);
  return row?.m || null;
}

// Projection: income minus outgoings rolled forward, commitments dropping out
// at their end dates. Re-anchors to the latest observed bank balance (spec §7).
export function project(numMonths = 96, from = currentMonth()) {
  const cats = getAllCategories().filter((c) => !c.account_name || c.account_name !== null);
  // categories whose spend is already represented by a linked commitment
  const coveredCats = new Set(
    db
      .prepare('SELECT DISTINCT category_id FROM commitments WHERE category_id IS NOT NULL')
      .all()
      .map((r) => r.category_id)
  );

  const commitments = db.prepare('SELECT * FROM commitments ORDER BY name').all();

  const anchorMonth = latestAnchor(from);

  const months = [];
  let free = 0;
  let varianceAtAnchor = null;

  for (let i = 0; i < numMonths; i++) {
    const m = addMonths(from, i);
    const inc = incomeForMonth(m);

    let outgoings = 0;
    const lines = [];
    for (const cm of commitments) {
      if (m >= cm.start_month && (!cm.end_month || m <= cm.end_month)) {
        outgoings += cm.monthly_amount;
        lines.push({ name: cm.name, amount: cm.monthly_amount });
      }
    }
    let variableTotal = 0;
    for (const c of cats) {
      if (coveredCats.has(c.id)) continue;
      const p = plannedForCategory(c, m);
      if (p) variableTotal += p;
    }
    outgoings += variableTotal;

    const net = inc.total - outgoings;

    // re-anchor: once we pass an observed month, shift so totals match reality
    if (anchorMonth && m === anchorMonth) {
      const observed = db
        .prepare('SELECT COALESCE(SUM(balance),0) AS s FROM balance_observations WHERE month = ?')
        .get(anchorMonth).s;
      const committed = db
        .prepare('SELECT * FROM funds')
        .all()
        .reduce((s, f) => s + fundBalanceAt(f, anchorMonth), 0);
      const predicted = free + net + committed;
      varianceAtAnchor = predicted - observed;
      free += net - varianceAtAnchor; // absorb drift, continue from reality
    } else {
      free += net;
    }

    const committed = committedSavingsAt(m);
    months.push({
      month: m,
      income: round2(inc.total),
      commitments: round2(lines.reduce((s, l) => s + l.amount, 0)),
      variable: round2(variableTotal),
      outgoings: round2(outgoings),
      net: round2(net),
      free_savings: round2(free),
      committed_savings: round2(committed),
      total_predicted: round2(free + committed),
      active_commitments: lines.map((l) => l.name),
    });
  }

  return { from, horizon: numMonths, anchored_at: anchorMonth, variance_at_anchor: varianceAtAnchor, months };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Full picture for one month (dashboard / reports)
export function monthView(month) {
  const cats = getAllCategories();
  const actuals = actualByCategory(month);
  const rows = cats.map((c) => {
    const planned = plannedForCategory(c, month);
    const actualNet = actuals[c.id] ?? 0;
    return {
      id: c.id,
      name: c.name,
      group: c.group_name,
      group_sort: c.group_sort ?? 99,
      color: c.account_name === 'Revolut' ? '#63C3AC' : '#5E8BD9',
      account: c.account_name,
      planned,
      actual: round2(actualNet),
      difference: round2(planned - actualNet),
    };
  });

  const groupsMap = {};
  for (const r of rows) {
    const g = r.group ?? 'Ungrouped';
    groupsMap[g] ??= { name: g, sort: r.group_sort, planned: 0, actual: 0, difference: 0, rows: [] };
    groupsMap[g].planned += r.planned;
    groupsMap[g].actual += r.actual;
    groupsMap[g].difference += r.difference;
    groupsMap[g].rows.push(r);
  }
  const groups = Object.values(groupsMap).sort((a, b) => a.sort - b.sort);

  const totalsPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalsActual = rows.reduce((s, r) => s + r.actual, 0);
  const inc = incomeForMonth(month);

  const untagged = cats.filter((c) => !c.account_id && c.is_active).map((c) => c.name);
  const needsReview = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')
    .get().c;

  const funds = db
    .prepare('SELECT * FROM funds ORDER BY name')
    .all()
    .map((f) => ({ ...f, balance: round2(fundBalanceAt(f, month)) }));

  return {
    month,
    groups,
    rows,
    income: round2(inc.total),
    incomeParts: inc.parts.map((p) => ({
      source: p.source.name,
      person: p.source.person_id
        ? db.prepare('SELECT name FROM persons WHERE id = ?').get(p.source.person_id)?.name
        : null,
      amount: p.amount,
    })),
    planned_total: round2(totalsPlanned),
    actual_total: round2(totalsActual),
    month_result: round2(totalsPlanned - totalsActual),
    transfer_to_revolut: round2(transferToRevolut(month)),
    funds,
    warnings: { untagged_categories: untagged, needs_review: needsReview },
  };
}
