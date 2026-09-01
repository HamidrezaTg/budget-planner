import { Router } from 'express';
import { master, getUserDb, als } from '../db.js';
import { sharedBudgetView } from '../services/model.js';
import { hashToken } from './shares.js';

const router = Router();
const attempts = new Map();

function allowed(key) {
  const now = Date.now();
  if (attempts.size > 10000) {
    for (const [storedKey, value] of attempts) {
      if (now - value.started > 60000) attempts.delete(storedKey);
    }
  }
  const entry = attempts.get(key);
  if (!entry || now - entry.started > 60000) {
    attempts.set(key, { started: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= 60;
}

router.get('/:token', (req, res) => {
  if (!allowed(`ip:${req.ip}`) || !allowed(`token:${req.params.token}`))
    return res.status(429).json({ error: 'Too many requests' });
  const row = master
    .prepare(
      `SELECT s.month, s.expires_at, u.username FROM share_tokens s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    )
    .get(hashToken(req.params.token));
  if (!row || Date.parse(row.expires_at) <= Date.now())
    return res.status(404).json({ error: 'Share link is invalid or expired' });
  res.setHeader('Cache-Control', 'no-store');
  const userDb = getUserDb(row.username);
  return als.run(userDb, () => res.json(sharedBudgetView(row.month)));
});

export default router;
