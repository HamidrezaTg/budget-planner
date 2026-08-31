import { Router } from 'express';
import { db, DATA_DIR, safeDbFilename } from '../db.js';
import path from 'node:path';
import fs from 'node:fs';
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
    SELECT t.*, c.name AS category_name, f.name AS fund_name,
      (SELECT COUNT(*) FROM transactions x WHERE x.split_of = t.id) AS split_parts,
      (SELECT description FROM transactions p WHERE p.id = t.split_of) AS split_parent_desc,
      (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN funds f ON f.id = t.fund_id
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

  const b = req.body ?? {};
  const sets = [];
  const args = [];

  if (b.category_id !== undefined) {
    if (b.category_id !== null) {
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(b.category_id));
      if (!cat) return res.status(400).json({ error: 'Unknown category' });
    }
    sets.push('category_id = ?');
    args.push(b.category_id);
    // Assigning a category clears the review flag; clearing it leaves review
    // as it was so the row isn't accidentally hidden.
    sets.push('needs_review = 0');
  }

  if (b.fund_id !== undefined) {
    if (b.fund_id !== null) {
      const f = db.prepare('SELECT id FROM funds WHERE id = ?').get(Number(b.fund_id));
      if (!f) return res.status(400).json({ error: 'Unknown fund' });
    }
    sets.push('fund_id = ?');
    args.push(b.fund_id);
  }

  if (b.transfer_group !== undefined) {
    // Allow setting a token to mark this row as part of a transfer pair, or
    // clearing it (null) to make the row count as normal spend/income again.
    sets.push('transfer_group = ?');
    args.push(b.transfer_group === null || b.transfer_group === '' ? null : String(b.transfer_group).slice(0, 80));
  }

  if (b.description !== undefined) {
    const d = String(b.description).trim();
    if (!d) return res.status(400).json({ error: 'description cannot be empty' });
    sets.push('description = ?');
    args.push(d);
  }

  if (b.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    sets.push('date = ?');
    args.push(b.date);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No editable fields provided' });

  args.push(req.params.id);
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  if (b.remember && b.category_id) {
    learnRule(b.keyword || tx.description, b.category_id);
  }

  res.json(
    db
      .prepare(
        `SELECT t.*, c.name AS category_name, f.name AS fund_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN funds f ON f.id = t.fund_id
         WHERE t.id = ?`
      )
      .get(req.params.id)
  );
});

router.delete('/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.split_of) {
    return res.status(400).json({
      error: 'Cannot delete a split part directly — undo the split from its parent first',
    });
  }

  // Deleting a split parent removes its children via the ON DELETE CASCADE
  // foreign key (enforced since v3.9). Attachment files are not stored by
  // SQLite, so collect them for the parent AND all children first, then unlink
  // only after the delete committed — if it rolled back, the rows would
  // survive pointing at missing files.
  const ids = [
    tx.id,
    ...db.prepare('SELECT id FROM transactions WHERE split_of = ?').all(tx.id).map((r) => r.id),
  ];
  const placeholders = ids.map(() => '?').join(',');
  const files = db
    .prepare(`SELECT filename FROM attachments WHERE transaction_id IN (${placeholders})`)
    .all(...ids);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (files.length) {
    const dir = path.join(DATA_DIR, 'uploads', safeDbFilename(req.username));
    for (const f of files) {
      const resolved = path.resolve(dir, f.filename);
      if (resolved.startsWith(path.resolve(dir) + path.sep)) {
        try { fs.unlinkSync(resolved); } catch {}
      }
    }
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------- manual create
// Manually enter one or more transactions (no CSV). Same dedup rules as
// import: identical date + amount(2dp) + currency + normalized description
// within the same file is folded; split/recurrence prefixes stay untouched.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function computeDedupKey(date, amount, currency, description) {
  const desc = String(description ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${date}|${Number(amount).toFixed(2)}|${currency}|${desc}`;
}

function buildInsertStatement() {
  // Mirrors the columns used by parser.js transactionsFromGrid; the source_file
  // tag marks these as user-entered so a future re-import of the same statement
  // does not collide.
  return db.prepare(
    `INSERT INTO transactions
       (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, fund_id, transfer_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
}

function validateManualEntry(t, index) {
  const errors = [];
  if (!t || typeof t !== 'object') errors.push(`row ${index + 1}: not an object`);
  else {
    if (!DATE_RE.test(t.date || '')) errors.push(`row ${index + 1}: date must be YYYY-MM-DD`);
    const desc = String(t.description ?? '').trim();
    if (!desc || desc.length > 200) errors.push(`row ${index + 1}: description required (1-200 chars)`);
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt === 0) errors.push(`row ${index + 1}: amount must be a non-zero number`);
    const currency = String(t.currency ?? 'EUR').toUpperCase();
    if (currency.length !== 3) errors.push(`row ${index + 1}: currency must be 3 letters`);
    if (t.account_id != null && t.account_id !== '') {
      const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(t.account_id));
      if (!acc) errors.push(`row ${index + 1}: account not found`);
    }
    if (t.category_id != null && t.category_id !== '') {
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(t.category_id));
      if (!cat) errors.push(`row ${index + 1}: category not found`);
    }
    if (t.fund_id != null && t.fund_id !== '') {
      const f = db.prepare('SELECT id FROM funds WHERE id = ?').get(Number(t.fund_id));
      if (!f) errors.push(`row ${index + 1}: fund not found`);
    }
  }
  return errors;
}

function insertOne(t) {
  const amt = Number(t.amount);
  const currency = String(t.currency ?? 'EUR').toUpperCase();
  const accountId = t.account_id != null && t.account_id !== '' ? Number(t.account_id) : null;
  const categoryId = t.category_id != null && t.category_id !== '' ? Number(t.category_id) : null;
  const fundId = t.fund_id != null && t.fund_id !== '' ? Number(t.fund_id) : null;
  const txType = t.tx_type ? String(t.tx_type).slice(0, 40) : null;
  const transferGroup = t.transfer_group ? String(t.transfer_group).slice(0, 80) : null;
  const dedupKey = computeDedupKey(t.date, amt, currency, t.description);
  const result = buildInsertStatement().run(
    t.date,
    String(t.description).trim(),
    amt,
    txType,
    currency,
    accountId,
    categoryId,
    categoryId ? 0 : 1,
    'manual',
    dedupKey,
    fundId,
    transferGroup
  );
  return result.lastInsertRowid;
}

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const list = Array.isArray(body) ? body : [body];
  if (list.length === 0) return res.status(400).json({ error: 'Provide at least one transaction' });
  if (list.length > 200) return res.status(400).json({ error: 'Bulk add is limited to 200 transactions per request' });

  const errors = [];
  for (let i = 0; i < list.length; i++) {
    errors.push(...validateManualEntry(list[i], i));
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const created = [];
  const duplicates = [];
  db.exec('BEGIN');
  try {
    for (const t of list) {
      const dedupKey = computeDedupKey(t.date, Number(t.amount), String(t.currency ?? 'EUR').toUpperCase(), t.description);
      const existing = db.prepare('SELECT id FROM transactions WHERE dedup_key = ?').get(dedupKey);
      if (existing) {
        duplicates.push({ dedup_key: dedupKey, existing_id: existing.id });
        continue;
      }
      const id = insertOne(t);
      created.push({ id, dedup_key: dedupKey });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, created: created.length, duplicates: duplicates.length, ids: created.map((c) => c.id) });
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

  // Collect attachment files of the split children, delete the rows, and only
  // unlink after the delete committed (see DELETE above).
  const children = db.prepare('SELECT id FROM transactions WHERE split_of = ?').all(tx.id);
  let files = [];
  if (children.length) {
    const ids = children.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    files = db
      .prepare(`SELECT filename FROM attachments WHERE transaction_id IN (${placeholders})`)
      .all(...ids);
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions WHERE split_of = ?').run(tx.id);
    db.prepare('UPDATE transactions SET split_group = NULL WHERE id = ?').run(tx.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (files.length) {
    const dir = path.join(DATA_DIR, 'uploads', safeDbFilename(req.username));
    for (const f of files) {
      const resolved = path.resolve(dir, f.filename);
      if (resolved.startsWith(path.resolve(dir) + path.sep)) {
        try { fs.unlinkSync(resolved); } catch {}
      }
    }
  }
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
