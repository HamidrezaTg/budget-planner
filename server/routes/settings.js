import { Router } from 'express';
import { getSetting, setSetting, db, als, getUserDb, closeUserDb, DATA_DIR } from '../db.js';
import { getAiConfig, chatComplete } from '../services/ai.js';
import { requireAuth } from '../auth.js';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';

const router = Router();
router.use(requireAuth);

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

const REQUIRED_TABLES = [
  'categories', 'transactions', 'accounts', 'category_groups',
  'funds', 'commitments', 'income_sources', 'settings',
];

// Known OpenAI-compatible providers. All expose GET /models for listing.
const PROVIDERS = {
  openai: { label: 'OpenAI', base_url: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic (Claude)', base_url: 'https://api.anthropic.com/v1' },
  openrouter: { label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  groq: { label: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
  deepseek: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
  mistral: { label: 'Mistral', base_url: 'https://api.mistral.ai/v1' },
  together: { label: 'Together AI', base_url: 'https://api.together.xyz/v1' },
  ollama: { label: 'Ollama (local)', base_url: 'http://localhost:11434/v1', no_key: true },
  lmstudio: { label: 'LM Studio (local)', base_url: 'http://localhost:1234/v1', no_key: true },
  custom: { label: 'Custom (enter URL)', base_url: '' },
};

function masked(cfg) {
  return {
    provider: getSetting('ai_provider') || '',
    base_url: cfg.baseUrl,
    model: cfg.model,
    has_key: !!cfg.apiKey,
    key_hint: cfg.apiKey ? cfg.apiKey.slice(0, 4) + '…' + cfg.apiKey.slice(-4) : '',
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
  };
}

function baseUrlFor(provider, customUrl) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Unknown provider');
  if (provider === 'custom') {
    const url = (customUrl || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error('Custom provider needs a Base URL');
    return url;
  }
  return p.base_url;
}

router.get('/', (req, res) => {
  try {
    res.json({ ...masked(getAiConfig()), currency: getSetting('currency') || 'EUR' });
  } catch {
    res.json({
      provider: getSetting('ai_provider') || '',
      base_url: getSetting('ai_base_url') || '',
      model: getSetting('ai_model') || '',
      has_key: false,
      key_hint: '',
      currency: getSetting('currency') || 'EUR',
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
    });
  }
});

router.put('/', (req, res) => {
  const { provider, api_key, model, base_url, currency } = req.body ?? {};
  if (provider !== undefined) {
    if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Unknown provider' });
    setSetting('ai_provider', provider);
    setSetting('ai_base_url', baseUrlFor(provider, base_url));
  }
  if (api_key) setSetting('ai_api_key', api_key.trim());
  if (model !== undefined) setSetting('ai_model', model.trim());
  if (currency !== undefined) {
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Unknown currency' });
    setSetting('currency', currency);
  }
  let ai;
  try {
    ai = masked(getAiConfig());
  } catch {
    ai = {
      provider: getSetting('ai_provider') || '',
      base_url: getSetting('ai_base_url') || '',
      model: getSetting('ai_model') || '',
      has_key: !!getSetting('ai_api_key'),
      key_hint: '',
    };
  }
  res.json({ ...ai, currency: getSetting('currency') || 'EUR' });
});

// Download a full backup of this user's database.
router.get('/backup', (req, res) => {
  const inst = als.getStore();
  // flush WAL so the file copy is complete
  inst.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const row = db.prepare('SELECT file FROM pragma_database_list()').get();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="budget-backup-${new Date().toISOString().slice(0, 10)}.db"`
  );
  fs.createReadStream(row.file).pipe(res);
});

// Danger zone: delete all spending data, keep budgets/rules/funds/income.
router.delete('/spending', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM ai_audit_log').run();
  res.json({ ok: true, deleted: n });
});

// Restore a previously downloaded backup (.db). Validates the file, keeps a
// copy of the current database as <name>.db.pre-restore, then swaps it in.
router.post('/restore', restoreUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const tmp = path.join(DATA_DIR, `restore-${Date.now()}.tmp`);
  const dataDir = DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, req.file.buffer);

  let check;
  try {
    check = new DatabaseSync(tmp, { readOnly: true });
    const tables = new Set(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) throw new Error(`Not a valid budget backup — missing: ${missing.join(', ')}`);
    const txCount = check.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
    const catCount = check.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
    check.close();

    const username = req.username;
    const safe = username.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const target = path.join(dataDir, 'users', `${safe}.db`);

    closeUserDb(username);
    try { fs.copyFileSync(target, target + '.pre-restore'); } catch {}
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(target + suffix); } catch {}
    }
    fs.copyFileSync(tmp, target);
    fs.unlinkSync(tmp);

    getUserDb(username); // reopen + cache
    res.json({ ok: true, transactions: txCount, categories: catCount });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    try { check?.close(); } catch {}
    res.status(400).json({ error: e.message });
  }
});

// List models available to the given (or saved) key.
router.post('/models', async (req, res) => {
  try {
    const { provider, api_key, base_url } = req.body ?? {};
    const url = baseUrlFor(
      provider || getSetting('ai_provider') || 'openai',
      base_url ?? getSetting('ai_base_url')
    );
    const key = api_key || getSetting('ai_api_key') || '';
    const needsKey = !(PROVIDERS[provider] ?? {}).no_key;
    if (needsKey && !key) return res.status(400).json({ error: 'Enter your API key first' });

    const r = await fetch(`${url}/models`, {
      headers: needsKey ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: `Could not list models (${r.status}): ${text.slice(0, 200)}` });
    }
    const data = await r.json();
    let models = (data.data ?? data.models ?? [])
      .map((m) => m.id ?? m.name)
      .filter(Boolean)
      .sort();
    res.json({ models });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/test', async (_req, res) => {
  try {
    const cfg = getAiConfig();
    const msg = await chatComplete(cfg, [
      { role: 'user', content: 'Reply with exactly: OK' },
    ]);
    res.json({ ok: true, reply: (msg.content || '').slice(0, 100) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
