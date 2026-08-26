import { db } from '../db.js';

// Guardrailed dev-mode proposals. The AI can ONLY emit these typed operations;
// each is validated and converted to a human-readable diff. Nothing touches the
// database until the user explicitly applies a proposal, and even then the
// server re-validates everything. No raw SQL, no schema changes, no deletes of
// transaction history, no auth changes — by construction.

const MONTH = /^\d{4}-\d{2}$/;
const num = (v) => {
  const n = Number(v);
  if (isNaN(n)) throw new Error(`Invalid number: ${v}`);
  return n;
};
const month = (v, optional = false) => {
  if (optional && (v === undefined || v === null || v === '')) return null;
  if (!MONTH.test(String(v ?? ''))) throw new Error(`Invalid month (need YYYY-MM): ${v}`);
  return String(v);
};

function findCategoryByName(name) {
  return db.prepare('SELECT * FROM categories WHERE name = ? COLLATE NOCASE').get(String(name ?? '').trim());
}
function findAccountByName(name) {
  if (!name) return null;
  return db.prepare('SELECT * FROM accounts WHERE name = ? COLLATE NOCASE').get(String(name).trim());
}
function findFundByName(name) {
  return db.prepare('SELECT * FROM funds WHERE name = ? COLLATE NOCASE').get(String(name ?? '').trim());
}

// Each builder returns { type, summary, detail, apply() }
const BUILDERS = {
  set_category_budget(args) {
    const cat = findCategoryByName(args.category_name);
    if (!cat) throw new Error(`Unknown category "${args.category_name}"`);
    const amount = num(args.monthly_amount);
    const m = month(args.month, true);
    return {
      type: 'set_category_budget',
      summary: m
        ? `Set ${cat.name} budget for ${m} to €${amount}`
        : `Set standing budget for ${cat.name} to €${amount}/month`,
      detail: { category_id: cat.id, month: m, amount },
      apply() {
        if (m) {
          db.prepare(
            `INSERT INTO budget_lines (category_id, month, planned_amount) VALUES (?, ?, ?)
             ON CONFLICT(category_id, month) DO UPDATE SET planned_amount = excluded.planned_amount`
          ).run(cat.id, m, amount);
        } else {
          db.prepare('UPDATE categories SET monthly_budget = ? WHERE id = ?').run(amount, cat.id);
        }
      },
    };
  },

  add_category(args) {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('Category name required');
    if (findCategoryByName(name)) throw new Error(`Category "${name}" already exists`);
    const grp = db.prepare('SELECT * FROM category_groups WHERE name = ? COLLATE NOCASE').get(String(args.group_name ?? '').trim());
    const acc = findAccountByName(args.account_name);
    const amount = num(args.monthly_amount ?? 0);
    return {
      type: 'add_category',
      summary: `Create category "${name}" (${grp?.name ?? 'no group'}, ${acc?.name ?? 'untagged'}), €${amount}/mo`,
      detail: { name, group_id: grp?.id ?? null, account_id: acc?.id ?? null, amount },
      apply() {
        db.prepare(
          'INSERT INTO categories (name, group_id, account_id, monthly_budget) VALUES (?, ?, ?, ?)'
        ).run(name, grp?.id ?? null, acc?.id ?? null, amount);
      },
    };
  },

  retire_category(args) {
    const cat = findCategoryByName(args.category_name);
    if (!cat) throw new Error(`Unknown category "${args.category_name}"`);
    return {
      type: 'retire_category',
      summary: `Retire category "${cat.name}" (clears its plan and rules)`,
      detail: { category_id: cat.id },
      apply() {
        db.prepare('DELETE FROM budget_lines WHERE category_id = ?').run(cat.id);
        db.prepare('DELETE FROM category_rules WHERE category_id = ?').run(cat.id);
        db.prepare('UPDATE categories SET is_active = 0, monthly_budget = 0 WHERE id = ?').run(cat.id);
      },
    };
  },

  add_keyword_rule(args) {
    const cat = findCategoryByName(args.category_name);
    if (!cat) throw new Error(`Unknown category "${args.category_name}"`);
    const keyword = String(args.keyword ?? '').toLowerCase().trim();
    if (!keyword) throw new Error('Keyword required');
    return {
      type: 'add_keyword_rule',
      summary: `Rule: transactions containing "${keyword}" → ${cat.name}`,
      detail: { keyword, category_id: cat.id },
      apply() {
        db.prepare(
          'INSERT INTO category_rules (keyword, category_id) VALUES (?, ?) ON CONFLICT(keyword) DO UPDATE SET category_id = excluded.category_id'
        ).run(keyword, cat.id);
        db.prepare('UPDATE transactions SET category_id = ?, needs_review = 0 WHERE needs_review = 1 AND LOWER(description) LIKE ?').run(
          cat.id, `%${keyword}%`
        );
      },
    };
  },

  remove_keyword_rule(args) {
    const keyword = String(args.keyword ?? '').toLowerCase().trim();
    return {
      type: 'remove_keyword_rule',
      summary: `Delete rule "${keyword}"`,
      detail: { keyword },
      apply() {
        db.prepare('DELETE FROM category_rules WHERE keyword = ?').run(keyword);
      },
    };
  },

  add_commitment(args) {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('Commitment name required');
    const amount = num(args.monthly_amount);
    const start = month(args.start_month);
    const end = month(args.end_month, true);
    const acc = findAccountByName(args.account_name);
    return {
      type: 'add_commitment',
      summary: `Add commitment "${name}": €${amount}/mo from ${start}${end ? ` to ${end}` : ' (open-ended)'}`,
      detail: { name, monthly_amount: amount, start_month: start, end_month: end, account_id: acc?.id ?? null },
      apply() {
        db.prepare(
          'INSERT INTO commitments (name, monthly_amount, start_month, end_month, account_id) VALUES (?, ?, ?, ?, ?)'
        ).run(name, amount, start, end, acc?.id ?? null);
      },
    };
  },

  end_commitment(args) {
    const row = db.prepare('SELECT * FROM commitments WHERE name = ? COLLATE NOCASE').get(String(args.name ?? '').trim());
    if (!row) throw new Error(`Unknown commitment "${args.name}"`);
    const end = month(args.end_month);
    return {
      type: 'end_commitment',
      summary: `End commitment "${row.name}" at ${end} (was ${row.end_month ?? 'open-ended'})`,
      detail: { id: row.id, end_month: end },
      apply() {
        db.prepare('UPDATE commitments SET end_month = ? WHERE id = ?').run(end, row.id);
      },
    };
  },

  set_fund_contribution(args) {
    const fund = findFundByName(args.fund_name);
    if (!fund) throw new Error(`Unknown fund "${args.fund_name}"`);
    const amount = num(args.monthly_contribution);
    return {
      type: 'set_fund_contribution',
      summary: `Set ${fund.name} contribution to €${amount}/mo (was €${fund.monthly_contribution})`,
      detail: { fund_id: fund.id, monthly_contribution: amount },
      apply() {
        db.prepare('UPDATE funds SET monthly_contribution = ? WHERE id = ?').run(amount, fund.id);
      },
    };
  },

  fund_movement(args) {
    const fund = findFundByName(args.fund_name);
    if (!fund) throw new Error(`Unknown fund "${args.fund_name}"`);
    const kind = args.kind === 'contribution' ? 'contribution' : 'withdrawal';
    const amount = num(args.amount);
    if (amount <= 0) throw new Error('Amount must be positive');
    const m = month(args.month);
    return {
      type: 'fund_movement',
      summary: `${kind === 'contribution' ? 'Add' : 'Withdraw'} €${amount} ${kind === 'contribution' ? 'into' : 'from'} ${fund.name} (${m})`,
      detail: { fund_id: fund.id, month: m, amount: kind === 'contribution' ? amount : -amount, kind },
      apply() {
        db.prepare('INSERT INTO fund_movements (fund_id, month, amount, kind, note) VALUES (?, ?, ?, ?, ?)').run(
          fund.id, m, kind === 'contribution' ? amount : -amount, kind, 'via AI dev-mode'
        );
      },
    };
  },

  set_income(args) {
    const src = db
      .prepare(
        `SELECT s.* FROM income_sources s LEFT JOIN persons p ON p.id = s.person_id
         WHERE s.name = ? COLLATE NOCASE AND (? IS NULL OR p.name = ? COLLATE NOCASE)`
      )
      .get(String(args.source_name ?? '').trim(), args.person ?? null, args.person ?? null);
    if (!src) throw new Error(`Unknown income source "${args.source_name}"${args.person ? ` for ${args.person}` : ''}`);
    const amount = num(args.current_amount);
    return {
      type: 'set_income',
      summary: `Set usual income for ${args.person ? args.person + '’s ' : ''}${src.name} to €${amount}/mo (was €${src.current_amount})`,
      detail: { source_id: src.id, current_amount: amount },
      apply() {
        db.prepare('UPDATE income_sources SET current_amount = ? WHERE id = ?').run(amount, src.id);
      },
    };
  },

  enter_income(args) {
    const src = db
      .prepare(
        `SELECT s.* FROM income_sources s LEFT JOIN persons p ON p.id = s.person_id
         WHERE s.name = ? COLLATE NOCASE AND (? IS NULL OR p.name = ? COLLATE NOCASE)`
      )
      .get(String(args.source_name ?? '').trim(), args.person ?? null, args.person ?? null);
    if (!src) throw new Error(`Unknown income source "${args.source_name}"`);
    const m = month(args.month);
    const amount = num(args.amount);
    return {
      type: 'enter_income',
      summary: `Record actual income €${amount} for ${src.name} in ${m}`,
      detail: { source_id: src.id, month: m, amount },
      apply() {
        db.prepare(
          `INSERT INTO income_entries (source_id, month, amount) VALUES (?, ?, ?)
           ON CONFLICT(source_id, month) DO UPDATE SET amount = excluded.amount`
        ).run(src.id, m, amount);
      },
    };
  },

  record_balance(args) {
    const acc = findAccountByName(args.account_name);
    if (!acc) throw new Error(`Unknown account "${args.account_name}"`);
    const m = month(args.month);
    const balance = num(args.balance);
    return {
      type: 'record_balance',
      summary: `Record ${acc.name} balance €${balance} for ${m} (re-anchors the projection)`,
      detail: { account_id: acc.id, month: m, balance },
      apply() {
        db.prepare(
          `INSERT INTO balance_observations (account_id, month, balance) VALUES (?, ?, ?)
           ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance`
        ).run(acc.id, m, balance);
      },
    };
  },
};

export const DEV_TOOLS = Object.entries(BUILDERS).map(([name]) => ({
  type: 'function',
  function: {
    name,
    description: `Propose: ${name.replace(/_/g, ' ')}. Not executed until the user approves.`,
    parameters: { type: 'object', properties: {}, required: [] }, // permissive; validated server-side
  },
}));

// Convert a model tool_call into a validated proposal (or null if unknown type).
export function proposalFromToolCall(call) {
  const name = call.function?.name;
  if (!BUILDERS[name]) return null;
  try {
    const args = JSON.parse(call.function.arguments || '{}');
    const proposal = BUILDERS[name](args);
    return { ...proposal, args };
  } catch (e) {
    return {
      type: name,
      summary: `⚠ Invalid proposal: ${e.message}`,
      detail: null,
      error: true,
      args: call.function?.arguments,
    };
  }
}

// Re-validate and apply proposals that the user approved.
export function applyProposals(proposals) {
  const results = [];
  for (const p of proposals) {
    try {
      if (p.error || !BUILDERS[p.type]) throw new Error('Unknown or invalid proposal');
      const fresh = BUILDERS[p.type](p.args ?? p.detail ?? {});
      fresh.apply();
      results.push({ type: p.type, summary: fresh.summary, ok: true });
    } catch (e) {
      results.push({ type: p.type, ok: false, error: e.message });
    }
  }
  return results;
}
