import { Router } from 'express';
import { db } from '../db.js';
import { incomeForMonth, currentMonth } from '../services/model.js';

const router = Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateSource(body, { partial = false, existing = null } = {}) {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80)
      return 'name must be 1-80 characters';
  }
  if (body.current_amount !== undefined && !Number.isFinite(Number(body.current_amount)))
    return 'current_amount must be a number';
  // The old recurring toggle is gone: start/end months express everything.
  // No end month means the income continues indefinitely.
  if (body.recurring !== undefined)
    return 'recurring is no longer used — set start_month/end_month instead (no end month = ongoing)';
  for (const field of ['start_month', 'end_month']) {
    const value = body[field];
    if (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      (typeof value !== 'string' || !MONTH_RE.test(value))
    )
      return `${field} must be YYYY-MM or empty`;
  }
  const start =
    body.start_month === undefined ? existing?.start_month || null : body.start_month || null;
  const end = body.end_month === undefined ? existing?.end_month || null : body.end_month || null;
  if (start && end && start > end) return 'start_month must not be after end_month';
  if (body.person_id !== undefined && body.person_id !== null && body.person_id !== '') {
    const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(body.person_id);
    if (!person) return 'Person not found';
  }
  return null;
}

const isActiveIn = (s, month) =>
  (!s.start_month || s.start_month <= month) && (!s.end_month || month <= s.end_month);

// Income for a month (entries override the usual amount inside the period)
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month : currentMonth();
  // Explicit columns: the legacy `recurring` column is inert and must not leak.
  const sources = db
    .prepare(
      `SELECT s.id, s.name, s.person_id, s.current_amount, s.start_month, s.end_month,
              p.name AS person_name
       FROM income_sources s
       LEFT JOIN persons p ON p.id = s.person_id ORDER BY s.id`,
    )
    .all()
    .map((s) => {
      const active = isActiveIn(s, month);
      return {
        ...s,
        active_in_month: active,
        entry_amount: active
          ? (db
              .prepare('SELECT amount FROM income_entries WHERE source_id = ? AND month = ?')
              .get(s.id, month)?.amount ?? null)
          : null,
      };
    });
  const view = incomeForMonth(month);
  res.json({ month, sources, total: view.total });
});

router.post('/sources', (req, res) => {
  const body = req.body ?? {};
  const error = validateSource(body);
  if (error) return res.status(400).json({ error });
  const result = db
    .prepare(
      `INSERT INTO income_sources
       (name, person_id, current_amount, start_month, end_month)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      body.name.trim(),
      body.person_id ? Number(body.person_id) : null,
      Number(body.current_amount ?? 0),
      body.start_month || null,
      body.end_month || null,
    );
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...row, recurring: undefined });
});

router.patch('/sources/:id', (req, res) => {
  const source = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  const body = req.body ?? {};
  const error = validateSource(body, { partial: true, existing: source });
  if (error) return res.status(400).json({ error });
  const fields = [];
  const values = [];
  if (body.name !== undefined) {
    fields.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.person_id !== undefined) {
    fields.push('person_id = ?');
    values.push(body.person_id ? Number(body.person_id) : null);
  }
  if (body.current_amount !== undefined) {
    fields.push('current_amount = ?');
    values.push(Number(body.current_amount));
  }
  if (body.start_month !== undefined) {
    fields.push('start_month = ?');
    values.push(body.start_month || null);
  }
  if (body.end_month !== undefined) {
    fields.push('end_month = ?');
    values.push(body.end_month || null);
  }
  if (!fields.length) return res.status(400).json({ error: 'No editable fields provided' });
  values.push(req.params.id);
  db.prepare(`UPDATE income_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(req.params.id);
  res.json({ ...row, recurring: undefined });
});

router.delete('/sources/:id', (req, res) => {
  const source = db.prepare('SELECT id FROM income_sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  db.prepare('DELETE FROM income_sources WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Enter actual income for a source+month; amount null removes the override.
// Writes outside the source's period are refused: the UI shows those months
// as inactive, and a stored-but-ignored entry would only confuse reconciliation.
router.put('/:month/:sourceId', (req, res) => {
  const { month, sourceId } = req.params;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const src = db.prepare('SELECT * FROM income_sources WHERE id = ?').get(sourceId);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  const amount = req.body?.amount;
  if (amount !== null && amount !== undefined && amount !== '') {
    if (!isActiveIn(src, month))
      return res.status(400).json({
        error: `${month} is outside this source's period (${src.start_month ?? 'start'} – ${src.end_month ?? 'ongoing'}). Actual income there counts as zero.`,
      });
    const amt = Number(amount);
    if (isNaN(amt)) return res.status(400).json({ error: 'Invalid amount' });
    db.prepare(
      `INSERT INTO income_entries (source_id, month, amount) VALUES (?, ?, ?)
       ON CONFLICT(source_id, month) DO UPDATE SET amount = excluded.amount`,
    ).run(sourceId, month, amt);
  } else {
    // Clearing is always allowed so stale out-of-period entries can be removed.
    db.prepare('DELETE FROM income_entries WHERE source_id = ? AND month = ?').run(sourceId, month);
  }
  if (req.body?.current_amount !== undefined) {
    db.prepare('UPDATE income_sources SET current_amount = ? WHERE id = ?').run(
      Number(req.body.current_amount) || 0,
      sourceId,
    );
  }
  res.json({ ok: true });
});

export default router;
