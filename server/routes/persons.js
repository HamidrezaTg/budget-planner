import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const NAME_RE = /^.{1,60}$/;

function validatePerson(body, currentId = null, { partial = false } = {}) {
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!NAME_RE.test(name)) return 'Person name must be 1-60 characters';
    const dup = db
      .prepare('SELECT id FROM persons WHERE name = ? AND id != ?')
      .get(name, currentId ?? -1);
    if (dup) return 'A person with this name already exists';
  }
  if (!partial && body.name === undefined) return 'Person name must be 1-60 characters';
  return null;
}

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM persons ORDER BY name').all());
});

router.post('/', (req, res) => {
  const b = req.body ?? {};
  const err = validatePerson(b);
  if (err) return res.status(400).json({ error: err });
  const r = db.prepare('INSERT INTO persons (name) VALUES (?)').run(String(b.name).trim());
  res.json(db.prepare('SELECT * FROM persons WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const err = validatePerson(b, row.id, { partial: true });
  if (err) return res.status(400).json({ error: err });
  if (b.name === undefined) return res.status(400).json({ error: 'No editable fields provided' });
  db.prepare('UPDATE persons SET name = ? WHERE id = ?').run(String(b.name).trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id, name FROM persons WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // income_sources.person_id is nullable with ON DELETE SET NULL — the rows
  // simply drop the link. No confirmation needed.
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
