import { Router } from 'express';
import { db } from '../db.js';
import { monthView, currentMonth, addMonths } from '../services/model.js';

const router = Router();

router.get('/monthly/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const view = monthView(month);
  res.json({
    month,
    totals: {
      income: view.income,
      expenses: -view.actual_total,
      planned: view.planned_total,
      result: view.month_result,
      n: db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE substr(date,1,7) = ?').get(month).c,
    },
    byCategory: view.rows
      .filter((r) => r.actual > 0 || r.planned > 0)
      .map((r) => ({ name: r.name, spent: -r.actual, budget: r.planned, variance: r.difference })),
    transfer_to_revolut: view.transfer_to_revolut,
  });
});

router.get('/yearly/:year', (req, res) => {
  const year = req.params.year;
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year must be YYYY' });

  const months = [];
  for (let i = 1; i <= 12; i++) {
    const m = `${year}-${String(i).padStart(2, '0')}`;
    const t = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS income,
                COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END),0) AS expenses
         FROM transactions WHERE substr(date,1,7) = ?`
      )
      .get(m);
    months.push({ month: m, expenses: t.expenses, income: t.income });
  }

  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS name,
              SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spent
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date,1,4) = ? AND t.amount < 0 GROUP BY c.id ORDER BY spent`
    )
    .all(year);

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS income,
              COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END),0) AS expenses
       FROM transactions WHERE substr(date,1,4) = ?`
    )
    .get(year);

  const prev = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END),0) AS expenses
       FROM transactions WHERE substr(date,1,4) = ?`
    )
    .get(String(Number(year) - 1));

  res.json({ year, months, byCategory, totals, prevYearExpenses: prev.expenses });
});

// CSV exports
function sendCsv(res, filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'date,description,amount,currency,category';
  const body = rows.map((r) =>
    [r.date, esc(r.description), r.amount, r.currency, esc(r.category)].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([header, ...body].join('\n'));
}

const exportMonthly = (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const rows = db
    .prepare(
      `SELECT t.date, t.description, t.amount, t.currency, COALESCE(c.name,'Uncategorized') AS category
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date,1,7) = ? ORDER BY t.date`
    )
    .all(month);
  sendCsv(res, `report-${month}.csv`, rows);
};

const exportYearly = (req, res) => {
  const year = req.params.year;
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year must be YYYY' });
  const rows = db
    .prepare(
      `SELECT t.date, t.description, t.amount, t.currency, COALESCE(c.name,'Uncategorized') AS category
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date,1,4) = ? ORDER BY t.date`
    )
    .all(year);
  sendCsv(res, `report-${year}.csv`, rows);
};

router.get('/export/monthly/:month', exportMonthly);
router.get('/export/yearly/:year', exportYearly);

export default router;
