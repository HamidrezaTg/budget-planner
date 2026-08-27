import { db } from '../db.js';
import { constants as sqlite } from 'node:sqlite';

// Strict read-only SQL execution for the finance chat.
// Rules: single statement, must start with SELECT or WITH, no write/DDL
// keywords anywhere, only allowed tables, capped row limit.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|replace|grant|revoke|rollback|begin|commit|load_extension)\b/i;

// Tables the AI may query. Explicitly excludes `settings` (holds the AI API
// key), `ai_audit_log` (internal), and anything not budget-related.
const ALLOWED_TABLES = new Set([
  'transactions', 'fx_rates', 'categories', 'category_groups', 'accounts',
  'budget_lines', 'commitments', 'funds', 'fund_movements', 'income_sources',
  'income_entries', 'balance_observations', 'category_rules',
  'category_automation_rules', 'recurrences', 'attachments', 'monthly_reports',
]);

const MAX_AI_ROWS = 200;

const TABLE_RE = /\bfrom\s+([a-z_][a-z0-9_]*)|join\s+([a-z_][a-z0-9_]*)/gi;

export function validateReadOnlySql(query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Empty query');
  if (!/^(select|with)\b/i.test(q)) throw new Error('Only SELECT queries are allowed');
  if (FORBIDDEN.test(q)) throw new Error('Query contains forbidden keywords');
  const stripped = q.replace(/;+\s*$/, '');
  if (/;/.test(stripped)) throw new Error('Only a single statement is allowed');

  // Restrict to the allowlist so credential-bearing tables stay out of reach.
  const seen = new Set();
  for (const m of stripped.matchAll(TABLE_RE)) {
    const table = (m[1] || m[2]).toLowerCase();
    seen.add(table);
  }
  if (seen.size === 0) throw new Error('Query must reference a table');
  for (const t of seen) {
    if (!ALLOWED_TABLES.has(t))
      throw new Error(`Table "${t}" is not available to the assistant`);
  }

  // Cap user-supplied limits regardless of what the AI asked for.
  const limitMatch = /\blimit\s+(\d+)/i.exec(stripped);
  if (limitMatch) {
    if (Number(limitMatch[1]) > MAX_AI_ROWS)
      throw new Error(`LIMIT may not exceed ${MAX_AI_ROWS} rows`);
    return stripped;
  }
  return `${stripped} LIMIT ${MAX_AI_ROWS}`;
}

export function runReadOnlySql(query) {
  const safe = validateReadOnlySql(query);
  let deniedTable = null;
  db.setAuthorizer((action, param1, _param2, databaseName) => {
    if (action === sqlite.SQLITE_READ) {
      if (databaseName !== 'main' || !ALLOWED_TABLES.has(String(param1).toLowerCase())) {
        deniedTable = String(param1 || 'unknown');
        return sqlite.SQLITE_DENY;
      }
    }
    if ([
      sqlite.SQLITE_INSERT,
      sqlite.SQLITE_UPDATE,
      sqlite.SQLITE_DELETE,
      sqlite.SQLITE_CREATE_INDEX,
      sqlite.SQLITE_CREATE_TABLE,
      sqlite.SQLITE_CREATE_TRIGGER,
      sqlite.SQLITE_CREATE_VIEW,
      sqlite.SQLITE_DROP_INDEX,
      sqlite.SQLITE_DROP_TABLE,
      sqlite.SQLITE_DROP_TRIGGER,
      sqlite.SQLITE_DROP_VIEW,
      sqlite.SQLITE_ATTACH,
      sqlite.SQLITE_DETACH,
      sqlite.SQLITE_ALTER_TABLE,
      sqlite.SQLITE_PRAGMA,
    ].includes(action)) return sqlite.SQLITE_DENY;
    return sqlite.SQLITE_OK;
  });
  try {
    const rows = db.prepare(safe).all();
    return JSON.parse(JSON.stringify(rows)); // plain JSON-safe values
  } catch (error) {
    if (deniedTable) throw new Error(`Table "${deniedTable}" is not available to the assistant`);
    throw error;
  } finally {
    db.setAuthorizer(null);
  }
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
    '- transactions(id, date TEXT YYYY-MM-DD, description TEXT, amount REAL (negative=expense, positive=refund/credit), currency (original statement currency!), account_id, category_id, needs_review INTEGER)',
    '- fx_rates(month TEXT YYYY-MM, currency, rate REAL = base-currency units per 1 unit of currency)  -- monthly reference rates; convert with amount * rate for the transaction month',
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
