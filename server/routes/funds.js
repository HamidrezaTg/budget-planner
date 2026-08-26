import { Router } from 'express';
import { db } from '../db.js';
import { fundBalanceAt, currentMonth, addMonths, monthsBetween } from '../services/model.js';

const router = Router();

// Funds with balances + recent movements. `month` = reference point for balances.
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month : currentMonth();
  const funds = db
    .prepare(
      `SELECT f.*, c.name AS category_name FROM funds f
       LEFT JOIN categories c ON c.id = f.category_id ORDER BY f.name`
    )
    .all()
    .map((f) => {
      const scheduled =
        month >= f.start_month
          ? Math.max(0, monthsBetween(f.start_month, month) + 1) * f.monthly_contribution
          : 0;
      const withdrawn = db
        .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM fund_movements WHERE fund_id=? AND kind='withdrawal' AND month<=?`)
        .get(f.id, month).s;
      return {
        ...f,
        balance: Math.round(fundBalanceAt(f, month) * 100) / 100,
        contributed_so_far: Math.round((scheduled + f.opening_balance) * 100) / 100,
        withdrawn_so_far: Math.round(-withdrawn * 100) / 100,
        negative: fundBalanceAt(f, month) < 0,
      };
    });

  const movements = db
    .prepare(
      `SELECT m.*, f.name AS fund_name FROM fund_movements m
       JOIN funds f ON f.id = m.fund_id ORDER BY m.created_at DESC, m.id DESC LIMIT 100`
    )
    .all();
  res.json({ month, funds, movements });
});

// Record a movement: contribution (+) or withdrawal (-)
router.post('/:id/movement', (req, res) => {
  const fund = db.prepare('SELECT * FROM funds WHERE id = ?').get(req.params.id);
  if (!fund) return res.status(404).json({ error: 'Fund not found' });
  const { kind, amount, month, note } = req.body ?? {};
  if (!['contribution', 'withdrawal'].includes(kind))
    return res.status(400).json({ error: "kind must be 'contribution' or 'withdrawal'" });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'amount must be positive' });
  const m = /^\d{4}-\d{2}$/.test(month ?? '') ? month : currentMonth();
  db.prepare(
    'INSERT INTO fund_movements (fund_id, month, amount, kind, note) VALUES (?, ?, ?, ?, ?)'
  ).run(fund.id, m, kind === 'contribution' ? amt : -amt, kind, note ?? null);
  res.json({ ok: true });
});

// Edit fund configuration
router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM funds WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fund not found' });
  const b = req.body ?? {};
  db.prepare(
    'UPDATE funds SET name=?, monthly_contribution=?, start_month=?, opening_balance=?, category_id=? WHERE id=?'
  ).run(
    b.name ?? row.name,
    Number(b.monthly_contribution ?? row.monthly_contribution) || 0,
    b.start_month ?? row.start_month,
    Number(b.opening_balance ?? row.opening_balance) || 0,
    b.category_id ?? row.category_id,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM funds WHERE id = ?').get(row.id));
});

router.post('/', (req, res) => {
  const { name, monthly_contribution = 0, start_month, opening_balance = 0, category_id = null } = req.body ?? {};
  if (!name?.trim() || !start_month)
    return res.status(400).json({ error: 'name and start_month required' });
  try {
    const r = db
      .prepare('INSERT INTO funds (name, monthly_contribution, start_month, opening_balance, category_id) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), Number(monthly_contribution) || 0, start_month, Number(opening_balance) || 0, category_id);
    res.json(db.prepare('SELECT * FROM funds WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'Fund name already exists' });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM funds WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
