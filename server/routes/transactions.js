import { Router } from 'express';
import { db } from '../db.js';
import { learnRule, categorizeTransaction, createAutomationRule } from '../services/categorizer.js';

const router = Router();

router.get('/', (req, res) => {
  const { month, review, category_id, limit = 500, offset = 0 } = req.query;
  const where = [];
  const params = [];

  if (month) {
    where.push(`substr(date, 1, 7) = ?`);
    params.push(month);
  }
  if (review === '1') where.push(`needs_review = 1`);
  if (category_id) {
    where.push(`category_id = ?`);
    params.push(Number(category_id));
  }

  const sql = `
    SELECT t.*, c.name AS category_name,
      (SELECT COUNT(*) FROM transactions x WHERE x.split_of = t.id) AS split_parts,
      (SELECT description FROM transactions p WHERE p.id = t.split_of) AS split_parent_desc
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, Number(limit), Number(offset));

  const countSql = `SELECT COUNT(*) AS c FROM transactions t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(countSql).get(...params).c;

  res.json({ rows, total });
});

router.patch('/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const { category_id, remember = false, keyword } = req.body ?? {};
  if (category_id !== undefined && category_id !== null) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!cat) return res.status(400).json({ error: 'Unknown category' });
  }
  db.prepare(
    'UPDATE transactions SET category_id = ?, needs_review = 0 WHERE id = ?'
  ).run(category_id ?? null, req.params.id);

  if (remember && category_id) {
    learnRule(keyword || tx.description, category_id);
  }
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------- splits
// Split a transaction into parts across categories. The original row becomes
// a parent that is excluded from all sums; children carry the amounts.
router.post('/:id/split', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.split_group) return res.status(400).json({ error: 'Transaction is already split (or a split part)' });

  const parts = req.body?.parts;
  if (!Array.isArray(parts) || parts.length < 2)
    return res.status(400).json({ error: 'Provide at least two parts' });

  const sum = parts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (Math.abs(sum - tx.amount) > 0.01)
    return res.status(400).json({
      error: `Parts sum to ${sum.toFixed(2)} but the transaction is ${tx.amount.toFixed(2)}`,
    });
  for (const p of parts) {
    if (!p.category_id || !db.prepare('SELECT id FROM categories WHERE id = ?').get(p.category_id))
      return res.status(400).json({ error: 'Every part needs a valid category' });
    if (!Number(p.amount)) return res.status(400).json({ error: 'Part amounts must be non-zero' });
  }

  const group = `split-${tx.id}-${Date.now()}`;
  const ins = db.prepare(
    `INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, split_group, split_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  );
  db.exec('BEGIN');
  try {
    parts.forEach((p, i) => {
      ins.run(
        tx.date, tx.description, Number(p.amount), tx.tx_type, tx.currency,
        tx.account_id, Number(p.category_id), `split:${tx.id}`, `split|${tx.id}|${i}`,
        group, tx.id
      );
    });
    db.prepare('UPDATE transactions SET split_group = ? WHERE id = ?').run(group, tx.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, parts: parts.length });
});

// Undo a split: remove children, clear the parent.
router.post('/:id/unsplit', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (!tx.split_group) return res.status(400).json({ error: 'Not split' });
  if (tx.split_of) return res.status(400).json({ error: 'This is a split part — delete it instead' });
  db.prepare('DELETE FROM transactions WHERE split_of = ?').run(tx.id);
  db.prepare('UPDATE transactions SET split_group = NULL WHERE id = ?').run(tx.id);
  res.json({ ok: true });
});

// Rules management
router.get('/rules/all', (_req, res) => {
  const keywordRules = db
      .prepare(
        `SELECT r.*, c.name AS category_name,
                (SELECT COUNT(*) FROM transactions t WHERE LOWER(t.description) LIKE '%' || r.keyword || '%') AS matches
         FROM category_rules r JOIN categories c ON c.id = r.category_id
         ORDER BY r.keyword`
      )
      .all()
      .map((r) => ({ ...r, rule_type: 'keyword' }));
  const automationRules = db
    .prepare(
      `SELECT r.*, c.name AS category_name,
              (SELECT COUNT(*) FROM transactions t
               WHERE (r.description_contains IS NULL OR LOWER(t.description) LIKE '%' || LOWER(r.description_contains) || '%')
                 AND (r.amount_min IS NULL OR ABS(t.amount) >= r.amount_min)
                 AND (r.amount_max IS NULL OR ABS(t.amount) <= r.amount_max)
                 AND (r.account_id IS NULL OR t.account_id = r.account_id)
                 AND (r.tx_type IS NULL OR LOWER(COALESCE(t.tx_type, '')) = LOWER(r.tx_type))) AS matches
       FROM category_automation_rules r JOIN categories c ON c.id = r.category_id
       ORDER BY r.priority DESC, r.id`
    )
    .all()
    .map((r) => ({ ...r, rule_type: 'advanced' }));
  res.json([...automationRules, ...keywordRules]);
});

router.post('/rules', (req, res) => {
  const { keyword, category_id } = req.body ?? {};
  if (!keyword?.trim() || !category_id)
    return res.status(400).json({ error: 'keyword and category_id required' });
  learnRule(keyword, category_id);
  res.json({ ok: true });
});

router.post('/rules/advanced', (req, res) => {
  const b = req.body ?? {};
  const hasCondition = [b.description_contains, b.amount_min, b.amount_max, b.account_id, b.tx_type]
    .some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (!b.category_id || !hasCondition)
    return res.status(400).json({ error: 'At least one condition and a category are required' });
  if (b.amount_min !== '' && b.amount_min != null && !Number.isFinite(Number(b.amount_min)))
    return res.status(400).json({ error: 'Minimum amount must be numeric' });
  if (b.amount_max !== '' && b.amount_max != null && !Number.isFinite(Number(b.amount_max)))
    return res.status(400).json({ error: 'Maximum amount must be numeric' });
  if (b.amount_min !== '' && b.amount_max !== '' && b.amount_min != null && b.amount_max != null && Number(b.amount_min) > Number(b.amount_max))
    return res.status(400).json({ error: 'Minimum amount cannot exceed maximum amount' });
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(b.category_id))
    return res.status(400).json({ error: 'Unknown category' });
  res.json(createAutomationRule(b));
});

router.post('/rules/test', (req, res) => {
  const result = categorizeTransaction({
    description: req.body?.description || '',
    amount: Number(req.body?.amount) || 0,
    account_id: req.body?.account_id || null,
    tx_type: req.body?.tx_type || '',
  });
  res.json(result
    ? { category_id: result.category_id, category_name: result.category_name || null, rule: result.rule }
    : { category_id: null, category_name: null, rule: null });
});

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/rules/advanced/:id', (req, res) => {
  db.prepare('DELETE FROM category_automation_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
