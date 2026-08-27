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

// Months remaining INCLUDING the current month: a target in this very month
// still has one contribution window left. 0 once the target date has passed.
// Single source of truth for Funds page and dashboard insights.
export function monthsLeftTo(month, target) {
  return Math.max(0, monthsBetween(month, target) + 1);
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
        `SELECT 1 FROM transactions WHERE category_id = ? AND substr(date,1,7) = ? AND ${NOT_PARENT('transactions')} LIMIT 1`
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
        `SELECT COALESCE(SUM(${FX_MULT} * t.amount),0) AS s
         FROM transactions t ${FX_JOIN}
         WHERE t.category_id = ? AND substr(t.date,1,7) = ? AND ${NOT_PARENT()}`
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

export function baseCurrency() {
  return db.prepare("SELECT value FROM settings WHERE key = 'currency'").get()?.value || 'EUR';
}

// Monthly FX conversion: transactions are multiplied by the rate of their own
// month and currency. Missing rate ⇒ COALESCE keeps it 1:1, and monthView's
// warnings surface how many rows were affected (no silent wrongness).
const FX_JOIN = 'LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency';
const FX_MULT = 'COALESCE(f.rate, 1)';

// Actual spending per category in a month, NET of refunds (spec §3.5):
// negative amounts are spend, positive ones (refunds) offset the same category.
// Foreign-currency amounts are converted to the base currency first.
export function actualByCategory(month) {
  const rows = db
    .prepare(
      `SELECT t.category_id, SUM(${FX_MULT} * t.amount) AS net
       FROM transactions t ${FX_JOIN}
       WHERE substr(t.date,1,7) = ? AND t.category_id IS NOT NULL AND ${NOT_PARENT()}
       GROUP BY t.category_id`
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

// Net change in free savings for a single month: income minus commitment and
// variable outgoings. Shared by the forecast loop and the pre-range roll-forward.
function monthNet(m, cats, coveredCats, commitments) {
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
  return { income: inc.total, outgoings, variable: variableTotal, net: inc.total - outgoings, lines };
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

  // If the latest observation predates the forecast start, start from the
  // observed balance and roll free savings forward to `from` instead of
  // silently ignoring the anchor (its month never appears in the loop).
  if (anchorMonth && anchorMonth < from) {
    const observed = db
      .prepare('SELECT COALESCE(SUM(balance),0) AS s FROM balance_observations WHERE month = ?')
      .get(anchorMonth).s;
    const committedAtAnchor = db
      .prepare('SELECT * FROM funds')
      .all()
      .reduce((s, f) => s + fundBalanceAt(f, anchorMonth), 0);
    free = observed - committedAtAnchor;
    let m = addMonths(anchorMonth, 1);
    while (m < from) {
      free += monthNet(m, cats, coveredCats, commitments).net;
      m = addMonths(m, 1);
    }
  }

  for (let i = 0; i < numMonths; i++) {
    const m = addMonths(from, i);
    const { income: incTotal, outgoings, variable: variableTotal, net, lines } = monthNet(m, cats, coveredCats, commitments);

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
      income: round2(incTotal),
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

function daysInMonth(month) {
  const [year, mo] = month.split('-').map(Number);
  return new Date(year, mo, 0).getDate();
}

function recurringDueWithinDays() {
  const now = new Date();
  const due = [];
  const recurrences = db.prepare('SELECT * FROM recurrences WHERE active = 1').all();

  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    for (const r of recurrences) {
      const day = Math.min(r.day_of_month, daysInMonth(month));
      if (day !== date.getDate() || r.last_posted_month === month) continue;
      due.push({ id: r.id, name: r.name, amount: r.amount, month, day });
    }
  }
  return due;
}

function insightsForMonth(month, view) {
  const insights = [];

  if (view.warnings.needs_review > 0) {
    insights.push({
      kind: 'review',
      severity: 'warning',
      title: 'Transactions need attention',
      message: `${view.warnings.needs_review} transaction${view.warnings.needs_review === 1 ? '' : 's'} still need a category.`,
      link: '/transactions?review=1',
      action: 'Review transactions',
    });
  }

  view.rows
    .filter((r) => r.planned > 0 && r.actual > r.planned)
    .sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned))
    .slice(0, 4)
    .forEach((r) => {
      insights.push({
        kind: 'over-budget',
        severity: 'danger',
        title: `${r.name} is over budget`,
        message: '',
        link: '/budgets',
        action: 'Open budgets',
        fields: { amount_over: round2(r.actual - r.planned) },
      });
    });

  if (month === currentMonth() && view.planned_total > 0) {
    const now = new Date();
    const elapsed = now.getDate() / daysInMonth(month);
    const spent = view.actual_total / view.planned_total;
    if (spent > elapsed + 0.1 && view.actual_total > 0) {
      insights.push({
        kind: 'pace',
        severity: 'warning',
        title: 'Spending is running ahead',
        message: '',
        link: '/',
        action: 'View dashboard',
        fields: { spent_pct: Math.round(spent * 100), elapsed_pct: Math.round(elapsed * 100) },
      });
    }
  }

  db.prepare('SELECT * FROM funds WHERE target_amount IS NOT NULL AND target_amount > 0 AND target_date IS NOT NULL')
    .all()
    .forEach((fund) => {
      const balance = fundBalanceAt(fund, month);
      const missing = round2(fund.target_amount - balance);
      if (missing <= 0.01) return; // goal reached

      const late = Math.max(0, monthsBetween(fund.target_date, month));
      if (late > 0) {
        // overdue goals must not disappear silently
        insights.push({
          kind: 'fund-overdue',
          severity: 'danger',
          title: `${fund.name} goal is overdue`,
          message: '',
          link: '/funds',
          action: 'Open funds',
          fields: { missing, months_late: late },
        });
        return;
      }

      const monthsLeft = monthsLeftTo(month, fund.target_date);
      const monthlyNeed = Math.max(0, missing / Math.max(1, monthsLeft));
      if (monthlyNeed > fund.monthly_contribution + 0.01) {
        insights.push({
          kind: 'fund-goal',
          severity: 'warning',
          title: `${fund.name} needs a higher contribution`,
          message: '',
          link: '/funds',
          action: 'Open funds',
          fields: { monthly_needed: round2(monthlyNeed), target: fund.target_amount },
        });
      }
    });

  if ((view.warnings.unconverted_fx ?? 0) > 0) {
    insights.push({
      kind: 'fx-missing',
      severity: 'warning',
      title: 'Exchange rates missing',
      message: `${view.warnings.unconverted_fx} transaction(s) this month are foreign-currency with no rate and are counted 1:1.`,
      link: '/settings',
      action: 'Open settings',
    });
  }

  const due = month === currentMonth() ? recurringDueWithinDays() : [];
  if (due.length > 0) {
    insights.push({
      kind: 'upcoming',
      severity: 'info',
      title: `${due.length} recurring item${due.length === 1 ? '' : 's'} due soon`,
      message: due.map((r) => r.name).join(', '),
      link: '/recurring',
      action: 'Open recurring',
    });
  }

  return { insights, notification_count: insights.length };
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
  // Month-scoped count for the month being viewed, plus the global queue size.
  const needsReview = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1 AND substr(date,1,7) = ?')
    .get(month).c;
  const needsReviewTotal = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')
    .get().c;
  const unconvertedFx = db
    .prepare(
      `SELECT COUNT(*) AS c FROM transactions t ${FX_JOIN}
       WHERE substr(t.date,1,7) = ? AND t.currency != ? AND f.rate IS NULL AND ${NOT_PARENT()}`
    )
    .get(month, baseCurrency()).c;

  const funds = db
    .prepare('SELECT * FROM funds ORDER BY name')
    .all()
    .map((f) => ({ ...f, balance: round2(fundBalanceAt(f, month)) }));

  const result = {
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
    warnings: {
      untagged_categories: untagged,
      needs_review: needsReview,
      needs_review_total: needsReviewTotal,
      unconverted_fx: unconvertedFx,
    },
  };
  return { ...result, ...insightsForMonth(month, result) };
}

// Scheduled reports: capture any closed months that have activity but no
// snapshot yet. Idempotent and frozen — snapshots are never rewritten.
const MAX_CAPTURE_PER_RUN = 36;

export function ensureMonthlyReports() {
  const cur = currentMonth();
  if (cur <= '0000-00') return 0;
  const missing = db
    .prepare(
      `SELECT DISTINCT substr(date,1,7) AS m FROM transactions t
       WHERE substr(date,1,7) < ? AND NOT EXISTS (
         SELECT 1 FROM monthly_reports r WHERE r.month = substr(t.date,1,7))
       ORDER BY m LIMIT ?`
    )
    .all(cur, MAX_CAPTURE_PER_RUN)
    .map((r) => r.m);
  if (missing.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO monthly_reports
       (month, income, expenses, planned, result, transfer_to_revolut, transaction_count, by_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let captured = 0;
  for (const m of missing) {
    const v = monthView(m);
    const n = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE substr(date,1,7) = ?').get(m).c;
    const byCategory = v.rows
      .filter((r) => r.actual > 0 || r.planned > 0)
      .map((r) => ({ name: r.name, planned: r.planned, actual: r.actual }));
    insert.run(
      m,
      v.income,
      -v.actual_total,
      v.planned_total,
      v.month_result,
      v.transfer_to_revolut,
      n,
      JSON.stringify(byCategory)
    );
    captured++;
  }
  return captured;
}

export function monthlyReportHistory(limit = 60) {
  return db
    .prepare('SELECT * FROM monthly_reports ORDER BY month DESC LIMIT ?')
    .all(limit)
    .map((r) => ({ ...r, by_category: JSON.parse(r.by_category || '[]') }));
}
