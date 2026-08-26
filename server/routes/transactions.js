import { Router } from 'express';
import { db } from '../db.js';
import { learnRule, categorize } from '../services/categorizer.js';

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
    SELECT t.*, c.name AS category_name
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

// Rules management
router.get('/rules/all', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT r.*, c.name AS category_name,
                (SELECT COUNT(*) FROM transactions t WHERE LOWER(t.description) LIKE '%' || r.keyword || '%') AS matches
         FROM category_rules r JOIN categories c ON c.id = r.category_id
         ORDER BY r.keyword`
      )
      .all()
  );
});

router.post('/rules', (req, res) => {
  const { keyword, category_id } = req.body ?? {};
  if (!keyword?.trim() || !category_id)
    return res.status(400).json({ error: 'keyword and category_id required' });
  learnRule(keyword, category_id);
  res.json({ ok: true });
});

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
