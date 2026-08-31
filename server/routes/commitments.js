import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// Strict YYYY-MM: a month like "2026-9" or "2026-00" would corrupt month
// arithmetic (NaN balances, silently dropped commitments).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function planAmount(v, field) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0)
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400 });
  return n;
}

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT cm.*, a.name AS account_name, f.name AS fund_name,
              (SELECT name FROM categories WHERE id = cm.category_id) AS category_name
       FROM commitments cm
       LEFT JOIN accounts a ON a.id = cm.account_id
       LEFT JOIN funds f ON f.id = cm.fund_id
       ORDER BY cm.start_month, cm.name`,
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const {
    name,
    monthly_amount = 0,
    start_month,
    end_month = null,
    account_id = null,
    fund_id = null,
    category_id = null,
    note = null,
  } = req.body ?? {};
  try {
    if (!name?.trim() || !start_month)
      return res.status(400).json({ error: 'name and start_month required' });
    if (!MONTH_RE.test(start_month))
      return res.status(400).json({ error: 'start_month must be YYYY-MM' });
    if (end_month && !MONTH_RE.test(end_month))
      return res.status(400).json({ error: 'end_month must be YYYY-MM' });
    const amount = planAmount(monthly_amount, 'monthly_amount');
    const r = db
      .prepare(
        `INSERT INTO commitments (name, monthly_amount, start_month, end_month, account_id, fund_id, category_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name.trim(), amount, start_month, end_month, account_id, fund_id, category_id, note);
    res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  if (b.start_month !== undefined && !MONTH_RE.test(String(b.start_month)))
    return res.status(400).json({ error: 'start_month must be YYYY-MM' });
  if (
    b.end_month !== undefined &&
    b.end_month !== null &&
    b.end_month !== '' &&
    !MONTH_RE.test(String(b.end_month))
  )
    return res.status(400).json({ error: 'end_month must be YYYY-MM or null' });
  let amount = row.monthly_amount;
  if (b.monthly_amount !== undefined) {
    try {
      amount = planAmount(b.monthly_amount, 'monthly_amount');
    } catch (e) {
      return res.status(e.status).json({ error: e.message });
    }
  }
  // null (or '') clears the end month; `?? row.end_month` made clearing
  // impossible (null ?? old → old). The same trap applies to every nullable
  // column below, so clearing account/fund/category/note uses !== undefined.
  const endMonth = b.end_month !== undefined ? b.end_month || null : row.end_month;
  db.prepare(
    `UPDATE commitments SET name=?, monthly_amount=?, start_month=?, end_month=?, account_id=?, fund_id=?, category_id=?, note=? WHERE id=?`,
  ).run(
    b.name ?? row.name,
    amount,
    b.start_month ?? row.start_month,
    endMonth,
    b.account_id !== undefined ? b.account_id : row.account_id,
    b.fund_id !== undefined ? b.fund_id : row.fund_id,
    b.category_id !== undefined ? b.category_id : row.category_id,
    b.note !== undefined ? b.note : row.note,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(row.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM commitments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
