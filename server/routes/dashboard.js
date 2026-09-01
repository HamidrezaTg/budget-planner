import { Router } from 'express';
import { monthView } from '../services/model.js';

const router = Router();

// Full month picture: grouped budget vs actual, income, transfer-to-Revolut,
// month result, funds, and warnings. Snapshot capture is an explicit POST on
// the reports route so this read has no write side effects.
router.get('/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  res.json(monthView(month));
});

export default router;
