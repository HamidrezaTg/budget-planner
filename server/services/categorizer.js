import { db } from '../db.js';
import { normalizeDesc } from './parser.js';

function matches(rule, tx) {
  const description = normalizeDesc(tx.description);
  if (rule.description_contains && !description.includes(normalizeDesc(rule.description_contains))) return false;
  const amount = Math.abs(Number(tx.amount) || 0);
  if (rule.amount_min != null && amount < rule.amount_min) return false;
  if (rule.amount_max != null && amount > rule.amount_max) return false;
  if (rule.account_id != null && Number(tx.account_id) !== Number(rule.account_id)) return false;
  if (rule.tx_type && String(tx.tx_type || '').toLowerCase() !== String(rule.tx_type).toLowerCase()) return false;
  return true;
}

export function categorizeTransaction(tx) {
  const norm = normalizeDesc(tx.description);
  if (!norm) return null;

  const advanced = db
    .prepare('SELECT r.*, c.name AS category_name FROM category_automation_rules r JOIN categories c ON c.id = r.category_id WHERE r.enabled = 1 ORDER BY r.priority DESC, r.id')
    .all();
  for (const rule of advanced) {
    if (matches(rule, tx)) return { category_id: rule.category_id, category_name: rule.category_name, rule };
  }

  // exact rule match first
  const exact = db
    .prepare(
      `SELECT r.category_id, c.name AS category_name
       FROM category_rules r JOIN categories c ON c.id = r.category_id
       WHERE r.keyword = ?`
    )
    .get(norm);
  if (exact) return { category_id: exact.category_id, category_name: exact.category_name, rule: { keyword: norm, type: 'keyword' } };

  // substring match (longest keyword wins for specificity)
  const rules = db
    .prepare(
      `SELECT r.keyword, r.category_id, c.name AS category_name
       FROM category_rules r JOIN categories c ON c.id = r.category_id
       ORDER BY LENGTH(r.keyword) DESC`
    )
    .all();
  for (const rule of rules) {
    if (norm.includes(rule.keyword)) return { category_id: rule.category_id, category_name: rule.category_name, rule: { ...rule, type: 'keyword' } };
  }
  return null;
}

export function categorize(description, tx = {}) {
  return categorizeTransaction({ ...tx, description })?.category_id ?? null;
}

export function applyCategorization(transactions) {
  const cache = new Map();
  const result = [];
  for (const tx of transactions) {
    let catId;
    const cacheKey = [tx.description, tx.amount, tx.account_id, tx.tx_type].join('\u0000');
    if (cache.has(cacheKey)) {
      catId = cache.get(cacheKey);
    } else {
      catId = categorizeTransaction(tx)?.category_id ?? null;
      cache.set(cacheKey, catId);
    }
    result.push({
      ...tx,
      suggested_category_id: catId,
      needs_review: catId === null ? 1 : 0,
    });
  }
  return result;
}

export function createAutomationRule({ description_contains, amount_min, amount_max, account_id, tx_type, category_id, priority = 0 }) {
  const r = db.prepare(
    `INSERT INTO category_automation_rules
      (description_contains, amount_min, amount_max, account_id, tx_type, category_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    description_contains?.trim() || null,
    amount_min == null || amount_min === '' ? null : Number(amount_min),
    amount_max == null || amount_max === '' ? null : Number(amount_max),
    account_id || null,
    tx_type?.trim() || null,
    Number(category_id),
    Number(priority) || 0
  );
  return db.prepare('SELECT * FROM category_automation_rules WHERE id = ?').get(r.lastInsertRowid);
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
