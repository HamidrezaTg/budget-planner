import { Router } from 'express';
import { db } from '../db.js';
import {
  project,
  currentMonth,
  accountBalanceAt,
  convertCurrency,
  baseCurrency,
} from '../services/model.js';

const router = Router();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round(n * 100) / 100;
const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return date.toISOString().slice(0, 7);
};

// Observations + reconciliation view. Account CRUD moved to routes/accounts.js
// in v3.12.
router.get('/', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  const observations = db
    .prepare(
      `SELECT o.*, a.name AS account_name, a.display_currency FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id ORDER BY o.month DESC`,
    )
    .all();

  // Aggregate reconciliation (existing behaviour — kept for the dashboard).
  const proj = project(120);
  const byMonth = Object.fromEntries(proj.months.map((m) => [m.month, m]));
  const reconciled = observations
    .filter((o) => byMonth[o.month])
    .map((o) => {
      const perAccountPredicted = accountBalanceAt(o.account_id, o.month);
      return {
        ...o,
        predicted: perAccountPredicted,
        variance: perAccountPredicted === null ? null : round2(perAccountPredicted - o.balance),
      };
    });

  // Per-account summary: the latest observation is compared with the model AT
  // THE OBSERVATION MONTH (not the current month), using one consistent
  // variance sign everywhere: calculated − observed.
  const month = currentMonth();
  const perAccount = accounts.map((a) => {
    const predicted = accountBalanceAt(a.id, month);
    const latestObs = db
      .prepare(
        'SELECT balance, month FROM balance_observations WHERE account_id = ? ORDER BY month DESC LIMIT 1',
      )
      .get(a.id);
    const predictedAtObservation = latestObs ? accountBalanceAt(a.id, latestObs.month) : null;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      is_spending_pot: !!a.is_spending_pot,
      opening_balance: a.opening_balance,
      opening_balance_month: a.opening_balance_month ?? null,
      display_currency: a.display_currency,
      predicted_at_month: predicted === null ? null : round2(predicted),
      latest_observation: latestObs ? { month: latestObs.month, balance: latestObs.balance } : null,
      latest_variance:
        latestObs && predictedAtObservation !== null
          ? round2(predictedAtObservation - latestObs.balance)
          : null,
    };
  });

  // Month-by-month history: every account's calculated balance next to the
  // observed balance the user entered for that month. Months before an
  // account's opening-balance month are "unavailable" (calculated: null), and
  // totals are only offered when every account has an observation for the
  // month (a missing observation is never silently treated as zero).
  const observationByAccountMonth = new Map(
    observations.map((o) => [`${o.account_id}|${o.month}`, o.balance]),
  );
  const earliestObservation = observations.reduce(
    (min, o) => (min === null || o.month < min ? o.month : min),
    null,
  );
  const earliestBaseline = accounts.reduce(
    (min, a) =>
      a.opening_balance_month && (min === null || a.opening_balance_month < min)
        ? a.opening_balance_month
        : min,
    null,
  );
  // Window: last 24 months, extended back to cover the earliest observation
  // and the earliest baseline so nothing the user entered is hidden.
  const windowStart = addMonths(month, -23);
  let from = [windowStart, earliestObservation, earliestBaseline]
    .filter(Boolean)
    .reduce((min, m) => (m < min ? m : min), windowStart);
  if (from > month) from = month;

  const history = [];
  for (let m = from; m <= month; m = addMonths(m, 1)) {
    const rows = accounts.map((a) => {
      const calculated = accountBalanceAt(a.id, m);
      const observed = observationByAccountMonth.get(`${a.id}|${m}`) ?? null;
      return {
        account_id: a.id,
        display_currency: a.display_currency,
        calculated: calculated === null ? null : round2(calculated),
        observed,
        variance: calculated !== null && observed !== null ? round2(calculated - observed) : null,
      };
    });
    const allObserved = rows.every((r) => r.observed !== null && r.calculated !== null);
    const totals = allObserved
      ? (() => {
          const calculated = round2(
            rows.reduce(
              (sum, r) =>
                sum + convertCurrency(r.calculated, r.display_currency, baseCurrency(), m),
              0,
            ),
          );
          const observed = round2(
            rows.reduce(
              (sum, r) => sum + convertCurrency(r.observed, r.display_currency, baseCurrency(), m),
              0,
            ),
          );
          return { calculated, observed, variance: round2(calculated - observed) };
        })()
      : null;
    history.push({ month: m, accounts: rows, total: totals });
  }

  res.json({
    accounts,
    observations,
    reconciled,
    per_account: perAccount,
    history,
    anchored_at: proj.anchored_at,
  });
});

// Enter/replace the observed balance for one account+month
router.post('/', (req, res) => {
  const { account_id, month, balance } = req.body ?? {};
  if (!account_id || !MONTH_RE.test(month ?? '') || isNaN(Number(balance)))
    return res.status(400).json({ error: 'account_id, month (YYYY-MM), balance required' });
  const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  db.prepare(
    `INSERT INTO balance_observations (account_id, month, balance) VALUES (?, ?, ?)
     ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance`,
  ).run(account_id, month, Number(balance));
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  // Delete a balance OBSERVATION (not the account — see /api/accounts for
  // account deletion).
  const row = db.prepare('SELECT id FROM balance_observations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM balance_observations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
