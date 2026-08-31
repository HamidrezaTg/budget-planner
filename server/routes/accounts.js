import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// Keep legacy seed values editable while new accounts use the clearer generic
// labels below. Existing data must not silently change kind during a rename.
const VALID_KINDS = ['bank', 'card', 'cash', 'other', 'sparkasse', 'revolut'];
const NAME_RE = /^.{1,60}$/;

function validateAccount(body, currentId = null, { partial = false } = {}) {
  // The body is the raw request (not spread over the existing row) so
  // "undefined" means "not provided". For PATCH we only validate fields
  // the caller actually sent.
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!NAME_RE.test(name)) return 'Account name must be 1-60 characters';
    const dup = db
      .prepare('SELECT id FROM accounts WHERE name = ? AND id != ?')
      .get(name, currentId ?? -1);
    if (dup) return 'An account with this name already exists';
  }
  if (body.kind !== undefined && !VALID_KINDS.includes(String(body.kind)))
    return `kind must be one of ${VALID_KINDS.join(', ')}`;
  if (body.opening_balance !== undefined && !Number.isFinite(Number(body.opening_balance)))
    return 'opening_balance must be a number';
  if (body.is_spending_pot !== undefined && typeof body.is_spending_pot !== 'boolean')
    return 'is_spending_pot must be a boolean';
  if (!partial && body.name === undefined) return 'Account name must be 1-60 characters';
  return null;
}

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM accounts ORDER BY id').all());
});

router.post('/', (req, res) => {
  const b = req.body ?? {};
  const err = validateAccount(b);
  if (err) return res.status(400).json({ error: err });
  const r = db
    .prepare(
      `INSERT INTO accounts (name, kind, is_spending_pot, opening_balance)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      String(b.name).trim(),
      String(b.kind ?? 'other'),
      b.is_spending_pot ? 1 : 0,
      Number(b.opening_balance ?? 0)
    );
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const err = validateAccount(b, row.id, { partial: true });
  if (err) return res.status(400).json({ error: err });
  const sets = [];
  const args = [];
  if (b.name !== undefined) { sets.push('name = ?'); args.push(String(b.name).trim()); }
  if (b.kind !== undefined) { sets.push('kind = ?'); args.push(String(b.kind)); }
  if (b.is_spending_pot !== undefined) { sets.push('is_spending_pot = ?'); args.push(b.is_spending_pot ? 1 : 0); }
  if (b.opening_balance !== undefined) { sets.push('opening_balance = ?'); args.push(Number(b.opening_balance)); }
  if (sets.length === 0) return res.status(400).json({ error: 'No editable fields provided' });
  args.push(req.params.id);
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Block delete if anything still references this account — assignable
  // references are: transactions, balance_observations, commitments,
  // recurrences, funds, income_sources (via account_id on recurring/income
  // — actually income has no account; funds has category_id; the rest are
  // nullable FK with ON DELETE SET NULL). We do the count via direct
  // transaction/observation checks and let SQLite clean up the rest.
  const txCount = db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?')
    .get(req.params.id).c;
  const obsCount = db
    .prepare('SELECT COUNT(*) AS c FROM balance_observations WHERE account_id = ?')
    .get(req.params.id).c;
  if (txCount > 0 || obsCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: this account still has ${txCount} transaction(s) and ${obsCount} observation(s). Reassign them first.`,
    });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
