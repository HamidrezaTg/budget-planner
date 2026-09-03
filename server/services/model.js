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
// activity in the category) is added to this month's plan — and that carry
// accumulates: the previous month's effective plan already contains its own
// carry, so underspend survives multiple quiet months. Lookback is capped at
// 24 months to bound the recursion in long projections.
export function plannedForCategory(cat, month, depth = 24) {
  const active =
    cat.is_active &&
    (!cat.active_from || month >= cat.active_from) &&
    (!cat.active_to || month <= cat.active_to);
  if (!active) return 0;
  const line = db
    .prepare('SELECT planned_amount FROM budget_lines WHERE category_id = ? AND month = ?')
    .get(cat.id, month);
  // A fund is not a recurring category. When its bill arrives, however, the
  // linked category gets a one-month plan addition so the exceptional spend is
  // visible in the category budget for the month it actually happened.
  const fundAddition = db
    .prepare(
      `SELECT COALESCE(SUM(-${FX_MULT} * t.amount), 0) AS amount
       FROM transactions t ${FX_JOIN}
       WHERE t.category_id = ? AND t.fund_id IS NOT NULL AND t.amount < 0
         AND substr(t.date,1,7) = ? AND ${NOT_COUNTED()}`,
    )
    .get(cat.id, month).amount;
  const base = (line ? line.planned_amount : cat.monthly_budget) + Math.max(0, fundAddition);

  if (!cat.roll_overs) return base;

  const prev = addMonths(month, -1);
  const hadActivity = db
    .prepare(
      `SELECT 1 FROM transactions WHERE category_id = ? AND substr(date,1,7) = ? AND ${NOT_PARENT('transactions')} LIMIT 1`,
    )
    .get(cat.id, prev);
  if (!hadActivity || depth <= 0) return base;

  // Previous month's EFFECTIVE plan (base + its own carry), not its base —
  // otherwise underspend older than one month silently vanished.
  const prevPlan = plannedForCategory(cat, prev, depth - 1);
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
         WHERE t.category_id = ? AND substr(t.date,1,7) = ? AND ${NOT_COUNTED()}`,
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
       ORDER BY g.sort, c.name`,
    )
    .all();
}

// A split parent (has split_group, no split_of) is excluded from all category
// sums — its children carry the amounts.
const NOT_PARENT = (alias = 't') =>
  `NOT (${alias}.split_of IS NULL AND ${alias}.split_group IS NOT NULL)`;

// Bank↔card transfer rows (linked by transfer_group) are movements between
// the user's own accounts. They MUST NOT show up as spend or income on the
// dashboard, projection, or reports — otherwise a single transfer inflates
// both "Card" spend and "Bank" income. Every sum below uses NOT_TRANSFER.
const NOT_TRANSFER = (alias = 't') => `${alias}.transfer_group IS NULL`;

// Combined predicate for sums: skip split parents and transfer rows.
const NOT_COUNTED = (alias = 't') => `${NOT_PARENT(alias)} AND ${NOT_TRANSFER(alias)}`;

export function baseCurrency() {
  return db.prepare("SELECT value FROM settings WHERE key = 'currency'").get()?.value || 'EUR';
}

export function fxRate(month, currency) {
  if (!currency || currency === baseCurrency()) return 1;
  return (
    db.prepare('SELECT rate FROM fx_rates WHERE month = ? AND currency = ?').get(month, currency)
      ?.rate ?? 1
  );
}

export function convertCurrency(amount, fromCurrency, toCurrency, month) {
  if (fromCurrency === toCurrency) return amount;
  return (amount * fxRate(month, fromCurrency)) / fxRate(month, toCurrency);
}

function observedTotalAt(month) {
  const rows = db
    .prepare(
      `SELECT o.balance, a.display_currency FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id WHERE o.month = ?`,
    )
    .all(month);
  return rows.reduce(
    (sum, row) => sum + convertCurrency(row.balance, row.display_currency, baseCurrency(), month),
    0,
  );
}

// Calculated account balance at end of `month`. Transaction-based: opening
// balance plus every transaction on the account through `month`. When the
// account has an `opening_balance_month`, the opening balance was true at the
// END of that month (which is the same point as the start of the next month),
// so only transactions strictly AFTER that month are added; months before the
// baseline are unknown and return null. Without a baseline month the legacy
// behavior applies: the opening balance covers all history.
export function accountBalanceAt(accountId, month) {
  const account = db
    .prepare(
      'SELECT id, opening_balance, opening_balance_month, display_currency FROM accounts WHERE id = ?',
    )
    .get(accountId);
  if (!account) return 0;
  const baseline = account.opening_balance_month;
  if (baseline && month < baseline) return null;
  const transactions = db
    .prepare(
      `SELECT amount, currency, substr(date,1,7) AS month FROM transactions
       WHERE account_id = ? AND substr(date,1,7) <= ?
         AND (? IS NULL OR substr(date,1,7) > ?)
         AND NOT (split_of IS NULL AND split_group IS NOT NULL)`,
    )
    .all(accountId, month, baseline, baseline);
  return transactions.reduce(
    (sum, tx) => sum + convertCurrency(tx.amount, tx.currency, account.display_currency, tx.month),
    account.opening_balance,
  );
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
       WHERE substr(t.date,1,7) = ? AND t.category_id IS NOT NULL AND ${NOT_COUNTED()}
       GROUP BY t.category_id`,
    )
    .all(month);
  const map = {};
  for (const r of rows) map[r.category_id] = -r.net;
  return map;
}

// Break category actuals into the portions paid from a fund or attributed to a
// commitment. `actual` remains the existing net category actual; coverage only
// describes negative (spending) rows and therefore cannot turn refunds into
// covered budget. A row carrying both links is covered once in budget_actual.
export function actualCoverageByCategory(month) {
  const rows = db
    .prepare(
      `SELECT t.category_id, ${FX_MULT} * t.amount AS amount,
              t.fund_id, t.commitment_id
       FROM transactions t ${FX_JOIN}
       WHERE substr(t.date,1,7) = ? AND t.category_id IS NOT NULL AND ${NOT_COUNTED()}`,
    )
    .all(month);
  const map = {};
  for (const row of rows) {
    const item = (map[row.category_id] ??= {
      total_actual: 0,
      actual_total: 0,
      fund_covered: 0,
      commitment_covered: 0,
    });
    item.total_actual -= row.amount;
    item.actual_total = item.total_actual;
    if (row.amount >= 0) continue;
    const spent = -row.amount;
    if (row.fund_id != null) item.fund_covered += spent;
    if (row.commitment_id != null) item.commitment_covered += spent;
  }
  for (const item of Object.values(map)) {
    // A fund/commitment link explains how a transaction is paid; it does not
    // remove the purchase from the category's budget actual. Fund purchases
    // receive a one-month plan addition in plannedForCategory instead.
    item.budget_actual = Math.max(0, item.total_actual);
    item.uncovered_amount = item.budget_actual;
    item.uncovered = item.budget_actual;
  }
  return map;
}

export function incomeForMonth(month) {
  const sources = db.prepare('SELECT * FROM income_sources ORDER BY id').all();
  let total = 0;
  const parts = sources.map((s) => {
    const scheduled =
      (!s.start_month || s.start_month <= month) && (!s.end_month || month <= s.end_month);
    // Start/end months govern everything: outside the source's period it
    // contributes nothing — not even a recorded actual entry, which would
    // otherwise contradict the configured schedule. Historical out-of-period
    // entries stay in the database untouched; they are simply not shown or
    // counted for months outside the period.
    if (!scheduled) return { source: s, amount: 0, active: false };
    const entry = db
      .prepare('SELECT amount FROM income_entries WHERE source_id = ? AND month = ?')
      .get(s.id, month);
    const amount = entry ? entry.amount : (s.current_amount ?? 0);
    total += amount;
    return { source: s, amount, active: true };
  });
  return { total, parts };
}

// Sum of planned spend on Revolut-tagged categories minus completed incoming
// transfer rows. Ordinary income or refunds do not reduce the transfer need.
// Some older accounts were created as a generic Card while being named
// "Revolut", so both representations remain valid here. Matching the name
// keeps the account identity separate from its generic type in the UI.
export function transferToRevolut(month) {
  const cats = db
    .prepare(
      `SELECT c.* FROM categories c JOIN accounts a ON a.id = c.account_id
       WHERE a.kind = 'revolut' OR lower(trim(a.name)) LIKE '%revolut%'`,
    )
    .all();
  const planned = cats.reduce((sum, c) => sum + plannedForCategory(c, month), 0);
  const transferred = completedTransferToRevolut(month);
  return Math.max(0, planned - transferred);
}

export function completedTransferToRevolut(month) {
  return db
    .prepare(
      `SELECT t.amount, t.currency FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE (a.kind = 'revolut' OR lower(trim(a.name)) LIKE '%revolut%')
         AND t.amount > 0
         AND t.transfer_group IS NOT NULL
         AND substr(t.date, 1, 7) = ? AND ${NOT_PARENT('t')}`,
    )
    .all(month)
    .reduce((sum, t) => sum + convertCurrency(t.amount, t.currency, baseCurrency(), month), 0);
}

// Fund running balance at end of `month` (can go negative by design).
// The balance rolls forward from `opening_balance` with the monthly contribution
// and any manual `fund_movements`. A transaction linked to this fund (via
// `transactions.fund_id`) is treated as another way of recording activity on
// it: signed amount is added (negative = spend, positive = top-up/refund).
// Transfer rows are excluded — moving money between accounts isn't fund
// activity.
// Sum of every account's predicted bank balance (opening + sum of
// transactions on that account) plus the total committed savings. This is
// the user's "total money" at month end — what the dashboard and anchor
// should compare against an observed balance. Note that bank↔card transfers
// DO appear here, because moving money between your own accounts doesn't
// change wealth but does change the per-account balance.
function totalPredictedAt(month) {
  const accounts = db.prepare('SELECT id, display_currency FROM accounts').all();
  let bank = 0;
  for (const a of accounts) {
    const balance = accountBalanceAt(a.id, month);
    if (balance === null) continue; // before the account's opening-balance month
    bank += convertCurrency(balance, a.display_currency, baseCurrency(), month);
  }
  const committed = committedSavingsAt(month);
  return bank + committed;
}

export function fundCashFlowsAt(fund, month) {
  const opening = fund.opening_balance;
  const scheduled =
    month >= fund.start_month
      ? Math.max(0, monthsBetween(fund.start_month, month) + 1) * fund.monthly_contribution
      : 0;
  const movements = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS contributions,
         COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS withdrawals
       FROM fund_movements
       WHERE fund_id = ? AND month <= ?`,
    )
    .get(fund.id, month);
  const linked = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${FX_MULT} * t.amount > 0 THEN ${FX_MULT} * t.amount ELSE 0 END), 0) AS contributions,
         COALESCE(SUM(CASE WHEN ${FX_MULT} * t.amount < 0 THEN -(${FX_MULT} * t.amount) ELSE 0 END), 0) AS withdrawals
       FROM transactions t ${FX_JOIN}
       WHERE t.fund_id = ? AND substr(t.date,1,7) <= ? AND ${NOT_TRANSFER()} AND ${NOT_PARENT()}`,
    )
    .get(fund.id, month);

  const contributed = opening + scheduled + movements.contributions + linked.contributions;
  const withdrawn = movements.withdrawals + linked.withdrawals;
  return {
    opening,
    scheduled,
    manual_contributions: movements.contributions,
    manual_withdrawals: movements.withdrawals,
    linked_contributions: linked.contributions,
    linked_withdrawals: linked.withdrawals,
    contributed,
    withdrawn,
    balance: contributed - withdrawn,
  };
}

export function fundContributionForMonth(month) {
  return db
    .prepare('SELECT monthly_contribution, start_month FROM funds')
    .all()
    .reduce((sum, fund) => sum + (month >= fund.start_month ? fund.monthly_contribution : 0), 0);
}

// Keep the balance and the displayed contribution/withdrawal totals on one
// calculation so they cannot drift as new cash-flow sources are added.
export function fundBalanceAt(fund, month) {
  return fundCashFlowsAt(fund, month).balance;
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
    .prepare(`SELECT MAX(month) AS m FROM balance_observations WHERE month <= ?`)
    .get(from);
  return row?.m || null;
}

// Net change in free savings for a single month: income minus commitment and
// variable outgoings. Shared by the forecast loop and the pre-range roll-forward.
function monthNet(m, cats, commitments, scenario = null) {
  const inc = incomeForMonth(m);
  const incomeDelta = scenario?.monthly_income_delta ?? 0;
  const outgoingsDelta = scenario?.monthly_outgoings_delta ?? 0;
  const oneOffs = (scenario?.one_offs ?? [])
    .filter((oneOff) => oneOff.month === m)
    .reduce((sum, oneOff) => sum + oneOff.amount, 0);
  let commitmentOutgoings = 0;
  const lines = [];
  const categoryIds = new Set(cats.map((cat) => cat.id));
  const representedCommitments = new Set(
    commitments
      .filter(
        (commitment) => commitment.category_id != null && categoryIds.has(commitment.category_id),
      )
      .map((commitment) => commitment.id),
  );
  for (const cm of commitments) {
    if (m >= cm.start_month && (!cm.end_month || m <= cm.end_month)) {
      if (!representedCommitments.has(cm.id)) commitmentOutgoings += cm.monthly_amount;
      lines.push({ name: cm.name, amount: cm.monthly_amount });
    }
  }
  let variableTotal = 0;
  let commitmentCategoryTotal = 0;
  for (const c of cats) {
    const p = plannedForCategory(c, m);
    if (c.managed_commitment_id != null) commitmentCategoryTotal += p;
    else if (p) variableTotal += p;
  }
  const fundContributions = fundContributionForMonth(m);
  const outgoings =
    variableTotal +
    commitmentCategoryTotal +
    commitmentOutgoings +
    fundContributions +
    outgoingsDelta +
    oneOffs;
  return {
    income: inc.total + incomeDelta,
    outgoings,
    variable: variableTotal,
    fund_contributions: fundContributions,
    net: inc.total + incomeDelta - outgoings,
    lines,
  };
}

// Projection: income minus outgoings rolled forward, commitments dropping out
// at their end dates. Re-anchors to the latest observed bank balance (spec §7).
export function project(numMonths = 96, from = currentMonth(), scenario = null) {
  // Every active category's plan counts once. Managed Loan categories are
  // reported separately from ordinary variable categories.
  const cats = getAllCategories();
  // categories whose spend is already represented by a linked commitment
  const commitments = db.prepare('SELECT * FROM commitments ORDER BY name').all();

  // Total opening balances across all accounts — the "starting cash" the
  // user had before any transactions. The model carries this through the
  // re-anchor math so the projected free savings line up with reality.
  const totalOpeningBalance = db
    .prepare('SELECT opening_balance, display_currency FROM accounts')
    .all()
    .reduce(
      (sum, a) =>
        sum + convertCurrency(a.opening_balance, a.display_currency, baseCurrency(), from),
      0,
    );

  const anchorMonth = latestAnchor(from);

  const months = [];
  let free = 0; // net liquid wealth ABOVE the opening balances; the anchor
  // branch sets this to (observed - opening - committed).
  let varianceAtAnchor = null;

  // If the latest observation predates the forecast start, start from the
  // observed balance and roll free savings forward to `from` instead of
  // silently ignoring the anchor (its month never appears in the loop).
  if (anchorMonth && anchorMonth < from) {
    const observed = observedTotalAt(anchorMonth);
    const predictedAtAnchor = totalPredictedAt(anchorMonth);
    // free is the liquid portion: total - committed - opening.
    const committedAtAnchor = db
      .prepare('SELECT * FROM funds')
      .all()
      .reduce((s, f) => s + fundBalanceAt(f, anchorMonth), 0);
    free = predictedAtAnchor - committedAtAnchor - totalOpeningBalance;
    // Reconcile the drift so the anchor matches what the user typed.
    const drift = predictedAtAnchor - observed;
    free -= drift;
    let m = addMonths(anchorMonth, 1);
    while (m < from) {
      free += monthNet(m, cats, commitments).net;
      m = addMonths(m, 1);
    }
  }

  for (let i = 0; i < numMonths; i++) {
    const m = addMonths(from, i);
    const {
      income: incTotal,
      outgoings,
      variable: variableTotal,
      net,
      lines,
      fund_contributions,
    } = monthNet(m, cats, commitments, scenario);

    // re-anchor: once we pass an observed month, shift so totals match reality
    if (anchorMonth && m === anchorMonth) {
      const observed = observedTotalAt(anchorMonth);
      // The per-account predicted total (which sees transfers) is the real
      // number; compare to the user's observation to compute the drift.
      const predicted = totalPredictedAt(anchorMonth);
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
      fund_contributions: round2(fund_contributions),
      outgoings: round2(outgoings),
      net: round2(net),
      free_savings: round2(free),
      committed_savings: round2(committed),
      total_predicted: round2(free + committed + totalOpeningBalance),
      active_commitments: lines.map((l) => l.name),
    });
  }

  return {
    from,
    horizon: numMonths,
    anchored_at: anchorMonth,
    variance_at_anchor: varianceAtAnchor,
    months,
  };
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
      // Respect the schedule: start/end bounds and skip months.
      if (r.start_month && month < r.start_month) continue;
      if (r.end_month && month > r.end_month) continue;
      if (
        db
          .prepare('SELECT 1 FROM recurrence_skips WHERE recurrence_id = ? AND month = ?')
          .get(r.id, month)
      )
        continue;
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
    .filter((r) => r.planned > 0 && r.budget_actual > r.planned)
    .sort((a, b) => b.budget_actual - b.planned - (a.budget_actual - a.planned))
    .slice(0, 4)
    .forEach((r) => {
      insights.push({
        kind: 'over-budget',
        severity: 'danger',
        title: `${r.name} is over budget`,
        message: '',
        // Deep-link straight to the transactions that caused the overrun.
        link: `/transactions?month=${month}&category_id=${r.id}&context=over-budget`,
        action: 'Show transactions',
        fields: { amount_over: round2(r.budget_actual - r.planned) },
      });
    });

  if (month === currentMonth() && view.planned_total > 0) {
    const now = new Date();
    const elapsed = now.getDate() / daysInMonth(month);
    const spent = (view.budget_actual_total ?? view.actual_total) / view.planned_total;
    if (spent > elapsed + 0.1 && (view.budget_actual_total ?? view.actual_total) > 0) {
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

  db.prepare(
    'SELECT * FROM funds WHERE target_amount IS NOT NULL AND target_amount > 0 AND target_date IS NOT NULL',
  )
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

  // Per-account drift: when the latest observation disagrees with the model
  // for one account by more than 5% of the prediction, surface it so the
  // user knows to re-anchor. The amount is the difference; the user can hit
  // Balances to see the detail.
  const accounts = db.prepare('SELECT id, name, display_currency FROM accounts').all();
  for (const a of accounts) {
    const predicted = accountBalanceAt(a.id, month);
    if (predicted === null) continue; // before the account's opening-balance month
    const obs = db
      .prepare('SELECT balance FROM balance_observations WHERE account_id = ? AND month = ?')
      .get(a.id, month);
    if (!obs) continue;
    const variance = Math.round((predicted - obs.balance) * 100) / 100;
    if (Math.abs(variance) < 0.01) continue;
    const threshold = Math.max(50, Math.abs(predicted) * 0.05);
    if (Math.abs(variance) < threshold) continue;
    insights.push({
      kind: 'account-variance',
      severity: variance > 0 ? 'warning' : 'danger',
      title: `${a.name} balance is off by ${variance.toFixed(2)}`,
      message:
        variance > 0
          ? `The model predicts ${predicted.toFixed(2)} but the bank says ${obs.balance.toFixed(2)}. Possible unrecorded income, transfer, or fee.`
          : `The model predicts ${predicted.toFixed(2)} but the bank says ${obs.balance.toFixed(2)}. Possible unrecorded spend.`,
      link: '/balances',
      action: 'Open balances',
      fields: { account_id: a.id, predicted: round2(predicted), observed: obs.balance, variance },
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
  const coverage = actualCoverageByCategory(month);
  const rows = cats.map((c) => {
    const planned = plannedForCategory(c, month);
    const actualNet = actuals[c.id] ?? 0;
    const covered = coverage[c.id] ?? {
      total_actual: actualNet,
      actual_total: actualNet,
      fund_covered: 0,
      commitment_covered: 0,
      budget_actual: Math.max(0, actualNet),
      uncovered_amount: Math.max(0, actualNet),
    };
    return {
      id: c.id,
      name: c.name,
      group: c.group_name,
      group_sort: c.group_sort ?? 99,
      color: c.account_name === 'Revolut' ? '#63C3AC' : '#5E8BD9',
      account: c.account_name,
      planned,
      actual: round2(actualNet),
      total_actual: round2(actualNet),
      fund_covered: round2(covered.fund_covered),
      commitment_covered: round2(covered.commitment_covered),
      budget_actual: round2(covered.budget_actual),
      uncovered_amount: round2(covered.uncovered_amount),
      uncovered: round2(covered.uncovered_amount),
      difference: round2(planned - actualNet),
      budget_difference: round2(planned - covered.budget_actual),
    };
  });

  const groupsMap = {};
  for (const r of rows) {
    const g = r.group ?? 'Ungrouped';
    groupsMap[g] ??= {
      name: g,
      sort: r.group_sort,
      planned: 0,
      actual: 0,
      total_actual: 0,
      actual_total: 0,
      fund_covered: 0,
      commitment_covered: 0,
      budget_actual: 0,
      uncovered_amount: 0,
      uncovered: 0,
      difference: 0,
      budget_difference: 0,
      rows: [],
    };
    groupsMap[g].planned += r.planned;
    groupsMap[g].actual += r.actual;
    groupsMap[g].total_actual += r.total_actual;
    groupsMap[g].actual_total += r.actual_total;
    groupsMap[g].fund_covered += r.fund_covered;
    groupsMap[g].commitment_covered += r.commitment_covered;
    groupsMap[g].budget_actual += r.budget_actual;
    groupsMap[g].uncovered_amount += r.uncovered_amount;
    groupsMap[g].uncovered += r.uncovered;
    groupsMap[g].difference += r.difference;
    groupsMap[g].budget_difference += r.budget_difference;
    groupsMap[g].rows.push(r);
  }
  const groups = Object.values(groupsMap).sort((a, b) => a.sort - b.sort);

  const totalsPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalsActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalsFundCovered = rows.reduce((s, r) => s + r.fund_covered, 0);
  const totalsCommitmentCovered = rows.reduce((s, r) => s + r.commitment_covered, 0);
  const totalsBudgetActual = rows.reduce((s, r) => s + r.budget_actual, 0);
  const inc = incomeForMonth(month);
  const managedCategoryIds = new Set(
    cats.filter((c) => c.managed_commitment_id != null).map((c) => c.id),
  );
  const managedCommitmentPlan = rows
    .filter((row) => managedCategoryIds.has(row.id))
    .reduce((sum, row) => sum + row.planned, 0);
  const unrepresentedCommitmentPlan = db
    .prepare(
      `SELECT COALESCE(SUM(monthly_amount), 0) AS amount FROM commitments
       WHERE category_id IS NULL AND start_month <= ? AND (end_month IS NULL OR end_month >= ?)`,
    )
    .get(month, month).amount;
  const normalPlannedTotal = totalsPlanned - managedCommitmentPlan;
  const commitmentPlannedTotal = managedCommitmentPlan + unrepresentedCommitmentPlan;
  const fundContributionTotal = fundContributionForMonth(month);

  const untagged = cats.filter((c) => !c.account_id && c.is_active).map((c) => c.name);
  // Month-scoped count for the month being viewed, plus the global queue size.
  const needsReview = db
    .prepare(
      'SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1 AND substr(date,1,7) = ?',
    )
    .get(month).c;
  const needsReviewTotal = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')
    .get().c;
  const unconvertedFx = db
    .prepare(
      `SELECT COUNT(*) AS c FROM transactions t
       ${FX_JOIN}
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN fx_rates af ON af.month = substr(t.date,1,7) AND af.currency = a.display_currency
       WHERE substr(t.date,1,7) = ? AND ${NOT_COUNTED()}
         AND ((t.currency != ? AND f.rate IS NULL)
           OR (a.display_currency != ? AND t.currency != a.display_currency AND af.rate IS NULL))`,
    )
    .get(month, baseCurrency(), baseCurrency()).c;

  const funds = db
    .prepare('SELECT * FROM funds ORDER BY name')
    .all()
    .map((f) => ({
      ...f,
      balance: round2(fundBalanceAt(f, month)),
      scheduled_this_month: round2(month >= f.start_month ? f.monthly_contribution : 0),
    }));

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
    normal_planned_total: round2(normalPlannedTotal),
    commitment_planned_total: round2(commitmentPlannedTotal),
    fund_contribution_total: round2(fundContributionTotal),
    planned_cash_outflows: round2(totalsPlanned + fundContributionTotal),
    actual_total: round2(totalsActual),
    fund_covered_total: round2(totalsFundCovered),
    commitment_covered_total: round2(totalsCommitmentCovered),
    budget_actual_total: round2(totalsBudgetActual),
    uncovered_total: round2(totalsBudgetActual),
    budget_result: round2(totalsPlanned - totalsBudgetActual),
    month_result: round2(totalsPlanned - totalsActual),
    transfer_to_revolut: round2(transferToRevolut(month)),
    completed_transfer_to_revolut: round2(completedTransferToRevolut(month)),
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

// Deliberately small public projection: sharing a budget must never expose
// transactions, accounts, settings, or any other private user data.
export function sharedBudgetView(month = currentMonth()) {
  const categories = getAllCategories().map((category) => ({
    name: category.name,
    group: category.group_name || 'Ungrouped',
    planned: round2(plannedForCategory(category, month)),
  }));
  return {
    month,
    currency: baseCurrency(),
    planned_total: round2(categories.reduce((sum, category) => sum + category.planned, 0)),
    categories,
  };
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
       ORDER BY m LIMIT ?`,
    )
    .all(cur, MAX_CAPTURE_PER_RUN)
    .map((r) => r.m);
  if (missing.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO monthly_reports
       (month, income, expenses, planned, result, transfer_to_revolut, transaction_count, by_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let captured = 0;
  for (const m of missing) {
    const v = monthView(m);
    const n = db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE substr(date,1,7) = ?')
      .get(m).c;
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
      JSON.stringify(byCategory),
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
