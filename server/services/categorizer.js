import { db } from '../db.js';
import { normalizeDesc } from './parser.js';

function matches(rule, tx) {
  const description = normalizeDesc(tx.description);
  if (rule.description_contains && !description.includes(normalizeDesc(rule.description_contains)))
    return false;
  const amount = Math.abs(Number(tx.amount) || 0);
  if (rule.amount_min != null && amount < rule.amount_min) return false;
  if (rule.amount_max != null && amount > rule.amount_max) return false;
  if (rule.account_id != null && Number(tx.account_id) !== Number(rule.account_id)) return false;
  if (rule.tx_type && String(tx.tx_type || '').toLowerCase() !== String(rule.tx_type).toLowerCase())
    return false;
  return true;
}

export function categorizeTransaction(tx) {
  const norm = normalizeDesc(tx.description);
  if (!norm) return null;

  const advanced = db
    .prepare(
      'SELECT r.*, c.name AS category_name FROM category_automation_rules r JOIN categories c ON c.id = r.category_id WHERE r.enabled = 1 ORDER BY r.priority DESC, r.id',
    )
    .all();
  for (const rule of advanced) {
    if (matches(rule, tx))
      return { category_id: rule.category_id, category_name: rule.category_name, rule };
  }

  // Category Choice rules: a keyword that may legitimately belong to several
  // categories. They override learned keyword rules so the transaction is
  // never silently auto-categorized; the caller must send it to review with
  // the candidate list. Most specific (longest) keyword wins.
  const choiceRules = db
    .prepare('SELECT * FROM category_choice_rules WHERE enabled = 1')
    .all()
    .map((rule) => ({
      ...rule,
      candidates: db
        .prepare(
          `SELECT cc.category_id, c.name AS category_name
           FROM category_choice_rule_categories cc JOIN categories c ON c.id = cc.category_id
           WHERE cc.rule_id = ? ORDER BY c.name`,
        )
        .all(rule.id),
    }))
    .filter((rule) => rule.candidates.length >= 2);
  for (const rule of choiceRules) {
    const kw = normalizeDesc(rule.keyword);
    if (!kw) continue;
    if (norm !== kw && !norm.includes(kw)) continue;
    if (!matches(rule, tx)) continue;
    return {
      choice: true,
      rule: { ...rule, type: 'choice' },
      candidates: rule.candidates,
    };
  }

  // exact rule match first
  const exact = db
    .prepare(
      `SELECT r.category_id, c.name AS category_name
       FROM category_rules r JOIN categories c ON c.id = r.category_id
       WHERE r.keyword = ?`,
    )
    .get(norm);
  if (exact)
    return {
      category_id: exact.category_id,
      category_name: exact.category_name,
      rule: { keyword: norm, type: 'keyword' },
    };

  // substring match (longest keyword wins for specificity)
  const rules = db
    .prepare(
      `SELECT r.keyword, r.category_id, c.name AS category_name
       FROM category_rules r JOIN categories c ON c.id = r.category_id
       ORDER BY LENGTH(r.keyword) DESC`,
    )
    .all();
  for (const rule of rules) {
    if (norm.includes(rule.keyword))
      return {
        category_id: rule.category_id,
        category_name: rule.category_name,
        rule: { ...rule, type: 'keyword' },
      };
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
    let outcome;
    const cacheKey = [tx.description, tx.amount, tx.account_id, tx.tx_type].join('\u0000');
    if (cache.has(cacheKey)) {
      outcome = cache.get(cacheKey);
    } else {
      outcome = categorizeTransaction(tx);
      cache.set(cacheKey, outcome);
    }
    const ambiguous = outcome?.choice === true;
    const catId = ambiguous ? null : (outcome?.category_id ?? null);
    const row = {
      ...tx,
      suggested_category_id: catId,
      needs_review: catId === null ? 1 : 0,
      review_reason: ambiguous ? 'choice_rule' : null,
    };
    if (ambiguous) row.choice_candidates = outcome.candidates;
    result.push(row);
  }
  return result;
}

export function createAutomationRule({
  description_contains,
  amount_min,
  amount_max,
  account_id,
  tx_type,
  category_id,
  priority = 0,
}) {
  const r = db
    .prepare(
      `INSERT INTO category_automation_rules
      (description_contains, amount_min, amount_max, account_id, tx_type, category_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      description_contains?.trim() || null,
      amount_min == null || amount_min === '' ? null : Number(amount_min),
      amount_max == null || amount_max === '' ? null : Number(amount_max),
      account_id || null,
      tx_type?.trim() || null,
      Number(category_id),
      Number(priority) || 0,
    );
  return db.prepare('SELECT * FROM category_automation_rules WHERE id = ?').get(r.lastInsertRowid);
}

// Retro-apply rule changes to uncategorized transactions. Matching goes
// through categorizeTransaction so the retro-fix and future imports always
// agree: rows that now resolve to a definite category are categorized, rows
// captured by a Category Choice rule are left in review with their candidate
// list. category_id and needs_review are set together: clearing the review
// flag without categorizing would silently drop rows from the review queue.
export function retroApplyKeyword(keyword, _categoryId) {
  const kw = normalizeDesc(keyword);
  if (!kw) return 0;
  const rows = db
    .prepare(
      'SELECT id, description, amount, account_id, tx_type FROM transactions WHERE needs_review = 1',
    )
    .all();
  const upd = db.prepare(
    'UPDATE transactions SET category_id = ?, needs_review = 0, review_reason = NULL WHERE id = ?',
  );
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const nd = normalizeDesc(row.description);
      if (nd !== kw && !nd.includes(kw)) continue;
      const outcome = categorizeTransaction(row);
      if (!outcome || outcome.choice === true) continue;
      upd.run(outcome.category_id, row.id);
      n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

// Create a learned rule and retro-apply it to unmatched transactions.
// origin: 'learned' (Remember checkbox / import approval) or 'manual'
// (Rules Manager). Only learned rules may be removed by unchecking Remember.
export function learnRule(keyword, categoryId, applyToExisting = true, origin = 'learned') {
  const kw = normalizeDesc(keyword);
  if (!kw) throw new Error('Keyword is empty');
  db.prepare(
    `INSERT INTO category_rules (keyword, category_id, origin) VALUES (?, ?, ?)
     ON CONFLICT(keyword) DO UPDATE SET category_id = excluded.category_id, origin = excluded.origin`,
  ).run(kw, categoryId, origin === 'manual' ? 'manual' : 'learned');

  if (applyToExisting) retroApplyKeyword(kw, categoryId);
}

// Remove the rule learned from one transaction when the user unchecks
// Remember. Conservative by design: the rule must exist, point at the same
// category the transaction is being saved with, be origin='learned', and not
// still categorize any other transaction. Returns true only when deleted.
export function unlearnRule(description, categoryId, excludeTxId = null) {
  const kw = normalizeDesc(description);
  if (!kw || !categoryId) return false;
  const rule = db.prepare('SELECT * FROM category_rules WHERE keyword = ?').get(kw);
  if (!rule) return false;
  if (Number(rule.category_id) !== Number(categoryId)) return false;
  if (rule.origin === 'manual') return false;
  const others = excludeTxId
    ? db
        .prepare('SELECT id, description FROM transactions WHERE category_id = ? AND id != ?')
        .all(categoryId, excludeTxId)
    : db.prepare('SELECT id, description FROM transactions WHERE category_id = ?').all(categoryId);
  const stillUsed = others.some((row) => {
    const nd = normalizeDesc(row.description);
    return nd === kw || nd.includes(kw);
  });
  if (stillUsed) return false;
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(rule.id);
  return true;
}
