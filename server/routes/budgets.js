import { Router } from 'express';
import { db } from '../db.js';
import { plannedForCategory, getAllCategories } from '../services/model.js';

const router = Router();

// Budget lines for a month: every active category with its effective plan.
router.get('/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const cats = getAllCategories().filter((c) => c.is_active);
  const lines = cats.map((c) => ({
    category_id: c.id,
    name: c.name,
    group: c.group_name,
    group_sort: c.group_sort ?? 99,
    account: c.account_name,
    standing_plan: c.monthly_budget,
    planned: plannedForCategory(c, month),
    // The client's rollover toggle reads this — omitting it made the toggle
    // always display "off" and always re-enable rollover.
    roll_overs: !!c.roll_overs,
    has_override:
      !!db
        .prepare('SELECT 1 FROM budget_lines WHERE category_id = ? AND month = ?')
        .get(c.id, month),
  }));
  res.json({ month, lines });
});

// Set / clear an override for one category+month. amount null clears it.
router.put('/:month/:categoryId', (req, res) => {
  const { month, categoryId } = req.params;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  const amount = req.body?.amount;
  if (amount === null || amount === undefined || amount === '') {
    db.prepare('DELETE FROM budget_lines WHERE category_id = ? AND month = ?').run(categoryId, month);
  } else {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });
    db.prepare(
      `INSERT INTO budget_lines (category_id, month, planned_amount) VALUES (?, ?, ?)
       ON CONFLICT(category_id, month) DO UPDATE SET planned_amount = excluded.planned_amount`
    ).run(categoryId, month, amt);
  }
  // also allow editing the standing plan in one call
  if (req.body?.standing_amount !== undefined) {
    // Same sign/finite guard as the override: a negative standing plan would
    // be summed as reducing outgoings and silently inflate projected savings.
    const standing = Number(req.body.standing_amount);
    if (!Number.isFinite(standing) || standing < 0)
      return res.status(400).json({ error: 'Invalid standing amount' });
    db.prepare('UPDATE categories SET monthly_budget = ? WHERE id = ?').run(standing, categoryId);
  }
  res.json({ ok: true });
});

export default router;
