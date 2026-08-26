import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { currentMonth, addMonths } from '../services/model.js';

const router = Router();

const daysInMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
};

// Which recurrences are due within a window starting at month M, day D?
// Returns upcoming items (not yet posted for their month).
function upcoming(fromMonth, fromDay, count) {
  const recs = db.prepare('SELECT * FROM recurrences WHERE active = 1 ORDER BY day_of_month').all();
  const items = [];
  let m = fromMonth;
  let d = fromDay;
  while (items.length < count) {
    const dim = daysInMonth(m);
    for (const r of recs) {
      const day = Math.min(r.day_of_month, dim);
      if (m === fromMonth && day < fromDay) continue;
      if (r.last_posted_month && r.last_posted_month >= m && day <= fromDay && m === fromMonth) {
        // already posted this month
        continue;
      }
      if (r.last_posted_month === m) continue;
      items.push({
        recurrence_id: r.id,
        month: m,
        day,
        name: r.name,
        amount: r.amount,
        account_id: r.account_id,
        category_id: r.category_id,
        auto_post: !!r.auto_post,
      });
      if (items.length >= count) break;
    }
    if (m > addMonths(fromMonth, 13)) break; // safety
    m = addMonths(m, 1);
    d = 1;
    if (m === addMonths(fromMonth, 2)) break; // only current + next month
  }
  return items;
}

// Auto-post anything due today or earlier in the current month.
function autoPost() {
  const now = new Date();
  const m = currentMonth();
  const today = now.getDate();
  const recs = db
    .prepare('SELECT * FROM recurrences WHERE active = 1 AND auto_post = 1')
    .all();
  let posted = 0;
  for (const r of recs) {
    const day = Math.min(r.day_of_month, daysInMonth(m));
    if (today < day) continue;
    if (r.last_posted_month && r.last_posted_month >= m) continue;
    post(r, m, day);
    posted++;
  }
  return posted;
}

function post(r, month, day) {
  const dedupKey = `rec|${r.id}|${month}`;
  // Recurring amounts are planning figures — they live in the base currency.
  db.prepare(
    `INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key)
     VALUES (?, ?, ?, 'Recurring', ?, ?, ?, 0, 'recurring', ?)
     ON CONFLICT(dedup_key) DO NOTHING`
  ).run(`${month}-${String(day).padStart(2, '0')}`, r.name, r.amount, getSetting('currency') || 'EUR', r.account_id, r.category_id, dedupKey);
  db.prepare('UPDATE recurrences SET last_posted_month = ? WHERE id = ?').run(month, r.id);
}

router.get('/', (req, res) => {
  const posted = autoPost();
  const rows = db
    .prepare(
      `SELECT r.*, a.name AS account_name, c.name AS category_name
       FROM recurrences r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN categories c ON c.id = r.category_id
       ORDER BY r.day_of_month, r.name`
    )
    .all();
  const up = upcoming(currentMonth(), new Date().getDate(), 12);
  res.json({ recurrences: rows, upcoming: up, autoPosted: posted });
});

router.post('/', (req, res) => {
  const { name, amount, day_of_month, account_id = null, category_id = null, auto_post = false } = req.body ?? {};
  const day = Number(day_of_month);
  if (!name?.trim() || isNaN(Number(amount)) || !(day >= 1 && day <= 28))
    return res.status(400).json({ error: 'name, signed amount and day_of_month (1-28) required' });
  const r = db
    .prepare(
      'INSERT INTO recurrences (name, amount, day_of_month, account_id, category_id, auto_post) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name.trim(), Number(amount), day, account_id, category_id, auto_post ? 1 : 0);
  res.json(db.prepare('SELECT * FROM recurrences WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recurrences WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  db.prepare(
    'UPDATE recurrences SET name=?, amount=?, day_of_month=?, account_id=?, category_id=?, auto_post=?, active=? WHERE id=?'
  ).run(
    b.name ?? row.name,
    Number(b.amount ?? row.amount),
    Number(b.day_of_month ?? row.day_of_month),
    b.account_id !== undefined ? b.account_id : row.account_id,
    b.category_id !== undefined ? b.category_id : row.category_id,
    b.auto_post !== undefined ? (b.auto_post ? 1 : 0) : row.auto_post,
    b.active !== undefined ? (b.active ? 1 : 0) : row.active,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM recurrences WHERE id = ?').get(row.id));
});

// Post an upcoming item now (creates the real transaction).
router.post('/:id/post', (req, res) => {
  const r = db.prepare('SELECT * FROM recurrences WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const month = /^\d{4}-\d{2}$/.test(req.body?.month ?? '') ? req.body.month : currentMonth();
  const day = Math.min(r.day_of_month, daysInMonth(month));
  post(r, month, day);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM recurrences WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
