import { Router } from 'express';
import { db } from '../db.js';
import { monthView, ensureMonthlyReports } from '../services/model.js';

const router = Router();

// Full month picture: grouped budget vs actual, income, transfer-to-Revolut,
// month result, funds, warnings. Also lazily captures month-end report
// snapshots (idempotent; cheap no-op once every closed month is stored).
router.get('/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try { ensureMonthlyReports(); } catch {}
  res.json(monthView(month));
});

export default router;
