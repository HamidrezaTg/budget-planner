import { Router } from 'express';
import { db } from '../db.js';
import { project, currentMonth, addMonths, monthsBetween } from '../services/model.js';

const router = Router();

// Observations + reconciliation view.
router.get('/', (_req, res) => {
  const accounts = db
    .prepare('SELECT * FROM accounts ORDER BY id')
    .all();
  const observations = db
    .prepare(
      `SELECT o.*, a.name AS account_name FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id ORDER BY o.month DESC`
    )
    .all();

  // Aggregate reconciliation (existing behaviour — kept for the dashboard).
  const proj = project(120);
  const byMonth = Object.fromEntries(proj.months.map((m) => [m.month, m]));
  const reconciled = observations
    .filter((o) => byMonth[o.month])
    .map((o) => {
      const p = byMonth[o.month];
      // The model predicts TOTAL bank money = free + committed + opening.
      // Per-account we project the share attributed to that account: opening
      // balance + sum of its transactions up to that month, plus the model's
      // total minus (per-account predicted) → drift is attributed to "other".
      const perAccountPredicted = accountBalanceAt(accounts, o.account_id, o.month);
      return { ...o, predicted: perAccountPredicted, variance: Math.round((perAccountPredicted - o.balance) * 100) / 100 };
    });

  // Per-account summary: each account's running balance (opening + txns) at
  // the current month, plus the latest observation and variance.
  const month = currentMonth();
  const perAccount = accounts.map((a) => {
    const predicted = accountBalanceAt(accounts, a.id, month);
    const latestObs = db
      .prepare('SELECT balance, month FROM balance_observations WHERE account_id = ? ORDER BY month DESC LIMIT 1')
      .get(a.id);
    const variance = latestObs
      ? Math.round((latestObs.balance - predicted) * 100) / 100
      : null;
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

// Compute one account's predicted bank balance at the end of `month`:
// opening_balance + sum of every transaction on this account up to that
// month. Excludes split parents (their children carry the amounts).
function accountBalanceAt(allAccounts, accountId, month) {
  const a = allAccounts.find((x) => x.id === accountId);
  if (!a) return 0;
  const txSum = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM transactions
       WHERE account_id = ? AND substr(date,1,7) <= ?
         AND NOT (split_of IS NULL AND split_group IS NOT NULL)`
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
     ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance`
  ).run(account_id, month, Number(balance));
  res.json({ ok: true });
});

// Update account fields (name, opening_balance, kind, is_spending_pot). v3.11
// is intentionally minimal — full account CRUD is part of v3.12.
router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  const b = req.body ?? {};
  const sets = [];
  const args = [];
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n || n.length > 60) return res.status(400).json({ error: 'name must be 1-60 chars' });
    const dup = db.prepare('SELECT id FROM accounts WHERE name = ? AND id != ?').get(n, row.id);
    if (dup) return res.status(400).json({ error: 'An account with this name already exists' });
    sets.push('name = ?'); args.push(n);
  }
  if (b.opening_balance !== undefined) {
    const n = Number(b.opening_balance);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'opening_balance must be a number' });
    sets.push('opening_balance = ?'); args.push(n);
  }
  if (b.kind !== undefined) {
    const k = String(b.kind);
    if (!['bank', 'card', 'cash', 'other'].includes(k)) return res.status(400).json({ error: 'kind must be one of bank, card, cash, other' });
    sets.push('kind = ?'); args.push(k);
  }
  if (b.is_spending_pot !== undefined) {
    sets.push('is_spending_pot = ?'); args.push(b.is_spending_pot ? 1 : 0);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No editable fields provided' });
  args.push(req.params.id);
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  // Refuse if any transactions or observations still reference this account.
  const txCount = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?')
    .get(req.params.id).c;
  const obsCount = db
    .prepare('SELECT COUNT(*) AS c FROM balance_observations WHERE account_id = ?')
    .get(req.params.id).c;
  if (txCount > 0 || obsCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: this account still has ${txCount} transaction(s) and ${obsCount} observation(s). Reassign them first.`,
    });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
