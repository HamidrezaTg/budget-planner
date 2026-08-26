import { Router } from 'express';
import { db } from '../db.js';
import { incomeForMonth, addMonths, currentMonth } from '../services/model.js';

const router = Router();

// Income for a month (entries override recurring source amounts)
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month : currentMonth();
  const sources = db
    .prepare(
      `SELECT s.*, p.name AS person_name FROM income_sources s
       LEFT JOIN persons p ON p.id = s.person_id ORDER BY s.id`
    )
    .all()
    .map((s) => ({
      ...s,
      entry_amount:
        db.prepare('SELECT amount FROM income_entries WHERE source_id = ? AND month = ?').get(s.id, month)
          ?.amount ?? null,
    }));
  const view = incomeForMonth(month);
  res.json({ month, sources, total: view.total });
});

// Enter actual income for a source+month; amount null removes the override
router.put('/:month/:sourceId', (req, res) => {
  const { month, sourceId } = req.params;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const src = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(sourceId);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  const amount = req.body?.amount;
  if (amount === null || amount === undefined || amount === '') {
    db.prepare('DELETE FROM income_entries WHERE source_id = ? AND month = ?').run(sourceId, month);
  } else {
    const amt = Number(amount);
    if (isNaN(amt)) return res.status(400).json({ error: 'Invalid amount' });
    db.prepare(
      `INSERT INTO income_entries (source_id, month, amount) VALUES (?, ?, ?)
       ON CONFLICT(source_id, month) DO UPDATE SET amount = excluded.amount`
    ).run(sourceId, month, amt);
  }
  if (req.body?.current_amount !== undefined) {
    db.prepare('UPDATE income_sources SET current_amount = ? WHERE id = ?').run(
      Number(req.body.current_amount) || 0,
      sourceId
    );
  }
  res.json({ ok: true });
});

export default router;
