import { Router } from 'express';
import { db } from '../db.js';
import { project, currentMonth, addMonths, monthsBetween } from '../services/model.js';

const router = Router();

// Observations + reconciliation view
router.get('/', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  const observations = db
    .prepare(
      `SELECT o.*, a.name AS account_name FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id ORDER BY o.month DESC`
    )
    .all();

  // reconcile each observed month against the projection
  const proj = project(120);
  const byMonth = Object.fromEntries(proj.months.map((m) => [m.month, m]));
  const reconciled = observations
    .filter((o) => byMonth[o.month])
    .map((o) => {
      const p = byMonth[o.month];
      return { ...o, predicted: p.total_predicted, variance: Math.round((p.total_predicted - o.balance) * 100) / 100 };
    });
  res.json({ accounts, observations, reconciled, anchored_at: proj.anchored_at });
});

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

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM balance_observations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
