import { Router } from 'express';
import { db, DATA_DIR, safeDbFilename } from '../db.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  learnRule,
  unlearnRule,
  categorizeTransaction,
  createAutomationRule,
} from '../services/categorizer.js';

const router = Router();
const DEFAULT_TRANSACTION_LIMIT = 500;
const MAX_TRANSACTION_LIMIT = 1000;
// Hard ceiling for `limit=all` (the single-page Transactions table). Bounds
// memory even if a user has imported tens of thousands of rows.
const MAX_ALL_ROWS = 10000;

function paginationParams(query, res) {
  const parse = (name, fallback, minimum, maximum) => {
    const raw = query[name] ?? fallback;
    if (Array.isArray(raw) || !/^\d+$/.test(String(raw))) {
      res.status(400).json({
        error: `${name} must be an integer${maximum ? ` between ${minimum} and ${maximum}` : ' greater than or equal to 0'}`,
      });
      return null;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || (maximum && value > maximum)) {
      res.status(400).json({
        error: `${name} must be an integer${maximum ? ` between ${minimum} and ${maximum}` : ' greater than or equal to 0'}`,
      });
      return null;
    }
    return value;
  };

  // limit=all fetches the whole filtered set for the single-page table.
  if (query.limit === 'all') return { limit: MAX_ALL_ROWS, offset: 0 };
  const limit = parse('limit', DEFAULT_TRANSACTION_LIMIT, 1, MAX_TRANSACTION_LIMIT);
  if (limit === null) return null;
  const offset = parse('offset', 0, 0);
  if (offset === null) return null;
  return { limit, offset };
}

// Column filters for the Transactions table. Returns { where, params } or
// null (after responding 400) when a value is malformed.
function transactionFilters(query, res) {
  const where = [];
  const params = [];
  const likeEscape = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

  if (query.q !== undefined && String(query.q).trim() !== '') {
    where.push(`LOWER(t.description) LIKE ? ESCAPE '\\'`);
    params.push(`%${likeEscape(String(query.q).trim().toLowerCase())}%`);
  }
  if (query.account_id !== undefined && String(query.account_id) !== '') {
    const id = Number(query.account_id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'account_id must be a positive integer' });
      return null;
    }
    where.push('t.account_id = ?');
    params.push(id);
  }
  if (query.category_id !== undefined && String(query.category_id) !== '') {
    const id = Number(query.category_id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'category_id must be a positive integer' });
      return null;
    }
    where.push('t.category_id = ?');
    params.push(id);
  }
  if (query.tx_type !== undefined && String(query.tx_type).trim() !== '') {
    where.push('LOWER(COALESCE(t.tx_type, "")) = LOWER(?)');
    params.push(String(query.tx_type).trim());
  }
  for (const [field, column, cmp] of [
    ['date_from', 't.date', '>='],
    ['date_to', 't.date', '<='],
  ]) {
    if (query[field] !== undefined && String(query[field]) !== '') {
      if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(query[field]))) {
        res.status(400).json({ error: `${field} must be a date in YYYY-MM-DD format` });
        return null;
      }
      where.push(`${column} ${cmp} ?`);
      params.push(String(query[field]));
    }
  }
  for (const field of ['amount_min', 'amount_max']) {
    if (query[field] !== undefined && String(query[field]) !== '') {
      const value = Number(query[field]);
      if (!Number.isFinite(value)) {
        res.status(400).json({ error: `${field} must be a number` });
        return null;
      }
      where.push(`ABS(t.amount) ${field === 'amount_min' ? '>=' : '<='} ?`);
      params.push(Math.abs(value));
    }
  }
  if (query.transfer === '1') where.push('t.transfer_group IS NOT NULL');
  else if (query.transfer === '0') where.push('t.transfer_group IS NULL');
  return { where, params };
}

router.get('/', (req, res) => {
  const { month, review } = req.query;
  const pagination = paginationParams(req.query, res);
  if (!pagination) return;
  const filters = transactionFilters(req.query, res);
  if (!filters) return;
  const { where, params } = filters;

  if (month) {
    where.push(`substr(date, 1, 7) = ?`);
    params.push(month);
  }
  if (review === '1') where.push(`needs_review = 1`);

  const sql = `
    SELECT t.*, c.name AS category_name, f.name AS fund_name, cm.name AS commitment_name,
      a.name AS account_name,
      (SELECT COUNT(*) FROM transactions x WHERE x.split_of = t.id) AS split_parts,
      (SELECT description FROM transactions p WHERE p.id = t.split_of) AS split_parent_desc,
      (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN funds f ON f.id = t.fund_id
    LEFT JOIN commitments cm ON cm.id = t.commitment_id
    LEFT JOIN accounts a ON a.id = t.account_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, pagination.limit, pagination.offset);

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

  const lookupId = (value, table, label) => {
    if (value === null || value === '') return null;
    const id = Number(value);
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)
    ) {
      return { error: `Unknown ${label}` };
    }
    return id;
  };

  let categoryId = tx.category_id;
  let fundId = tx.fund_id;
  let commitmentId = tx.commitment_id;

  if (b.account_id !== undefined) {
    const value = lookupId(b.account_id, 'accounts', 'account');
    if (value?.error) return res.status(400).json(value);
    if (tx.transfer_group && value !== tx.account_id)
      return res.status(400).json({ error: 'Unpair a transfer before changing its account' });
    sets.push('account_id = ?');
    args.push(value);
  }

  if (b.category_id !== undefined) {
    const value = lookupId(b.category_id, 'categories', 'category');
    if (value?.error) return res.status(400).json(value);
    categoryId = value;
    sets.push('category_id = ?');
    args.push(value);
    // Assigning a category clears the review flag; clearing it leaves review
    // as it was so the row isn't accidentally hidden.
    sets.push('needs_review = 0');
  }

  if (b.fund_id !== undefined) {
    const value = lookupId(b.fund_id, 'funds', 'fund');
    if (value?.error) return res.status(400).json(value);
    fundId = value;
    sets.push('fund_id = ?');
    args.push(value);
  }

  if (b.commitment_id !== undefined) {
    const value = lookupId(b.commitment_id, 'commitments', 'commitment');
    if (value?.error) return res.status(400).json(value);
    commitmentId = value;
    sets.push('commitment_id = ?');
    args.push(value);
  }

  if (b.transfer_group !== undefined) {
    // Allow setting a token to mark this row as part of a transfer pair, or
    // clearing it (null) to make the row count as normal spend/income again.
    const group =
      b.transfer_group === null || b.transfer_group === ''
        ? null
        : String(b.transfer_group).slice(0, 80);
    if (group && (categoryId !== null || fundId !== null || commitmentId !== null))
      return res
        .status(400)
        .json({ error: 'Transfer rows cannot have a category, fund, or commitment' });
    sets.push('transfer_group = ?');
    args.push(group);
    if (group) sets.push('needs_review = 0');
  }

  if (fundId !== null && commitmentId !== null)
    return res.status(400).json({ error: 'A transaction can use a fund or commitment, not both' });

  if (tx.transfer_group && (categoryId !== null || fundId !== null || commitmentId !== null))
    return res
      .status(400)
      .json({ error: 'Transfer rows cannot have a category, fund, or commitment' });

  if (b.description !== undefined) {
    const d = String(b.description).trim();
    if (!d) return res.status(400).json({ error: 'description cannot be empty' });
    sets.push('description = ?');
    args.push(d);
  }

  if (b.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date))
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    sets.push('date = ?');
    args.push(b.date);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No editable fields provided' });

  args.push(req.params.id);
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  if (b.remember === true && b.category_id) {
    learnRule(b.keyword || tx.description, b.category_id, true, 'learned');
  } else if (b.remember === false) {
    // Unchecking Remember removes the rule this transaction taught — but only
    // when the rule is genuinely its own: learned (not manual), still pointing
    // at the category being saved, and not shared with other transactions.
    const targetCategory = b.category_id ?? tx.category_id;
    if (targetCategory) unlearnRule(tx.description, targetCategory, tx.id);
  }

  res.json(
    db
      .prepare(
        `SELECT t.*, c.name AS category_name, f.name AS fund_name, cm.name AS commitment_name,
            a.name AS account_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN funds f ON f.id = t.fund_id
         LEFT JOIN commitments cm ON cm.id = t.commitment_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.id = ?`,
      )
      .get(req.params.id),
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

  const deletePartner = ['1', 'true', true].includes(
    req.query.delete_partner ?? req.body?.delete_partner,
  );
  const partners = tx.transfer_group
    ? db
        .prepare('SELECT * FROM transactions WHERE transfer_group = ? AND id != ?')
        .all(tx.transfer_group, tx.id)
    : [];
  if (deletePartner && partners.some((partner) => partner.split_of)) {
    return res.status(400).json({
      error: 'Cannot delete a paired split part directly — undo the split first',
    });
  }

  // Deleting a split parent removes its children via ON DELETE CASCADE. When
  // requested, paired transfer roots are deleted in the same transaction. The
  // attachment files are collected first and unlinked only after commit.
  const roots = deletePartner ? [tx, ...partners] : [tx];
  const ids = roots.flatMap((root) => [
    root.id,
    ...db
      .prepare('SELECT id FROM transactions WHERE split_of = ?')
      .all(root.id)
      .map((r) => r.id),
  ]);
  const placeholders = ids.map(() => '?').join(',');
  const files = db
    .prepare(`SELECT filename FROM attachments WHERE transaction_id IN (${placeholders})`)
    .all(...ids);
  db.exec('BEGIN');
  try {
    if (!deletePartner && partners.length) {
      db.prepare('UPDATE transactions SET transfer_group = NULL WHERE transfer_group = ?').run(
        tx.transfer_group,
      );
    }
    const rootPlaceholders = roots.map(() => '?').join(',');
    db.prepare(`DELETE FROM transactions WHERE id IN (${rootPlaceholders})`).run(
      ...roots.map((r) => r.id),
    );
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
        try {
          fs.unlinkSync(resolved);
        } catch {}
      }
    }
  }
  res.json({ ok: true, deleted: roots.length });
});

// ------------------------------------------------------------- manual create
// Manually enter one or more transactions (no CSV). Same dedup rules as
// import: identical date + amount(2dp) + currency + normalized description
// within the same file is folded; split/recurrence prefixes stay untouched.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function computeDedupKey(date, amount, currency, description) {
  const desc = String(description ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${date}|${Number(amount).toFixed(2)}|${currency}|${desc}`;
}

function buildInsertStatement() {
  // Mirrors the columns used by parser.js transactionsFromGrid; the source_file
  // tag marks these as user-entered so a future re-import of the same statement
  // does not collide.
  return db.prepare(
    `INSERT INTO transactions
       (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, fund_id, commitment_id, transfer_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
}

function validateManualEntry(t, index) {
  const errors = [];
  if (!t || typeof t !== 'object') errors.push(`row ${index + 1}: not an object`);
  else {
    if (!DATE_RE.test(t.date || '')) errors.push(`row ${index + 1}: date must be YYYY-MM-DD`);
    const desc = String(t.description ?? '').trim();
    if (!desc || desc.length > 200)
      errors.push(`row ${index + 1}: description required (1-200 chars)`);
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt === 0)
      errors.push(`row ${index + 1}: amount must be a non-zero number`);
    const currency = String(t.currency ?? 'EUR').toUpperCase();
    if (currency.length !== 3) errors.push(`row ${index + 1}: currency must be 3 letters`);
    const references = [
      ['account_id', 'accounts', 'account'],
      ['category_id', 'categories', 'category'],
      ['fund_id', 'funds', 'fund'],
      ['commitment_id', 'commitments', 'commitment'],
    ];
    for (const [field, table, label] of references) {
      if (t[field] == null || t[field] === '') continue;
      const id = Number(t[field]);
      if (
        !Number.isInteger(id) ||
        id < 1 ||
        !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)
      )
        errors.push(`row ${index + 1}: ${label} not found`);
    }
    if (
      t.transfer_group &&
      [t.category_id, t.fund_id, t.commitment_id].some((value) => value != null && value !== '')
    ) {
      errors.push(`row ${index + 1}: transfer rows cannot have a category, fund, or commitment`);
    }
    if (t.fund_id != null && t.fund_id !== '' && t.commitment_id != null && t.commitment_id !== '')
      errors.push(`row ${index + 1}: choose a fund or commitment, not both`);
  }
  return errors;
}

function insertOne(t) {
  const amt = Number(t.amount);
  const currency = String(t.currency ?? 'EUR').toUpperCase();
  const accountId = t.account_id != null && t.account_id !== '' ? Number(t.account_id) : null;
  const categoryId = t.category_id != null && t.category_id !== '' ? Number(t.category_id) : null;
  const fundId = t.fund_id != null && t.fund_id !== '' ? Number(t.fund_id) : null;
  const commitmentId =
    t.commitment_id != null && t.commitment_id !== '' ? Number(t.commitment_id) : null;
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
    transferGroup || categoryId ? 0 : 1,
    'manual',
    dedupKey,
    fundId,
    commitmentId,
    transferGroup,
  );
  return result.lastInsertRowid;
}

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const list = Array.isArray(body) ? body : [body];
  if (list.length === 0) return res.status(400).json({ error: 'Provide at least one transaction' });
  if (list.length > 200)
    return res.status(400).json({ error: 'Bulk add is limited to 200 transactions per request' });

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
      const dedupKey = computeDedupKey(
        t.date,
        Number(t.amount),
        String(t.currency ?? 'EUR').toUpperCase(),
        t.description,
      );
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
  res.json({
    ok: true,
    created: created.length,
    duplicates: duplicates.length,
    ids: created.map((c) => c.id),
  });
});

// ------------------------------------------------------------- transfers
const TRANSFER_AMOUNT_EPSILON = 0.005;

function transactionWithNames(id) {
  return db
    .prepare(
      `SELECT t.*, c.name AS category_name, f.name AS fund_name, cm.name AS commitment_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN funds f ON f.id = t.fund_id
       LEFT JOIN commitments cm ON cm.id = t.commitment_id
       WHERE t.id = ?`,
    )
    .get(id);
}

function transferPairError(a, b) {
  if (!a || !b) return 'Both transactions must exist';
  if (a.id === b.id) return 'A transaction cannot be paired with itself';
  if (a.account_id == null || b.account_id == null || a.account_id === b.account_id)
    return 'Transfer transactions must belong to different accounts';
  if (
    Math.sign(a.amount) === Math.sign(b.amount) ||
    Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) > TRANSFER_AMOUNT_EPSILON
  )
    return 'Transfer amounts must be equal and opposite';
  if (a.currency !== b.currency) return 'Transfer transactions must use the same currency';
  if (a.split_of || a.split_group || b.split_of || b.split_group)
    return 'Split transactions cannot be paired';
  if (a.transfer_group || b.transfer_group) return 'A transaction is already paired';
  return null;
}

function pairIds(body, params = {}) {
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  return [
    params.id ??
      body?.transaction_a_id ??
      body?.source_transaction_id ??
      body?.source_id ??
      body?.transaction_id ??
      ids[0],
    body?.transaction_b_id ??
      body?.target_transaction_id ??
      body?.target_id ??
      body?.partner_id ??
      ids[1],
  ].map((value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  });
}

function pairExisting(req, res) {
  const [aId, bId] = pairIds(req.body, req.params);
  if (!aId || !bId) return res.status(400).json({ error: 'Two transaction ids are required' });
  const a = db.prepare('SELECT * FROM transactions WHERE id = ?').get(aId);
  const b = db.prepare('SELECT * FROM transactions WHERE id = ?').get(bId);
  if (!a || !b) return res.status(404).json({ error: 'Both transactions must exist' });
  const error = transferPairError(a, b);
  if (error) return res.status(400).json({ error });

  const transferGroup = `transfer-${crypto.randomUUID()}`;
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE transactions
       SET transfer_group = ?, category_id = NULL, fund_id = NULL, commitment_id = NULL, needs_review = 0
       WHERE id IN (?, ?)`,
    ).run(transferGroup, a.id, b.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({
    ok: true,
    transfer_group: transferGroup,
    ids: [a.id, b.id],
    transactions: [transactionWithNames(a.id), transactionWithNames(b.id)],
  });
}

router.get('/transfer/candidates', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name, f.name AS fund_name, cm.name AS commitment_name,
              a.name AS account_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN funds f ON f.id = t.fund_id
       LEFT JOIN commitments cm ON cm.id = t.commitment_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.transfer_group IS NULL AND t.account_id IS NOT NULL
         AND t.amount != 0 AND t.split_of IS NULL AND t.split_group IS NULL
       ORDER BY t.date DESC, t.id DESC
       LIMIT 2000`,
    )
    .all();
  const candidates = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (transferPairError(a, b)) continue;
      const sameDate = a.date === b.date;
      const sameCurrency = a.currency === b.currency;
      candidates.push({
        transaction_a_id: a.id,
        transaction_b_id: b.id,
        amount: Math.abs(a.amount),
        date: sameDate ? a.date : null,
        same_date: sameDate,
        same_currency: sameCurrency,
        transaction_a: a,
        transaction_b: b,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.same_date) +
        Number(b.same_currency) -
        (Number(a.same_date) + Number(a.same_currency)) || b.amount - a.amount,
  );
  res.json({ candidates });
});

router.post('/transfer', (req, res) => {
  const b = req.body ?? {};
  const sourceId = Number(b.source_account_id ?? b.source_account ?? b.from_account_id);
  const targetId = Number(b.target_account_id ?? b.target_account ?? b.to_account_id);
  const amount = Number(b.amount);
  const date = String(b.date ?? '');
  const description = String(b.description ?? 'Transfer').trim();
  const source =
    Number.isInteger(sourceId) && sourceId > 0
      ? db.prepare('SELECT id FROM accounts WHERE id = ?').get(sourceId)
      : null;
  const target =
    Number.isInteger(targetId) && targetId > 0
      ? db.prepare('SELECT id FROM accounts WHERE id = ?').get(targetId)
      : null;
  if (!source || !target)
    return res.status(400).json({ error: 'source and target accounts are required' });
  if (sourceId === targetId)
    return res.status(400).json({ error: 'Source and target accounts must differ' });
  if (!Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!description || description.length > 200)
    return res.status(400).json({ error: 'description required (1-200 chars)' });
  const currency = String(b.currency ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    return res.status(400).json({ error: 'currency must be 3 letters' });

  const transferGroup = `transfer-${crypto.randomUUID()}`;
  const insert = db.prepare(
    `INSERT INTO transactions
       (date, description, amount, tx_type, currency, account_id, needs_review, source_file, dedup_key, transfer_group)
     VALUES (?, ?, ?, 'transfer', ?, ?, 0, 'manual-transfer', ?, ?)`,
  );
  db.exec('BEGIN');
  let sourceTx;
  let targetTx;
  try {
    sourceTx = insert.run(
      date,
      description,
      -amount,
      currency,
      sourceId,
      `${transferGroup}|source`,
      transferGroup,
    ).lastInsertRowid;
    targetTx = insert.run(
      date,
      description,
      amount,
      currency,
      targetId,
      `${transferGroup}|target`,
      transferGroup,
    ).lastInsertRowid;
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({
    ok: true,
    transfer_group: transferGroup,
    source_id: sourceTx,
    target_id: targetTx,
    ids: [sourceTx, targetTx],
    transactions: [transactionWithNames(sourceTx), transactionWithNames(targetTx)],
  });
});

router.post('/transfer/pair', pairExisting);
router.post('/:id/pair', pairExisting);

function unpair(req, res) {
  const id = Number(req.params.id ?? req.body?.transaction_id ?? req.body?.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ error: 'transaction_id is required' });
  const tx = db.prepare('SELECT id, transfer_group FROM transactions WHERE id = ?').get(id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (!tx.transfer_group) return res.json({ ok: true, unpaired: 0 });
  const result = db
    .prepare(
      'UPDATE transactions SET transfer_group = NULL, needs_review = CASE WHEN category_id IS NULL THEN 1 ELSE needs_review END WHERE transfer_group = ?',
    )
    .run(tx.transfer_group);
  res.json({ ok: true, unpaired: result.changes });
}

router.post('/transfer/unpair', unpair);
router.post('/:id/unpair', unpair);

// ------------------------------------------------------------- splits
// Split a transaction into parts across categories. The original row becomes
// a parent that is excluded from all sums; children carry the amounts.
router.post('/:id/split', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.split_group)
    return res.status(400).json({ error: 'Transaction is already split (or a split part)' });
  if (tx.transfer_group)
    return res.status(400).json({ error: 'Transfer transactions cannot be split' });

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
    `INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, split_group, split_of, fund_id, commitment_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    parts.forEach((p, i) => {
      ins.run(
        tx.date,
        tx.description,
        Number(p.amount),
        tx.tx_type,
        tx.currency,
        tx.account_id,
        Number(p.category_id),
        `split:${tx.id}`,
        `split|${tx.id}|${i}`,
        group,
        tx.id,
        tx.fund_id,
        tx.commitment_id,
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
  if (tx.split_of)
    return res.status(400).json({ error: 'This is a split part — delete it instead' });

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
        try {
          fs.unlinkSync(resolved);
        } catch {}
      }
    }
  }
  res.json({ ok: true });
});

// Rules management
const choiceRuleCategories = (ruleId) =>
  db
    .prepare(
      `SELECT cc.category_id, c.name AS category_name
       FROM category_choice_rule_categories cc JOIN categories c ON c.id = cc.category_id
       WHERE cc.rule_id = ? ORDER BY c.name`,
    )
    .all(ruleId);

// Filtered rule search: q matches keyword/condition text, type filters
// keyword|advanced|choice, category_id and enabled narrow further. Returns all
// matches (the Rules Manager shows every rule on one page).
router.get('/rules', (req, res) => {
  const { q, type, category_id, enabled } = req.query;
  const needle = (q ?? '').trim().toLowerCase();

  const keywordRules = db
    .prepare(
      `SELECT r.*, c.name AS category_name,
                (SELECT COUNT(*) FROM transactions t WHERE LOWER(t.description) LIKE '%' || r.keyword || '%') AS matches
         FROM category_rules r JOIN categories c ON c.id = r.category_id
         ORDER BY r.keyword`,
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
       ORDER BY r.priority DESC, r.id`,
    )
    .all()
    .map((r) => ({ ...r, rule_type: 'advanced' }));

  const choiceRules = db
    .prepare('SELECT r.* FROM category_choice_rules r ORDER BY r.id')
    .all()
    .map((r) => ({ ...r, rule_type: 'choice', categories: choiceRuleCategories(r.id) }));

  let all = [...automationRules, ...choiceRules, ...keywordRules];
  if (type) all = all.filter((r) => r.rule_type === type);
  if (category_id)
    all = all.filter((r) =>
      r.rule_type === 'choice'
        ? r.categories.some((c) => c.category_id === Number(category_id))
        : r.category_id === Number(category_id),
    );
  if (enabled === '1' || enabled === '0')
    all = all.filter((r) => (enabled === '1' ? r.enabled !== 0 : r.enabled === 0));
  if (needle)
    all = all.filter((r) => {
      const haystack = [
        r.keyword,
        r.description_contains,
        r.category_name,
        ...(r.categories ?? []).map((c) => c.category_name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  res.json(all);
});

router.get('/rules/all', (_req, res) => {
  const keywordRules = db
    .prepare(
      `SELECT r.*, c.name AS category_name,
                (SELECT COUNT(*) FROM transactions t WHERE LOWER(t.description) LIKE '%' || r.keyword || '%') AS matches
         FROM category_rules r JOIN categories c ON c.id = r.category_id
         ORDER BY r.keyword`,
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
       ORDER BY r.priority DESC, r.id`,
    )
    .all()
    .map((r) => ({ ...r, rule_type: 'advanced' }));
  const choiceRules = db
    .prepare('SELECT r.* FROM category_choice_rules r ORDER BY r.id')
    .all()
    .map((r) => ({ ...r, rule_type: 'choice', categories: choiceRuleCategories(r.id) }));
  res.json([...automationRules, ...choiceRules, ...keywordRules]);
});

router.post('/rules', (req, res) => {
  const { keyword, category_id } = req.body ?? {};
  if (!keyword?.trim() || !category_id)
    return res.status(400).json({ error: 'keyword and category_id required' });
  // Rules created from the Rules Manager are manual: unchecking Remember on a
  // transaction never deletes them.
  learnRule(keyword, category_id, true, 'manual');
  res.json({ ok: true });
});

router.post('/rules/advanced', (req, res) => {
  const b = req.body ?? {};
  const hasCondition = [
    b.description_contains,
    b.amount_min,
    b.amount_max,
    b.account_id,
    b.tx_type,
  ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (!b.category_id || !hasCondition)
    return res.status(400).json({ error: 'At least one condition and a category are required' });
  if (b.amount_min !== '' && b.amount_min != null && !Number.isFinite(Number(b.amount_min)))
    return res.status(400).json({ error: 'Minimum amount must be numeric' });
  if (b.amount_max !== '' && b.amount_max != null && !Number.isFinite(Number(b.amount_max)))
    return res.status(400).json({ error: 'Maximum amount must be numeric' });
  if (
    b.amount_min !== '' &&
    b.amount_max !== '' &&
    b.amount_min != null &&
    b.amount_max != null &&
    Number(b.amount_min) > Number(b.amount_max)
  )
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
  if (result?.choice === true) {
    return res.json({
      choice: true,
      candidates: result.candidates,
      rule: result.rule,
    });
  }
  res.json(
    result
      ? {
          category_id: result.category_id,
          category_name: result.category_name || null,
          rule: result.rule,
        }
      : { category_id: null, category_name: null, rule: null },
  );
});

// Category Choice rules: "this keyword may belong to several categories —
// always ask". Requires a keyword and at least two candidate categories.
const validateChoicePayload = (b, { partial = false } = {}) => {
  if (!partial || b.category_ids !== undefined) {
    if (!Array.isArray(b.category_ids) || b.category_ids.length < 2)
      return 'At least two candidate categories are required';
    const unique = [...new Set(b.category_ids.map(Number))];
    for (const id of unique) {
      if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(id)) return 'Unknown category';
    }
  }
  if (!partial || b.keyword !== undefined) {
    if (!String(b.keyword ?? '').trim()) return 'keyword is required';
  }
  for (const field of ['amount_min', 'amount_max']) {
    if (b[field] !== undefined && b[field] !== '' && b[field] !== null) {
      if (!Number.isFinite(Number(b[field]))) return `${field} must be numeric`;
    }
  }
  if (
    b.amount_min != null &&
    b.amount_max != null &&
    b.amount_min !== '' &&
    b.amount_max !== '' &&
    Number(b.amount_min) > Number(b.amount_max)
  )
    return 'Minimum amount cannot exceed maximum amount';
  if (b.account_id != null && b.account_id !== '') {
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(b.account_id)))
      return 'Unknown account';
  }
  return null;
};

router.post('/rules/choice', (req, res) => {
  const b = req.body ?? {};
  const invalid = validateChoicePayload(b);
  if (invalid) return res.status(400).json({ error: invalid });
  const tx = db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO category_choice_rules (keyword, amount_min, amount_max, account_id, tx_type, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        String(b.keyword).trim(),
        b.amount_min == null || b.amount_min === '' ? null : Number(b.amount_min),
        b.amount_max == null || b.amount_max === '' ? null : Number(b.amount_max),
        b.account_id ? Number(b.account_id) : null,
        b.tx_type?.trim() || null,
        b.enabled === 0 ? 0 : 1,
      );
    const ins = db.prepare(
      'INSERT OR IGNORE INTO category_choice_rule_categories (rule_id, category_id) VALUES (?, ?)',
    );
    for (const id of new Set(b.category_ids.map(Number))) ins.run(r.lastInsertRowid, id);
    return r.lastInsertRowid;
  });
  const id = tx();
  const rule = db.prepare('SELECT * FROM category_choice_rules WHERE id = ?').get(id);
  res.json({ ...rule, rule_type: 'choice', categories: choiceRuleCategories(id) });
});

router.patch('/rules/choice/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM category_choice_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const b = req.body ?? {};
  const invalid = validateChoicePayload(b, { partial: true });
  if (invalid) return res.status(400).json({ error: invalid });

  db.transaction(() => {
    const sets = [];
    const args = [];
    if (b.keyword !== undefined) {
      sets.push('keyword = ?');
      args.push(String(b.keyword).trim());
    }
    for (const field of ['amount_min', 'amount_max']) {
      if (b[field] !== undefined) {
        sets.push(`${field} = ?`);
        args.push(b[field] === '' || b[field] === null ? null : Number(b[field]));
      }
    }
    if (b.account_id !== undefined) {
      sets.push('account_id = ?');
      args.push(b.account_id ? Number(b.account_id) : null);
    }
    if (b.tx_type !== undefined) {
      sets.push('tx_type = ?');
      args.push(b.tx_type?.trim() || null);
    }
    if (b.enabled !== undefined) {
      sets.push('enabled = ?');
      args.push(b.enabled ? 1 : 0);
    }
    if (sets.length) {
      args.push(rule.id);
      db.prepare(`UPDATE category_choice_rules SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    if (b.category_ids !== undefined) {
      const del = db.prepare('DELETE FROM category_choice_rule_categories WHERE rule_id = ?');
      const ins = db.prepare(
        'INSERT OR IGNORE INTO category_choice_rule_categories (rule_id, category_id) VALUES (?, ?)',
      );
      del.run(rule.id);
      for (const id of new Set(b.category_ids.map(Number))) ins.run(rule.id, id);
    }
  })();

  const updated = db.prepare('SELECT * FROM category_choice_rules WHERE id = ?').get(rule.id);
  res.json({ ...updated, rule_type: 'choice', categories: choiceRuleCategories(rule.id) });
});

router.delete('/rules/choice/:id', (req, res) => {
  db.prepare('DELETE FROM category_choice_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Edit an advanced rule (conditions, category, priority, enabled).
router.patch('/rules/advanced/:id', (req, res) => {
  const rule = db
    .prepare('SELECT * FROM category_automation_rules WHERE id = ?')
    .get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const b = req.body ?? {};
  const sets = [];
  const args = [];
  if (b.description_contains !== undefined) {
    sets.push('description_contains = ?');
    args.push(String(b.description_contains).trim() || null);
  }
  for (const field of ['amount_min', 'amount_max']) {
    if (b[field] !== undefined) {
      const value = b[field] === '' || b[field] === null ? null : Number(b[field]);
      if (value !== null && !Number.isFinite(value))
        return res.status(400).json({ error: `${field} must be numeric` });
      sets.push(`${field} = ?`);
      args.push(value);
    }
  }
  if (b.account_id !== undefined) {
    sets.push('account_id = ?');
    args.push(b.account_id ? Number(b.account_id) : null);
  }
  if (b.tx_type !== undefined) {
    sets.push('tx_type = ?');
    args.push(String(b.tx_type).trim() || null);
  }
  if (b.priority !== undefined) {
    sets.push('priority = ?');
    args.push(Number(b.priority) || 0);
  }
  if (b.enabled !== undefined) {
    sets.push('enabled = ?');
    args.push(b.enabled ? 1 : 0);
  }
  if (b.category_id !== undefined) {
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(b.category_id)))
      return res.status(400).json({ error: 'Unknown category' });
    sets.push('category_id = ?');
    args.push(Number(b.category_id));
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields provided' });
  args.push(rule.id);
  db.prepare(`UPDATE category_automation_rules SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json(db.prepare('SELECT * FROM category_automation_rules WHERE id = ?').get(rule.id));
});

// Retarget a keyword rule (keyword itself is immutable — delete + recreate).
router.patch('/rules/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM category_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const { category_id, enabled } = req.body ?? {};
  if (category_id === undefined && enabled === undefined)
    return res.status(400).json({ error: 'No editable fields provided' });
  if (category_id !== undefined) {
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(category_id)))
      return res.status(400).json({ error: 'Unknown category' });
    db.prepare('UPDATE category_rules SET category_id = ? WHERE id = ?').run(
      Number(category_id),
      rule.id,
    );
  }
  if (enabled !== undefined) {
    // Keyword rules have no enabled column; disabling a keyword rule is
    // expressed by deleting it, so reject silently-impossible toggles.
    return res.status(400).json({ error: 'Keyword rules cannot be disabled — delete instead' });
  }
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(rule.id));
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
