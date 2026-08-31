import { Router } from 'express';
import { monthView, ensureMonthlyReports } from '../services/model.js';

const router = Router();

// Full month picture: grouped budget vs actual, income, transfer-to-Revolut,
// month result, funds, warnings. Also lazily captures month-end report
// snapshots (idempotent; cheap no-op once every closed month is stored).
// Capture runs AFTER the response is sent: up to MAX_CAPTURE_PER_RUN full
// month computations must never delay the dashboard render, and failures are
// logged (a silent catch used to disable snapshot capture forever).
router.get('/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  setImmediate(() => {
    try {
      ensureMonthlyReports();
    } catch (e) {
      console.error('[monthly-reports] snapshot capture failed:', e.message);
    }
  });
  res.json(monthView(month));
});

export default router;
