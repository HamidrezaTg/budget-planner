import { Router } from 'express';
import { db } from '../db.js';
import { getAllCategories } from '../services/model.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getAllCategories());
});

// Reference data for dropdowns
router.get('/meta/all', (_req, res) => {
  res.json({
    groups: db.prepare('SELECT * FROM category_groups ORDER BY sort').all(),
    accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all(),
  });
});

function validateCategory(body, currentId = null) {
  const name = body.name?.trim();
  if (!name) return 'Name required';
  const dup = db
    .prepare('SELECT id FROM categories WHERE name = ? AND id != ?')
    .get(name, currentId ?? -1);
  if (dup) return 'Category already exists';
  return null;
}

// Plans must be finite and non-negative: a negative budget would be summed as
// reducing outgoings and silently inflate projected savings.
function validatePlanAmount(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

router.post('/', (req, res) => {
  const b = req.body ?? {};
  const err = validateCategory(b);
  if (err) return res.status(400).json({ error: err });
  const budget = validatePlanAmount(b.monthly_budget);
  if (budget === null)
    return res.status(400).json({ error: 'monthly_budget must be a non-negative number' });
  const r = db
    .prepare(
      `INSERT INTO categories (name, group_id, account_id, monthly_budget, active_from, active_to, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.name.trim(),
      b.group_id ?? null,
      b.account_id ?? null,
      budget,
      b.active_from ?? null,
      b.active_to ?? null,
      b.is_active === false ? 0 : 1,
    );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  // Validate FIRST: a name conflict must not leave the category retired with
  // its budget lines and rules already destroyed.
  const err = validateCategory({ ...row, ...b }, row.id);
  if (err) return res.status(400).json({ error: err });
  let budget = row.monthly_budget;
  if (b.monthly_budget !== undefined) {
    budget = validatePlanAmount(b.monthly_budget);
    if (budget === null)
      return res.status(400).json({ error: 'monthly_budget must be a non-negative number' });
  }

  // Retiring a category also retires its plan and rules (spec §10.3 / D1).
  db.exec('BEGIN');
  try {
    if (b.is_active === false && row.is_active) {
      db.prepare('DELETE FROM budget_lines WHERE category_id = ?').run(row.id);
      db.prepare('DELETE FROM category_rules WHERE category_id = ?').run(row.id);
      db.prepare('DELETE FROM category_automation_rules WHERE category_id = ?').run(row.id);
      db.prepare(
        'UPDATE commitments SET monthly_amount = 0 WHERE category_id = ? AND end_month IS NULL',
      ).run(row.id);
    }
    db.prepare(
      `UPDATE categories SET name=?, group_id=?, account_id=?, monthly_budget=?, active_from=?, active_to=?, is_active=?, roll_overs=?
       WHERE id=?`,
    ).run(
      b.name ?? row.name,
      // `?? row.group_id` made clearing the group impossible (null ?? old → old)
      b.group_id !== undefined ? b.group_id : row.group_id,
      b.account_id !== undefined ? b.account_id : row.account_id,
      budget,
      b.active_from !== undefined ? b.active_from : row.active_from,
      b.active_to !== undefined ? b.active_to : row.active_to,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : row.is_active,
      b.roll_overs !== undefined ? (b.roll_overs ? 1 : 0) : row.roll_overs,
      req.params.id,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(row.id));
});

// Delete a category outright. The schema cascades (ON DELETE SET NULL / CASCADE)
// on group_id, account_id, budget_lines, rules, fund.category_id, etc., so
// transactions keep their amounts but become "untagged".
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const txCount = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?')
    .get(req.params.id).c;
  if (txCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${txCount} transaction(s) are still tagged "${row.name}". Retire the category instead to keep the history.`,
    });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM budget_lines WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM category_rules WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM category_automation_rules WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------- category groups
const GROUP_RE = /^[A-Za-z0-9 .&'\-/()]{1,40}$/;

function validateGroup(body, currentId = null) {
  const name = String(body.name ?? '').trim();
  if (!name) return 'Group name required';
  if (name.length > 40) return 'Group name must be 40 characters or fewer';
  if (!GROUP_RE.test(name)) return 'Group name contains unsupported characters';
  const dup = db
    .prepare('SELECT id FROM category_groups WHERE name = ? AND id != ?')
    .get(name, currentId ?? -1);
  if (dup) return 'Group already exists';
  return null;
}

router.post('/groups', (req, res) => {
  const b = req.body ?? {};
  const err = validateGroup(b);
  if (err) return res.status(400).json({ error: err });
  // Default new groups to the end of the sort order.
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM category_groups').get().s;
  const r = db
    .prepare('INSERT INTO category_groups (name, sort) VALUES (?, ?)')
    .run(String(b.name).trim(), Number.isFinite(Number(b.sort)) ? Number(b.sort) : maxSort + 10);
  res.json(db.prepare('SELECT * FROM category_groups WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/groups/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM category_groups WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const err = validateGroup({ ...row, ...b }, row.id);
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE category_groups SET name = ?, sort = ? WHERE id = ?').run(
    String(b.name).trim(),
    Number.isFinite(Number(b.sort)) ? Number(b.sort) : row.sort,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM category_groups WHERE id = ?').get(req.params.id));
});

router.delete('/groups/:id', (req, res) => {
  const row = db.prepare('SELECT id, name FROM category_groups WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Categories in this group will have group_id set to NULL by the FK cascade
  // (ON DELETE SET NULL), so the data stays intact — we just lose the grouping.
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM category_groups WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true });
});

export default router;
