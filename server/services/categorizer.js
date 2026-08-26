import { db } from '../db.js';
import { normalizeDesc } from './parser.js';

export function categorize(description) {
  const norm = normalizeDesc(description);
  if (!norm) return null;

  // exact rule match first
  const exact = db
    .prepare(
      `SELECT r.category_id FROM category_rules r WHERE r.keyword = ?`
    )
    .get(norm);
  if (exact) return exact.category_id;

  // substring match (longest keyword wins for specificity)
  const rules = db
    .prepare('SELECT keyword, category_id FROM category_rules ORDER BY LENGTH(keyword) DESC')
    .all();
  for (const rule of rules) {
    if (norm.includes(rule.keyword)) return rule.category_id;
  }
  return null;
}

export function applyCategorization(transactions) {
  const cache = new Map();
  const result = [];
  for (const tx of transactions) {
    let catId;
    const desc = tx.description;
    if (cache.has(desc)) {
      catId = cache.get(desc);
    } else {
      catId = categorize(desc);
      cache.set(desc, catId);
    }
    result.push({
      ...tx,
      suggested_category_id: catId,
      needs_review: catId === null ? 1 : 0,
    });
  }
  return result;
}

// Create a learned rule and retro-apply it to unmatched transactions.
export function learnRule(keyword, categoryId, applyToExisting = true) {
  const kw = normalizeDesc(keyword);
  if (!kw) throw new Error('Keyword is empty');
  db.prepare(
    'INSERT INTO category_rules (keyword, category_id) VALUES (?, ?) ON CONFLICT(keyword) DO UPDATE SET category_id = excluded.category_id'
  ).run(kw, categoryId);

  if (applyToExisting) {
    db.prepare(
      'UPDATE transactions SET category_id = ?, needs_review = 0 WHERE needs_review = 1 AND LOWER(TRIM(description)) = ?'
    ).run(categoryId, kw);
    db.prepare(
      'UPDATE transactions SET needs_review = 0 WHERE needs_review = 1 AND LOWER(description) LIKE ?'
    ).run(`%${kw}%`);
  }
}
