import { Router } from 'express';
import { db } from '../db.js';
import { project, currentMonth } from '../services/model.js';

const router = Router();

// Observations + reconciliation view. Account CRUD moved to routes/accounts.js
// in v3.12.
router.get('/', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  const observations = db
    .prepare(
      `SELECT o.*, a.name AS account_name FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id ORDER BY o.month DESC`,
    )
    .all();

  // Aggregate reconciliation (existing behaviour — kept for the dashboard).
  const proj = project(120);
  const byMonth = Object.fromEntries(proj.months.map((m) => [m.month, m]));
  const reconciled = observations
    .filter((o) => byMonth[o.month])
    .map((o) => {
      const perAccountPredicted = accountBalanceAt(accounts, o.account_id, o.month);
      return {
        ...o,
        predicted: perAccountPredicted,
        variance: Math.round((perAccountPredicted - o.balance) * 100) / 100,
      };
    });

  // Per-account summary: each account's running balance (opening + txns) at
  // the current month, plus the latest observation and variance.
  const month = currentMonth();
  const perAccount = accounts.map((a) => {
    const predicted = accountBalanceAt(accounts, a.id, month);
    const latestObs = db
      .prepare(
        'SELECT balance, month FROM balance_observations WHERE account_id = ? ORDER BY month DESC LIMIT 1',
      )
      .get(a.id);
    const variance = latestObs ? Math.round((latestObs.balance - predicted) * 100) / 100 : null;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      is_spending_pot: !!a.is_spending_pot,
      opening_balance: a.opening_balance,
      predicted_at_month: Math.round(predicted * 100) / 100,
      latest_observation: latestObs ? { month: latestObs.month, balance: latestObs.balance } : null,
      variance,
    };
  });

  res.json({
    accounts,
    observations,
    reconciled,
    per_account: perAccount,
    anchored_at: proj.anchored_at,
  });
});

// Compute one account's predicted bank balance at the end of `month`.
function accountBalanceAt(allAccounts, accountId, month) {
  const a = allAccounts.find((x) => x.id === accountId);
  if (!a) return 0;
  const txSum = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM transactions
       WHERE account_id = ? AND substr(date,1,7) <= ?
         AND NOT (split_of IS NULL AND split_group IS NOT NULL)`,
    )
    .get(accountId, month).s;
  return a.opening_balance + txSum;
}

// Enter/replace the observed balance for one account+month
router.post('/', (req, res) => {
  const { account_id, month, balance } = req.body ?? {};
  if (!account_id || !/^\d{4}-\d{2}$/.test(month ?? '') || isNaN(Number(balance)))
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
