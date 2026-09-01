import crypto from 'node:crypto';
import { Router } from 'express';
import { master } from '../db.js';

const router = Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.get('/', (req, res) => {
  const user = master.prepare('SELECT id FROM users WHERE username = ?').get(req.username);
  const rows = master
    .prepare(
      `SELECT id, month, created_at, expires_at, revoked_at FROM share_tokens
       WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const month = req.body?.month;
  const days = Number(req.body?.expires_in_days ?? 30);
  if (!MONTH_RE.test(month || '')) return res.status(400).json({ error: 'month must be YYYY-MM' });
  if (!Number.isInteger(days) || days < 1 || days > 365)
    return res.status(400).json({ error: 'expires_in_days must be an integer from 1 to 365' });
  const user = master.prepare('SELECT id FROM users WHERE username = ?').get(req.username);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const row = master
    .prepare(
      `INSERT INTO share_tokens (user_id, token_hash, month, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(user.id, hashToken(token), month, expires);
  res.json({ id: row.lastInsertRowid, token, month, expires_at: expires });
});

router.delete('/:id', (req, res) => {
  const user = master.prepare('SELECT id FROM users WHERE username = ?').get(req.username);
  const result = master
    .prepare(
      `UPDATE share_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(req.params.id, user.id);
  if (!result.changes) return res.status(404).json({ error: 'Share token not found' });
  res.json({ ok: true });
});

export { hashToken };
export default router;
