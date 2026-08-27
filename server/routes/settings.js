import { Router } from 'express';
import { getSetting, setSetting, db, als, getUserDb, closeUserDb, DATA_DIR, initUserSchema } from '../db.js';
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
  let ratesCleared = false;
  if (currency !== undefined) {
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Unknown currency' });
    const previous = getSetting('currency') || 'EUR';
    setSetting('currency', currency);
    // FX rates are stored relative to the OLD base currency; a switch makes
    // them all meaningless. Clear them instead of converting wrongly.
    if (previous !== currency) {
      db.prepare('DELETE FROM fx_rates').run();
      ratesCleared = true;
    }
  }
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
  res.json({ ...ai, currency: getSetting('currency') || 'EUR', rates_cleared: ratesCleared });
});

// ------------------------------------------------------------ exchange rates
// Monthly reference rates converting foreign transaction currencies into the
// base currency. Missing rates count transactions 1:1 and are surfaced as
// warnings — they never silently distort totals forever.
const MONTH_RE = /^\d{4}-\d{2}$/;

router.get('/fx', (_req, res) => {
  const base = getSetting('currency') || 'EUR';
  const used = db
    .prepare(
      'SELECT DISTINCT currency FROM transactions WHERE currency != ? ORDER BY currency'
    )
    .all(base)
    .map((r) => r.currency);
  const rates = db
    .prepare(
      `SELECT month, currency, rate, source, updated_at FROM fx_rates
       WHERE currency != ? ORDER BY month DESC, currency LIMIT 240`
    )
    .all(base);
  const missingRows = db
    .prepare(
      `SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t
       LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE t.currency != ? AND f.month IS NULL`
    )
    .all(base);
  res.json({ base, used, rates, missing: missingRows });
});

router.put('/fx', (req, res) => {
  const { month, currency, rate } = req.body ?? {};
  const base = getSetting('currency') || 'EUR';
  if (!MONTH_RE.test(month || '')) return res.status(400).json({ error: 'month must be YYYY-MM' });
  if (!currency || currency === base)
    return res.status(400).json({ error: 'currency must differ from the base currency' });
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0 || r > 100000)
    return res.status(400).json({ error: 'rate must be a positive number' });
  db.prepare(
    `INSERT INTO fx_rates (month, currency, rate, source) VALUES (?, ?, ?, 'manual')
     ON CONFLICT(month, currency) DO UPDATE SET rate = excluded.rate, source = 'manual', updated_at = datetime('now')`
  ).run(month, String(currency).toUpperCase(), r);
  res.json({ ok: true });
});

router.delete('/fx', (req, res) => {
  const { month, currency } = req.body ?? {};
  if (!MONTH_RE.test(month || '') || !currency)
    return res.status(400).json({ error: 'month and currency required' });
  db.prepare('DELETE FROM fx_rates WHERE month = ? AND currency = ?').run(month, currency);
  res.json({ ok: true });
});

// Fill missing rates from frankfurter.app (ECB reference rates). Keyless and
// privacy-safe: requests contain only dates and currency codes.
router.post('/fx/fetch', async (req, res) => {
  const base = getSetting('currency') || 'EUR';
  const overwrite = req.body?.overwrite === true;
  const rows = overwrite
    ? db.prepare('SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t WHERE t.currency != ?').all(base)
    : db
        .prepare(
          `SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t
           LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
           WHERE t.currency != ? AND f.month IS NULL`
        )
        .all(base);

  const lastDay = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  };

  let filled = 0;
  const failed = [];
  const upsert = db.prepare(
    `INSERT INTO fx_rates (month, currency, rate, source) VALUES (?, ?, ?, 'ecb')
     ON CONFLICT(month, currency) DO UPDATE SET rate = excluded.rate, source = 'ecb', updated_at = datetime('now')`
  );
  for (const row of rows) {
    try {
      const url = `https://api.frankfurter.dev/v1/${lastDay(row.month)}?from=${encodeURIComponent(row.currency)}&to=${encodeURIComponent(base)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const rate = data?.rates?.[base];
      if (!Number.isFinite(rate)) throw new Error(`no ${base} rate for ${row.currency} in response`);
      upsert.run(row.month, row.currency, rate);
      filled++;
    } catch (e) {
      failed.push({ month: row.month, currency: row.currency, error: e.message });
    }
  }
  res.json({ ok: failed.length === 0, filled, attempted: rows.length, failed });
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
  const files = db.prepare('SELECT filename FROM attachments').all();
  if (files.length) {
    const dir = path.join(DATA_DIR, 'uploads', req.username.replace(/[^a-zA-Z0-9_\-]/g, '_'));
    for (const f of files) {
      const resolved = path.resolve(dir, f.filename);
      if (resolved.startsWith(path.resolve(dir) + path.sep)) {
        try { fs.unlinkSync(resolved); } catch {}
      }
    }
  }
  db.exec('BEGIN');
  try {
    // FK cascade removes split children + attachment metadata rows.
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM ai_audit_log').run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, deleted: n });
});

// Restore a previously downloaded backup (.db). Validates the file, keeps a
// timestamped copy of the current database as <name>.db.pre-restore-<ts>, then
// swaps it in via an atomic rename. On reopen failure the previous database is
// restored, so a failed copy can never leave the live database truncated.
router.post('/restore', restoreUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const dataDir = DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = path.join(dataDir, `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, req.file.buffer);

  let check;
  try {
    check = new DatabaseSync(tmp, { readOnly: true });
    const tables = new Set(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) throw new Error(`Not a valid budget backup — missing: ${missing.join(', ')}`);
    const integrity = check.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok')
      throw new Error('Backup failed the SQLite integrity check — refusing to restore');
    const fkViolations = check.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length)
      throw new Error(`Backup has ${fkViolations.length} broken reference(s) — refusing to restore`);
    const txCount = check.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
    const catCount = check.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
    check.close();
    check = null;

    const username = req.username;
    const safe = username.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const target = path.join(dataDir, 'users', `${safe}.db`);

    // Apply any pending schema migrations to a writable staging copy so an
    // older backup still restores cleanly into the current app version.
    const staged = `${tmp}.staged`;
    fs.copyFileSync(tmp, staged);
    const mig = new DatabaseSync(staged);
    initUserSchema(mig);
    mig.close();

    // Checkpoint before copying the live database so its snapshot does not
    // depend on a separate WAL file.
    const live = getUserDb(username);
    live.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    closeUserDb(username);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pre = `${target}.pre-restore-${stamp}`;
    fs.copyFileSync(target, pre);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(target + suffix); } catch {}
    }

    // Atomic swap on the same filesystem.
    fs.renameSync(staged, target);
    try { fs.unlinkSync(tmp); } catch {}

    try {
      getUserDb(username); // reopen + cache
    } catch (e) {
      // Roll back using renames so a failed restore never leaves a partial
      // database or a target WAL sidecar in place.
      const failed = `${target}.failed-restore-${stamp}`;
      try { fs.renameSync(target, failed); } catch {}
      fs.renameSync(pre, target);
      try { getUserDb(username); } catch {}
      try { fs.unlinkSync(failed); } catch {}
      throw new Error('Restore failed while reopening the database — previous data was rolled back');
    }
    res.json({ ok: true, transactions: txCount, categories: catCount });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(tmp + '.staged'); } catch {}
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
