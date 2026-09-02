import { Router } from 'express';
import { db, ensureCommitmentCategory, retireCommitmentCategory } from '../db.js';
import { currentMonth } from '../services/model.js';

const router = Router();

// Strict YYYY-MM: a month like "2026-9" or "2026-00" would corrupt month
// arithmetic (NaN balances, silently dropped commitments).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function addPaymentStatus(row, month) {
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS amount
       FROM transactions
       WHERE commitment_id = ? AND substr(date, 1, 7) = ?
         AND transfer_group IS NULL
         AND NOT (split_of IS NULL AND split_group IS NOT NULL)`,
    )
    .get(row.id, month).amount;
  return {
    ...row,
    payment_month: month,
    paid_amount: Math.round(paid * 100) / 100,
    payment_status: paid + 0.01 >= row.monthly_amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  };
}

function planAmount(v, field) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0)
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400 });
  return n;
}

router.get('/', (_req, res) => {
  const month = MONTH_RE.test(_req.query.month ?? '') ? _req.query.month : currentMonth();
  const rows = db
    .prepare(
      `SELECT cm.*, a.name AS account_name, f.name AS fund_name,
              (SELECT name FROM categories WHERE id = cm.category_id) AS category_name
       FROM commitments cm
       LEFT JOIN accounts a ON a.id = cm.account_id
       LEFT JOIN funds f ON f.id = cm.fund_id
       ORDER BY cm.start_month, cm.name`,
    )
    .all()
    .map((row) => addPaymentStatus(row, month));
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
    if (end_month && end_month < start_month)
      return res.status(400).json({ error: 'end_month must not be before start_month' });
    const amount = planAmount(monthly_amount, 'monthly_amount');
    db.exec('BEGIN');
    try {
      const r = db
        .prepare(
          `INSERT INTO commitments (name, monthly_amount, start_month, end_month, account_id, fund_id, category_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(name.trim(), amount, start_month, end_month, account_id, fund_id, category_id, note);
      const commitment = db
        .prepare('SELECT * FROM commitments WHERE id = ?')
        .get(r.lastInsertRowid);
      ensureCommitmentCategory(db, commitment);
      db.exec('COMMIT');
      res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(r.lastInsertRowid));
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim()))
    return res.status(400).json({ error: 'name is required' });
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
  const startMonth = b.start_month !== undefined ? b.start_month : row.start_month;
  const endMonth = b.end_month !== undefined ? b.end_month || null : row.end_month;
  if (endMonth && endMonth < startMonth)
    return res.status(400).json({ error: 'end_month must not be before start_month' });
  // null (or '') clears the end month; `?? row.end_month` made clearing
  // impossible (null ?? old → old). The same trap applies to every nullable
  // column below, so clearing account/fund/category/note uses !== undefined.
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE commitments SET name=?, monthly_amount=?, start_month=?, end_month=?, account_id=?, fund_id=?, category_id=?, note=? WHERE id=?`,
    ).run(
      b.name ?? row.name,
      amount,
      startMonth,
      endMonth,
      b.account_id !== undefined ? b.account_id : row.account_id,
      b.fund_id !== undefined ? b.fund_id : row.fund_id,
      b.category_id !== undefined ? b.category_id : row.category_id,
      b.note !== undefined ? b.note : row.note,
      req.params.id,
    );
    const updated = db.prepare('SELECT * FROM commitments WHERE id = ?').get(row.id);
    ensureCommitmentCategory(db, updated);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json(db.prepare('SELECT * FROM commitments WHERE id = ?').get(row.id));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.exec('BEGIN');
  try {
    retireCommitmentCategory(db, row);
    db.prepare('DELETE FROM commitments WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true });
});

export default router;
