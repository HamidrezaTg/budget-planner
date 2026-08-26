import { db } from '../db.js';

// Strict read-only SQL execution for the finance chat.
// Rules: single statement, must start with SELECT or WITH, no write/DDL
// keywords anywhere, forced row limit.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|replace|grant|revoke|rollback|begin|commit)\b/i;

export function validateReadOnlySql(query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Empty query');
  if (!/^(select|with)\b/i.test(q)) throw new Error('Only SELECT queries are allowed');
  if (FORBIDDEN.test(q)) throw new Error('Query contains forbidden keywords');
  const stripped = q.replace(/;+\s*$/, '');
  if (/;/.test(stripped)) throw new Error('Only a single statement is allowed');
  return /\blimit\b/i.test(stripped) ? stripped : `${stripped} LIMIT 500`;
}

export function runReadOnlySql(query) {
  const safe = validateReadOnlySql(query);
  const rows = db.prepare(safe).all();
  return JSON.parse(JSON.stringify(rows)); // plain JSON-safe values
}

// Compact, accurate schema description injected into prompts.
export function schemaContext() {
  const accounts = db.prepare('SELECT id, name, kind FROM accounts').all();
  const groups = db.prepare('SELECT id, name FROM category_groups ORDER BY sort').all();
  const cats = db
    .prepare(
      `SELECT c.id, c.name, c.monthly_budget, g.name AS grp, a.name AS acc
       FROM categories c LEFT JOIN category_groups g ON g.id=c.group_id
       LEFT JOIN accounts a ON a.id=c.account_id ORDER BY g.sort, c.name`
    )
    .all();
  const funds = db.prepare('SELECT id, name, monthly_contribution, start_month FROM funds').all();
  const sources = db
    .prepare(
      `SELECT s.id, s.name, s.current_amount, p.name AS person FROM income_sources s
       LEFT JOIN persons p ON p.id = s.person_id`
    )
    .all();
  const commitments = db
    .prepare('SELECT name, monthly_amount, start_month, end_month FROM commitments')
    .all();

  return [
    'Tables:',
    '- transactions(id, date TEXT YYYY-MM-DD, description TEXT, amount REAL (negative=expense, positive=refund/credit), currency, account_id, category_id, needs_review INTEGER)',
    '- categories(id, name, group_id, account_id, monthly_budget REAL (standing monthly plan), active_from, active_to, is_active)',
    '- budget_lines(category_id, month TEXT YYYY-MM, planned_amount REAL)  -- per-month plan overrides',
    '- accounts(id, name, kind: sparkasse|revolut)',
    '- category_groups(id, name)',
    '- commitments(name, monthly_amount, start_month, end_month NULL=open, account_id, category_id)',
    '- funds(id, name, monthly_contribution, start_month, opening_balance)',
    '- fund_movements(fund_id, month, amount (+contribution/-withdrawal), kind, note)',
    '- income_sources(id, name, person_id, current_amount (usual monthly), recurring)',
    '- income_entries(source_id, month TEXT YYYY-MM, amount REAL)',
    '- balance_observations(account_id, month TEXT YYYY-MM, balance REAL)',
    '- category_rules(keyword, category_id)',
    '',
    `Accounts: ${JSON.stringify(accounts)}`,
    `Groups: ${JSON.stringify(groups)}`,
    `Categories: ${JSON.stringify(cats)}`,
    `Funds: ${JSON.stringify(funds)}`,
    `Income sources: ${JSON.stringify(sources)}`,
    `Commitments: ${JSON.stringify(commitments)}`,
  ].join('\n');
}
