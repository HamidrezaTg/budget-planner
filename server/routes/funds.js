import { Router } from 'express';
import { db } from '../db.js';
import { fundCashFlowsAt, currentMonth, monthsLeftTo } from '../services/model.js';

const router = Router();

// Strict YYYY-MM with a real month number: a loose value like "2026-" passes
// string comparisons but feeds monthsBetween() → NaN balances and progress.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isMonth(value) {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function parseAmount(value, field, { defaultValue, min = -Infinity } = {}) {
  const raw = value === undefined || value === null ? defaultValue : value;
  const amount = Number(raw);
  if (raw === '' || typeof raw === 'boolean' || !Number.isFinite(amount) || amount < min)
    return { error: `${field} must be ${min === 0 ? 'a non-negative' : 'a'} finite number` };
  return { value: amount };
}

function parseTargetAmount(value) {
  if (value === null) return { value: null };
  const parsed = parseAmount(value, 'target_amount', { min: 0 });
  if (parsed.error) return parsed;
  return { value: parsed.value || null };
}

// Funds with balances, goals and recent movements. `month` = balance reference.
router.get('/', (req, res) => {
  if (req.query.month !== undefined && !isMonth(req.query.month))
    return res.status(400).json({ error: 'month must be YYYY-MM' });
  const month = req.query.month ?? currentMonth();
  const funds = db
    .prepare(
      `SELECT f.*, c.name AS category_name FROM funds f
       LEFT JOIN categories c ON c.id = f.category_id ORDER BY f.name`,
    )
    .all()
    .map((f) => {
      const cashFlows = fundCashFlowsAt(f, month);
      const balance = Math.round(cashFlows.balance * 100) / 100;
      const scheduledThisMonth = month >= f.start_month ? f.monthly_contribution : 0;
      const manualThisMonth = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS contributions,
                     COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS withdrawals
              FROM fund_movements WHERE fund_id = ? AND month = ?`,
        )
        .get(f.id, month);

      // goal math: how much per month is still needed to hit the target on time?
      let goal = null;
      if (f.target_amount != null && f.target_amount > 0) {
        const remaining = Math.max(0, f.target_amount - balance);
        const monthsLeft = f.target_date ? monthsLeftTo(month, f.target_date) : null;
        goal = {
          target_amount: f.target_amount,
          target_date: f.target_date ?? null,
          remaining: Math.round(remaining * 100) / 100,
          progress: Math.min(100, Math.round((balance / f.target_amount) * 1000) / 10),
          months_left: monthsLeft,
          monthly_needed:
            monthsLeft === null
              ? null
              : monthsLeft === 0
                ? remaining
                : Math.round((remaining / monthsLeft) * 100) / 100,
          on_track:
            monthsLeft === null
              ? null
              : f.monthly_contribution >= remaining / Math.max(monthsLeft, 1) - 0.01,
        };
      }

      return {
        ...f,
        balance,
        contributed_so_far: Math.round(cashFlows.contributed * 100) / 100,
        withdrawn_so_far: Math.round(cashFlows.withdrawn * 100) / 100,
        scheduled_this_month: Math.round(scheduledThisMonth * 100) / 100,
        manual_contributions_this_month: Math.round(manualThisMonth.contributions * 100) / 100,
        manual_withdrawals_this_month: Math.round(manualThisMonth.withdrawals * 100) / 100,
        negative: balance < 0,
        goal,
      };
    });

  const movements = db
    .prepare(
      `SELECT m.*, f.name AS fund_name FROM fund_movements m
       JOIN funds f ON f.id = m.fund_id ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
    )
    .all();
  res.json({
    month,
    funds,
    movements,
    summary: {
      scheduled_contributions:
        Math.round(funds.reduce((sum, fund) => sum + fund.scheduled_this_month, 0) * 100) / 100,
      balance: Math.round(funds.reduce((sum, fund) => sum + fund.balance, 0) * 100) / 100,
    },
  });
});

// Record a movement: contribution (+) or withdrawal (-)
router.post('/:id/movement', (req, res) => {
  const fund = db.prepare('SELECT * FROM funds WHERE id = ?').get(req.params.id);
  if (!fund) return res.status(404).json({ error: 'Fund not found' });
  const { kind, amount, month, note } = req.body ?? {};
  if (!['contribution', 'withdrawal'].includes(kind))
    return res.status(400).json({ error: "kind must be 'contribution' or 'withdrawal'" });
  const parsedAmount = parseAmount(amount, 'amount', { min: 0 });
  if (parsedAmount.error || parsedAmount.value === 0)
    return res.status(400).json({ error: 'amount must be a positive finite number' });
  const amt = parsedAmount.value;
  const m = month === undefined ? currentMonth() : month;
  if (!isMonth(m)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  db.prepare(
    'INSERT INTO fund_movements (fund_id, month, amount, kind, note) VALUES (?, ?, ?, ?, ?)',
  ).run(fund.id, m, kind === 'contribution' ? amt : -amt, kind, note ?? null);
  res.json({ ok: true });
});

// Edit fund configuration (including goal target)
router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM funds WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fund not found' });
  const b = req.body ?? {};
  let contribution = row.monthly_contribution;
  if (b.monthly_contribution !== undefined) {
    // A negative contribution would be summed as reducing outgoings and
    // silently inflate projected savings.
    const parsed = parseAmount(b.monthly_contribution, 'monthly_contribution', {
      defaultValue: 0,
      min: 0,
    });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    contribution = parsed.value;
  }
  let opening = row.opening_balance;
  if (b.opening_balance !== undefined) {
    const parsed = parseAmount(b.opening_balance, 'opening_balance', { defaultValue: 0 });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    opening = parsed.value;
  }
  if (b.start_month !== undefined && !isMonth(b.start_month))
    return res.status(400).json({ error: 'start_month must be YYYY-MM' });
  if (b.target_date !== undefined && b.target_date !== null && !isMonth(b.target_date))
    return res.status(400).json({ error: 'target_date must be YYYY-MM or null' });
  let targetAmount = row.target_amount;
  if (b.target_amount !== undefined) {
    const parsed = parseTargetAmount(b.target_amount);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    targetAmount = parsed.value;
  }
  db.prepare(
    'UPDATE funds SET name=?, monthly_contribution=?, start_month=?, opening_balance=?, category_id=?, target_amount=?, target_date=? WHERE id=?',
  ).run(
    b.name ?? row.name,
    contribution,
    b.start_month !== undefined ? b.start_month : row.start_month,
    opening,
    b.category_id !== undefined ? b.category_id : row.category_id,
    targetAmount,
    b.target_date !== undefined ? b.target_date : row.target_date,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM funds WHERE id = ?').get(row.id));
});

router.post('/', (req, res) => {
  const {
    name,
    monthly_contribution = 0,
    start_month,
    opening_balance = 0,
    category_id = null,
    target_amount = null,
    target_date = null,
  } = req.body ?? {};
  if (!name?.trim() || !start_month)
    return res.status(400).json({ error: 'name and start_month required' });
  if (!isMonth(start_month)) return res.status(400).json({ error: 'start_month must be YYYY-MM' });
  const parsedContribution = parseAmount(monthly_contribution, 'monthly_contribution', {
    defaultValue: 0,
    min: 0,
  });
  if (parsedContribution.error) return res.status(400).json({ error: parsedContribution.error });
  const parsedOpening = parseAmount(opening_balance, 'opening_balance', { defaultValue: 0 });
  if (parsedOpening.error) return res.status(400).json({ error: parsedOpening.error });
  const parsedTarget = parseTargetAmount(target_amount);
  if (parsedTarget.error) return res.status(400).json({ error: parsedTarget.error });
  if (target_date !== null && !isMonth(target_date))
    return res.status(400).json({ error: 'target_date must be YYYY-MM or null' });
  const contributionValue = parsedContribution.value;
  const opening = parsedOpening.value;
  try {
    const r = db
      .prepare(
        'INSERT INTO funds (name, monthly_contribution, start_month, opening_balance, category_id, target_amount, target_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        name.trim(),
        contributionValue,
        start_month,
        opening,
        category_id,
        parsedTarget.value,
        target_date,
      );
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
