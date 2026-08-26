import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT cm.*, a.name AS account_name, f.name AS fund_name,
              (SELECT name FROM categories WHERE id = cm.category_id) AS category_name
       FROM commitments cm
       LEFT JOIN accounts a ON a.id = cm.account_id
       LEFT JOIN funds f ON f.id = cm.fund_id
       ORDER BY cm.start_month, cm.name`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, monthly_amount = 0, start_month, end_month = null, account_id = null, fund_id = null, category_id = null, note = null } =
    req.body ?? {};
  if (!name?.trim() || !start_month)
    return res.status(400).json({ error: 'name and start_month required' });
  if (!/^\d{4}-\d{2}$/.test(start_month))
    return res.status(400).json({ error: 'start_month must be YYYY-MM' });
  if (end_month && !/^\d{4}-\d{2}$/.test(end_month))
    return res.status(400).json({ error: 'end_month must be YYYY-MM' });
  const r = db
    .prepare(
      `INSERT INTO commitments (name, monthly_amount, start_month, end_month, account_id, fund_id, category_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name.trim(), Number(monthly_amount) || 0, start_month, end_month, account_id, fund_id, category_id, note);
  res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  db.prepare(
    `UPDATE commitments SET name=?, monthly_amount=?, start_month=?, end_month=?, account_id=?, fund_id=?, category_id=?, note=? WHERE id=?`
  ).run(
    b.name ?? row.name,
    Number(b.monthly_amount ?? row.monthly_amount) || 0,
    b.start_month ?? row.start_month,
    b.end_month ?? row.end_month,
    b.account_id ?? row.account_id,
    b.fund_id ?? row.fund_id,
    b.category_id ?? row.category_id,
    b.note ?? row.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(row.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM commitments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
