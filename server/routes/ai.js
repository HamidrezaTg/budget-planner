import { Router } from 'express';
import { db } from '../db.js';
import { getAiConfig, chatComplete, parseJsonLoose } from '../services/ai.js';
import { requireAuth } from '../auth.js';
import { applyProposals, DEV_TOOLS, proposalFromToolCall } from '../services/dev-proposals.js';
import { runReadOnlySql, schemaContext } from '../services/read-sql.js';
import { rateLimit } from '../rate-limit.js';

const router = Router();
router.use(requireAuth);
// AI calls fan out to paid/external providers and are the most expensive
// endpoints in the app. Per-user limits keep a runaway client (or a compromised
// session) from burning quota; per-user rather than per-IP because a household
// legitimately shares one IP.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    key: (req) => `ai:${req.username}`,
  }),
);

// Client-supplied history is untrusted: cap each message and the whole
// conversation so one huge paste cannot balloon the prompt (or the bill).
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 16;
function boundedHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m?.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

const audit = (kind, detail, status = 'ok') =>
  db
    .prepare('INSERT INTO ai_audit_log (kind, detail, status) VALUES (?, ?, ?)')
    .run(kind, String(detail).slice(0, 2000), status);

// ---------------------------------------------------------------- helpers
function fail(res, e, kind) {
  audit(kind, e.message, 'error');
  res.status(e.status || 500).json({ error: e.message });
}

// ---------------------------------------------- 1) category suggestions
router.post('/suggest-categories', async (req, res) => {
  try {
    const cfg = getAiConfig(req.username);
    const limit = Math.min(Number(req.body?.limit) || 40, 100);
    const txs = db
      .prepare(
        `SELECT id, description, amount, date FROM transactions
         WHERE needs_review = 1 ORDER BY date DESC LIMIT ?`,
      )
      .all(limit);
    if (!txs.length) return res.json({ suggestions: [] });

    const cats = db
      .prepare('SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name')
      .all();

    const msg = await chatComplete(cfg, [
      {
        role: 'system',
        content:
          'You categorize bank transactions for a household budget. ' +
          'Choose the best category for each transaction from the provided list. ' +
          'Respond with ONLY a JSON array: [{"id": <transaction id>, "category": "<exact category name>", "confidence": <0-1>}] ' +
          'covering every transaction. If nothing fits well, use your best guess anyway.',
      },
      {
        role: 'user',
        content:
          `Categories: ${cats.map((c) => c.name).join(' | ')}\n\nTransactions:\n` +
          txs.map((t) => `id=${t.id} | ${t.date} | ${t.description} | ${t.amount} EUR`).join('\n'),
      },
    ]);

    const parsed = parseJsonLoose(msg.content);
    const byName = Object.fromEntries(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const suggestions = (Array.isArray(parsed) ? parsed : [])
      .map((s) => ({
        id: Number(s.id),
        category_id: byName[String(s.category ?? '').toLowerCase()] ?? null,
        category: String(s.category ?? ''),
        confidence: Number(s.confidence) || 0,
      }))
      .filter((s) => txs.some((t) => t.id === s.id) && s.category_id);

    audit('suggest', `suggested ${suggestions.length}/${txs.length} categories via ${cfg.model}`);
    res.json({ suggestions, model: cfg.model });
  } catch (e) {
    fail(res, e, 'suggest');
  }
});

// ---------------------------------------------- 2) finance chat (read-only)
const FINANCE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description:
        'Run a read-only SELECT query against the budget database and return rows as JSON.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A single SELECT statement' } },
        required: ['query'],
      },
    },
  },
];

router.post('/chat', async (req, res) => {
  try {
    const cfg = getAiConfig(req.username);
    const history = boundedHistory(req.body?.messages);

    const messages = [
      {
        role: 'system',
        content:
          'You are a helpful finance assistant for a household budget app. Answer questions ' +
          'about the user’s spending, budgets, funds, income and projection. ' +
          'Use the run_sql tool to query the database when needed — never invent numbers. ' +
          'Amounts in transactions: negative = expense, positive = refund/credit. ' +
          `Today is ${new Date().toISOString().slice(0, 10)}. Currency is EUR.\n\n` +
          'Database schema:\n' +
          schemaContext(),
      },
      ...history,
    ];

    for (let i = 0; i < 6; i++) {
      const msg = await chatComplete(cfg, messages, FINANCE_TOOLS);
      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const call of msg.tool_calls) {
          let result;
          if (call.function?.name === 'run_sql') {
            let query = '';
            try {
              query = JSON.parse(call.function.arguments || '{}').query ?? '';
              result = { rows: runReadOnlySql(query) };
              audit('read_sql', query);
            } catch (e) {
              result = { error: e.message };
              audit('read_sql', query || '(unparsable)', 'error');
            }
          } else {
            result = { error: `Unknown tool ${call.function?.name}` };
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 20000),
          });
        }
        continue;
      }
      return res.json({ reply: msg.content ?? '', messages: history });
    }
    res.json({ reply: '(The assistant went back and forth too long — try rephrasing.)' });
  } catch (e) {
    fail(res, e, 'read_sql');
  }
});

// ---------------------------------------------- 3) dev-mode chat (proposals only)
router.post('/dev-chat', async (req, res) => {
  try {
    const cfg = getAiConfig(req.username);
    const history = boundedHistory(req.body?.messages);

    const messages = [
      {
        role: 'system',
        content:
          'You are a careful assistant that PROPOSES changes to a household budget app. ' +
          'You cannot change anything yourself — you can only emit proposals the user reviews. ' +
          'When the user asks for a change, call the matching tool with precise values. ' +
          'Prefer one clear proposal over several vague ones. If information is missing ' +
          '(e.g. which month, which amount), ask instead of guessing. ' +
          'Months are YYYY-MM. Amounts are EUR numbers. ' +
          'Current state:\n' +
          schemaContext(),
      },
      ...history,
    ];

    const msg = await chatComplete(cfg, messages, DEV_TOOLS);
    const proposals = (msg.tool_calls ?? []).map((c) => proposalFromToolCall(c)).filter(Boolean);

    if (!proposals.length && msg.content) {
      return res.json({ reply: msg.content, proposals: [] });
    }
    audit('proposal', proposals.map((p) => `${p.type}:${p.summary}`).join(' | '));
    res.json({
      reply: msg.content || 'Here are my proposed changes — review and apply.',
      proposals,
    });
  } catch (e) {
    fail(res, e, 'proposal');
  }
});

// Apply reviewed proposals (re-validated server-side; the AI never executes directly)
router.post('/dev-apply', (req, res) => {
  try {
    const proposals = (Array.isArray(req.body?.proposals) ? req.body.proposals : []).slice(0, 50);
    const results = applyProposals(proposals);
    audit('applied', proposals.map((p) => `${p.type}:${p.summary ?? ''}`).join(' | '));
    res.json({ results });
  } catch (e) {
    fail(res, e, 'applied');
  }
});

router.get('/audit', (_req, res) => {
  res.json(db.prepare('SELECT * FROM ai_audit_log ORDER BY id DESC LIMIT 100').all());
});

export default router;
