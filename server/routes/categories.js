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

router.post('/', (req, res) => {
  const b = req.body ?? {};
  const err = validateCategory(b);
  if (err) return res.status(400).json({ error: err });
  const r = db
    .prepare(
      `INSERT INTO categories (name, group_id, account_id, monthly_budget, active_from, active_to, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.name.trim(),
      b.group_id ?? null,
      b.account_id ?? null,
      Number(b.monthly_budget) || 0,
      b.active_from ?? null,
      b.active_to ?? null,
      b.is_active === false ? 0 : 1
    );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  // Retiring a category also retires its plan and rules (spec §10.3 / D1)
  if (b.is_active === false && row.is_active) {
    db.prepare('DELETE FROM budget_lines WHERE category_id = ?').run(row.id);
    db.prepare('DELETE FROM category_rules WHERE category_id = ?').run(row.id);
    db.prepare(
      'UPDATE commitments SET monthly_amount = 0 WHERE category_id = ? AND end_month IS NULL'
    ).run(row.id);
  }
  const err = validateCategory({ ...row, ...b }, row.id);
  if (err) return res.status(400).json({ error: err });
  db.prepare(
    `UPDATE categories SET name=?, group_id=?, account_id=?, monthly_budget=?, active_from=?, active_to=?, is_active=?, roll_overs=?
     WHERE id=?`
  ).run(
    b.name ?? row.name,
    b.group_id ?? row.group_id,
    b.account_id !== undefined ? b.account_id : row.account_id,
    Number(b.monthly_budget ?? row.monthly_budget) || 0,
    b.active_from !== undefined ? b.active_from : row.active_from,
    b.active_to !== undefined ? b.active_to : row.active_to,
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : row.is_active,
    b.roll_overs !== undefined ? (b.roll_overs ? 1 : 0) : row.roll_overs,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(row.id));
});

export default router;
