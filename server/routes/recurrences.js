import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { currentMonth, addMonths } from '../services/model.js';

const router = Router();

const daysInMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
};

function partsFor(recurrenceId) {
  return db
    .prepare(
      `SELECT p.id, p.category_id, p.amount, p.sort, c.name AS category_name
       FROM recurrence_parts p
       JOIN categories c ON c.id = p.category_id
       WHERE p.recurrence_id = ?
       ORDER BY p.sort, p.id`,
    )
    .all(recurrenceId);
}

function validateParts(parts, total) {
  if (!Array.isArray(parts) || parts.length < 2)
    return { error: 'Provide at least two recurring category parts' };
  let sum = 0;
  const normalized = [];
  for (const [i, part] of parts.entries()) {
    const categoryId = Number(part?.category_id);
    const amount = Number(part?.amount);
    if (
      !Number.isInteger(categoryId) ||
      !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
    )
      return { error: 'Every recurring part needs a valid category' };
    if (!Number.isFinite(amount) || amount === 0)
      return { error: 'Recurring part amounts must be non-zero numbers' };
    sum += amount;
    normalized.push({ category_id: categoryId, amount, sort: i });
  }
  if (Math.abs(sum - total) > 0.01)
    return { error: `Parts sum to ${sum.toFixed(2)} but the recurrence is ${total.toFixed(2)}` };
  return { parts: normalized };
}

function recurrenceWithParts(row) {
  return { ...row, parts: partsFor(row.id) };
}

// Which recurrences are due within a window starting at month M, day D?
// Returns upcoming items (not yet posted for their month).
function upcoming(fromMonth, fromDay, count) {
  const recs = db.prepare('SELECT * FROM recurrences WHERE active = 1 ORDER BY day_of_month').all();
  const items = [];
  let m = fromMonth;
  while (items.length < count) {
    const dim = daysInMonth(m);
    for (const r of recs) {
      const day = Math.min(r.day_of_month, dim);
      if (m === fromMonth && day < fromDay) continue;
      // Already posted for this exact month. A manual post for a FUTURE month
      // must not suppress the current month's item, so compare equality, not >=.
      if (r.last_posted_month === m) continue;
      items.push({
        recurrence_id: r.id,
        month: m,
        day,
        name: r.name,
        amount: r.amount,
        account_id: r.account_id,
        category_id: r.category_id,
        parts: partsFor(r.id),
        auto_post: !!r.auto_post,
      });
      if (items.length >= count) break;
    }
    if (m > addMonths(fromMonth, 13)) break; // safety
    m = addMonths(m, 1);
    if (m === addMonths(fromMonth, 2)) break; // only current + next month
  }
  return items;
}

// Auto-post anything due today or earlier in the current month.
function autoPost() {
  const now = new Date();
  const m = currentMonth();
  const today = now.getDate();
  const recs = db.prepare('SELECT * FROM recurrences WHERE active = 1 AND auto_post = 1').all();
  let posted = 0;
  for (const r of recs) {
    const day = Math.min(r.day_of_month, daysInMonth(m));
    if (today < day) continue;
    // Skip only if the CURRENT month was already posted. A future-month manual
    // post sets last_posted_month ahead, but must not suppress this month.
    if (r.last_posted_month === m) continue;
    if (post(r, m, day)) posted++;
  }
  return posted;
}

function post(r, month, day) {
  const dedupKey = `rec|${r.id}|${month}`;
  // Recurring amounts are planning figures — they live in the base currency.
  // Returns true only when a row was actually created; re-attempts hit the
  // dedup key (e.g. a future month was posted early) and must not count.
  const parts = partsFor(r.id);
  const date = `${month}-${String(day).padStart(2, '0')}`;
  const currency = getSetting('currency') || 'EUR';
  const group = parts.length >= 2 ? `rec-${r.id}-${month}` : null;
  db.exec('BEGIN');
  try {
    const ins = db
      .prepare(
        `INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, split_group)
         VALUES (?, ?, ?, 'Recurring', ?, ?, ?, 0, 'recurring', ?, ?)
         ON CONFLICT(dedup_key) DO NOTHING`,
      )
      .run(
        date,
        r.name,
        r.amount,
        currency,
        r.account_id,
        parts.length >= 2 ? null : r.category_id,
        dedupKey,
        group,
      );
    if (ins.changes > 0 && parts.length >= 2) {
      const child = db.prepare(
        `INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, split_group, split_of)
         VALUES (?, ?, ?, 'Recurring', ?, ?, ?, 0, 'recurring', ?, ?, ?)`,
      );
      parts.forEach((part, i) =>
        child.run(
          date,
          r.name,
          part.amount,
          currency,
          r.account_id,
          part.category_id,
          `${dedupKey}|part|${i}`,
          group,
          ins.lastInsertRowid,
        ),
      );
    }
    // Never let last_posted_month move backwards (e.g. posting a past month).
    db.prepare(
      `UPDATE recurrences
       SET last_posted_month = CASE
         WHEN last_posted_month IS NULL OR ? > last_posted_month THEN ?
         ELSE last_posted_month END
       WHERE id = ?`,
    ).run(month, month, r.id);
    db.exec('COMMIT');
    return ins.changes > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, a.name AS account_name, c.name AS category_name
       FROM recurrences r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN categories c ON c.id = r.category_id
       ORDER BY r.day_of_month, r.name`,
    )
    .all()
    .map(recurrenceWithParts);
  const up = upcoming(currentMonth(), new Date().getDate(), 12);
  res.json({ recurrences: rows, upcoming: up, autoPosted: 0 });
});

// Posting due recurrences changes transactions and must never happen as a
// side-effect of a read request.
router.post('/auto-post', (_req, res) => {
  res.json({ ok: true, autoPosted: autoPost() });
});

router.post('/', (req, res) => {
  const {
    name,
    amount,
    day_of_month,
    account_id = null,
    category_id = null,
    auto_post = false,
    parts,
  } = req.body ?? {};
  const day = Number(day_of_month);
  const total = Number(amount);
  if (!name?.trim() || !Number.isFinite(total) || !(day >= 1 && day <= 28))
    return res.status(400).json({ error: 'name, signed amount and day_of_month (1-28) required' });
  if (
    account_id !== null &&
    account_id !== undefined &&
    !db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)
  )
    return res.status(400).json({ error: 'account_id must reference a valid account' });
  if (
    category_id !== null &&
    category_id !== undefined &&
    !db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id)
  )
    return res.status(400).json({ error: 'category_id must reference a valid category' });
  const checked = parts === undefined ? { parts: null } : validateParts(parts, total);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const r = db
    .prepare(
      'INSERT INTO recurrences (name, amount, day_of_month, account_id, category_id, auto_post) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      name.trim(),
      total,
      day,
      account_id,
      checked.parts ? null : category_id,
      auto_post ? 1 : 0,
    );
  if (checked.parts) {
    const insPart = db.prepare(
      'INSERT INTO recurrence_parts (recurrence_id, category_id, amount, sort) VALUES (?, ?, ?, ?)',
    );
    checked.parts.forEach((part) =>
      insPart.run(r.lastInsertRowid, part.category_id, part.amount, part.sort),
    );
  }
  res.json(
    recurrenceWithParts(
      db.prepare('SELECT * FROM recurrences WHERE id = ?').get(r.lastInsertRowid),
    ),
  );
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recurrences WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  // Same validation as POST: PATCH must not become the path around it.
  if (
    b.day_of_month !== undefined &&
    !(Number(b.day_of_month) >= 1 && Number(b.day_of_month) <= 28)
  )
    return res.status(400).json({ error: 'day_of_month must be 1-28' });
  if (b.amount !== undefined && !Number.isFinite(Number(b.amount)))
    return res.status(400).json({ error: 'amount must be a number' });
  if (b.name !== undefined && !b.name?.trim())
    return res.status(400).json({ error: 'name must not be empty' });
  const total = Number(b.amount ?? row.amount);
  const accountId = b.account_id !== undefined ? b.account_id : row.account_id;
  if (
    accountId !== null &&
    accountId !== undefined &&
    !db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  )
    return res.status(400).json({ error: 'account_id must reference a valid account' });
  if (
    b.category_id !== undefined &&
    b.category_id !== null &&
    !db.prepare('SELECT id FROM categories WHERE id = ?').get(b.category_id)
  )
    return res.status(400).json({ error: 'category_id must reference a valid category' });
  const existingParts = partsFor(row.id);
  const checked =
    b.parts === undefined
      ? existingParts.length >= 2
        ? validateParts(existingParts, total)
        : { parts: undefined }
      : b.parts === null
        ? { parts: null }
        : validateParts(b.parts, total);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const categoryId = Array.isArray(checked.parts)
    ? null
    : b.category_id !== undefined
      ? b.category_id
      : row.category_id;
  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE recurrences SET name=?, amount=?, day_of_month=?, account_id=?, category_id=?, auto_post=?, active=? WHERE id=?',
    ).run(
      b.name !== undefined ? b.name.trim() : row.name,
      total,
      Number(b.day_of_month ?? row.day_of_month),
      accountId,
      categoryId,
      b.auto_post !== undefined ? (b.auto_post ? 1 : 0) : row.auto_post,
      b.active !== undefined ? (b.active ? 1 : 0) : row.active,
      req.params.id,
    );
    if (b.parts !== undefined) {
      db.prepare('DELETE FROM recurrence_parts WHERE recurrence_id = ?').run(row.id);
      if (checked.parts) {
        const insPart = db.prepare(
          'INSERT INTO recurrence_parts (recurrence_id, category_id, amount, sort) VALUES (?, ?, ?, ?)',
        );
        checked.parts.forEach((part) =>
          insPart.run(row.id, part.category_id, part.amount, part.sort),
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json(recurrenceWithParts(db.prepare('SELECT * FROM recurrences WHERE id = ?').get(row.id)));
});

// Post an upcoming item now (creates the real transaction).
router.post('/:id/post', (req, res) => {
  const r = db.prepare('SELECT * FROM recurrences WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const raw = req.body?.month ?? currentMonth();
  const match = /^(\d{4})-(\d{2})$/.exec(String(raw));
  if (!match) return res.status(400).json({ error: 'month must be a valid YYYY-MM' });
  const [, y, mo] = match;
  if (Number(mo) < 1 || Number(mo) > 12)
    return res.status(400).json({ error: 'month must be a valid YYYY-MM' });
  const month = `${y}-${mo}`;
  const day = Math.min(r.day_of_month, daysInMonth(month));
  post(r, month, day);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM recurrences WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
