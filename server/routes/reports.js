import { Router } from 'express';
import XLSX from 'xlsx';
import { db } from '../db.js';
import { monthView, ensureMonthlyReports, monthlyReportHistory } from '../services/model.js';

const router = Router();

// ------------------------------------------------------------ scheduled snapshots
router.get('/history', (_req, res) => {
  const captured = ensureMonthlyReports();
  res.json({ captured, rows: monthlyReportHistory() });
});

// ------------------------------------------------------------ excel exports
function sendXlsx(res, filename, sheets) {
  // raw amounts + currency codes (same policy as CSV: conversion is a
  // reporting concern; statements stay raw). Cell text is sanitized against
  // formula injection the same way as the CSV export.
  const safe = (v) => {
    if (typeof v !== 'string') return v;
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  };
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        rows.map((r) => {
          const out = {};
          for (const [k, v] of Object.entries(r)) out[k] = safe(v);
          return out;
        }),
      ),
      name.slice(0, 31),
    );
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

router.get('/export/monthly/:month.xlsx', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const txs = db
    .prepare(
      `SELECT t.date AS Date, t.description AS Description, t.amount AS Amount, t.currency AS Currency,
              COALESCE(c.name,'Uncategorized') AS Category
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date,1,7) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL) ORDER BY t.date`,
    )
    .all(month);
  const view = monthView(month);
  const summary = view.rows
    .filter((r) => r.actual > 0 || r.planned > 0)
    .map((r) => ({
      Category: r.name,
      Planned: r.planned,
      Actual: r.actual,
      Difference: r.difference,
    }));
  summary.unshift({
    Category: 'TOTAL',
    Planned: view.planned_total,
    Actual: view.actual_total,
    Difference: view.month_result,
  });
  sendXlsx(res, `report-${month}.xlsx`, [
    { name: 'Transactions', rows: txs },
    { name: 'Summary', rows: summary },
  ]);
});

router.get('/export/yearly/:year.xlsx', (req, res) => {
  const year = req.params.year;
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year must be YYYY' });
  const months = db
    .prepare(
      `SELECT substr(t.date,1,7) AS Month,
              COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END),0) AS Income,
              COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END),0) AS Expenses
       FROM transactions t WHERE substr(t.date,1,4) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)
       GROUP BY substr(t.date,1,7)`,
    )
    .all(year);
  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS Category,
              SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS Spent
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date,1,4) = ? AND t.amount < 0 AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)
       GROUP BY c.id ORDER BY Spent`,
    )
    .all(year);
  sendXlsx(res, `report-${year}.xlsx`, [
    { name: 'Months', rows: months },
    { name: 'By category', rows: byCategory },
  ]);
});

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
      n: db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE substr(date,1,7) = ?').get(month)
        .c,
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
        `SELECT COALESCE(SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount > 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END),0) AS income,
                COALESCE(SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount < 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END),0) AS expenses
         FROM transactions t LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
         WHERE substr(t.date,1,7) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)`,
      )
      .get(m);
    months.push({ month: m, expenses: t.expenses, income: t.income });
  }

  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS name,
              SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount < 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END) AS spent
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE substr(t.date,1,4) = ? AND (COALESCE(f.rate, 1)) * t.amount < 0 AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL) GROUP BY c.id ORDER BY spent`,
    )
    .all(year);

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount > 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END),0) AS income,
              COALESCE(SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount < 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END),0) AS expenses
       FROM transactions t LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE substr(t.date,1,4) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)`,
    )
    .get(year);

  const prev = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount < 0 THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END),0) AS expenses
       FROM transactions t LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE substr(t.date,1,4) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)`,
    )
    .get(String(Number(year) - 1));

  const byCategoryMonthly = db
    .prepare(
      `SELECT substr(t.date,1,7) AS month,
              COALESCE(c.name, 'Uncategorized') AS name,
              SUM(CASE WHEN (COALESCE(f.rate, 1)) * t.amount < 0
                       THEN (COALESCE(f.rate, 1)) * t.amount ELSE 0 END) AS spent
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE substr(t.date,1,4) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL)
       GROUP BY substr(t.date,1,7), c.id ORDER BY month, name`,
    )
    .all(year);

  res.json({
    year,
    months,
    byCategory,
    byCategoryMonthly,
    totals,
    prevYearExpenses: prev.expenses,
  });
});

// CSV exports keep the ORIGINAL stored amounts and currency codes —
// conversion is a reporting concern, raw statements stay raw.
function sendCsv(res, filename, rows) {
  // Escape quotes AND neutralize formula injection: bank-statement text is
  // attacker-controlled, and a cell starting with = + - @ executes in Excel
  // and LibreOffice when the export is opened.
  const esc = (v) => {
    let s = String(v ?? '').replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s}"`;
  };
  const header = 'date,description,amount,currency,category';
  const body = rows.map((r) =>
    [r.date, esc(r.description), r.amount, r.currency, esc(r.category)].join(','),
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
       WHERE substr(t.date,1,7) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL) ORDER BY t.date`,
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
       WHERE substr(t.date,1,4) = ? AND NOT (t.split_of IS NULL AND t.split_group IS NOT NULL) ORDER BY t.date`,
    )
    .all(year);
  sendCsv(res, `report-${year}.csv`, rows);
};

router.get('/export/monthly/:month', exportMonthly);
router.get('/export/yearly/:year', exportYearly);

export default router;
