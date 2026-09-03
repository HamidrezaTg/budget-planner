import { Router } from 'express';
import {
  getSetting,
  setSetting,
  db,
  als,
  getUserDb,
  closeUserDb,
  DATA_DIR,
  initUserSchema,
  safeDbFilename,
} from '../db.js';
import { getAiConfig, chatComplete, isTrustedBaseUrl } from '../services/ai.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  PROVIDERS,
  baseUrlFor,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  replaceShares,
  listShares,
  upsertCurrentProfile,
} from '../services/ai-profiles.js';
import { pauseRequests, resumeRequests } from '../request-gate.js';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { ntfyConfig, publishNtfy, validateNtfyConfig } from '../services/notifications.js';
import {
  egressConfig,
  setEgressConfig,
  validateAllowlistEntries,
  assertEgressAllowed,
} from '../services/egress.js';
import { getVersionStatus } from '../version.js';

const router = Router();
router.use(requireAuth);

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const THEMES = ['system', 'light', 'dark', 'midnight', 'forest'];

router.get('/version', async (req, res) => {
  res.json(await getVersionStatus({ refresh: req.query.refresh === '1' }));
});

const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

const REQUIRED_TABLES = [
  'categories',
  'transactions',
  'accounts',
  'category_groups',
  'funds',
  'commitments',
  'income_sources',
  'settings',
];

function masked(cfg) {
  return {
    provider: cfg.provider || '',
    base_url: cfg.shared ? '' : cfg.baseUrl || '',
    model: cfg.model,
    has_key: !cfg.shared && !!cfg.apiKey,
    key_hint: cfg.shared || !cfg.apiKey ? '' : cfg.apiKey.slice(0, 4) + '…' + cfg.apiKey.slice(-4),
    profile_id: cfg.profileId || null,
    profile_name: cfg.profileName || '',
    shared: !!cfg.shared,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
  };
}

router.get('/', (req, res) => {
  try {
    res.json({
      ...masked(getAiConfig(req.username)),
      ...listProfiles(req.username),
      currency: getSetting('currency') || 'EUR',
      theme: getSetting('theme') || 'system',
    });
  } catch {
    res.json({
      provider: '',
      base_url: '',
      model: '',
      has_key: false,
      key_hint: '',
      currency: getSetting('currency') || 'EUR',
      theme: getSetting('theme') || 'system',
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
      profiles: listProfiles(req.username).profiles,
    });
  }
});

router.put('/', (req, res) => {
  const { name, provider, api_key, model, base_url, currency, theme } = req.body ?? {};
  // Validate EVERYTHING before mutating anything: the currency change wipes
  // all FX rates, and that must never happen when another field is invalid.
  if (currency !== undefined && !CURRENCIES.includes(currency))
    return res.status(400).json({ error: 'Unknown currency' });
  if (provider !== undefined && !PROVIDERS[provider])
    return res.status(400).json({ error: 'Unknown provider' });
  if (model !== undefined && typeof model !== 'string')
    return res.status(400).json({ error: 'model must be a string' });
  if (theme !== undefined && !THEMES.includes(theme))
    return res.status(400).json({ error: 'Unknown theme' });

  let ratesCleared = false;
  if (currency !== undefined) {
    const previous = getSetting('currency') || 'EUR';
    setSetting('currency', currency);
    // FX rates are stored relative to the OLD base currency; a switch makes
    // them all meaningless. Clear them instead of converting wrongly.
    if (previous !== currency) {
      db.prepare('DELETE FROM fx_rates').run();
      ratesCleared = true;
    }
  }
  if (theme !== undefined) setSetting('theme', theme);
  if (
    provider !== undefined ||
    api_key !== undefined ||
    model !== undefined ||
    base_url !== undefined
  ) {
    try {
      upsertCurrentProfile(req.username, { name, provider, api_key, model, base_url });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  let ai;
  try {
    ai = masked(getAiConfig(req.username));
  } catch {
    ai = {
      provider: '',
      base_url: '',
      model: '',
      has_key: false,
      key_hint: '',
    };
  }
  res.json({
    ...ai,
    ...listProfiles(req.username),
    currency: getSetting('currency') || 'EUR',
    theme: getSetting('theme') || 'system',
    rates_cleared: ratesCleared,
  });
});

// ------------------------------------------------------------- AI profiles
router.get('/ai-profiles', (req, res) => res.json(listProfiles(req.username)));

router.post('/ai-profiles', (req, res) => {
  try {
    const row = createProfile(req.username, req.body ?? {});
    res.status(201).json(profileResponse(row, req.username));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/ai-profiles/active', (req, res) => {
  try {
    const ownerId = Number(req.body?.owner_user_id);
    const profileId = String(req.body?.profile_id || '');
    setActiveProfile(req.username, ownerId, profileId);
    res.json(listProfiles(req.username));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/ai-profiles/:id', (req, res) => {
  try {
    const row = updateProfile(req.username, req.params.id, req.body ?? {});
    res.json(profileResponse(row, req.username));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/ai-profiles/:id', (req, res) => {
  try {
    deleteProfile(req.username, req.params.id);
    res.json(listProfiles(req.username));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/ai-profiles/:id/shares', requireAdmin, (req, res) => {
  try {
    res.json({ shares: listShares(req.username, req.params.id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/ai-profiles/:id/shares', requireAdmin, (req, res) => {
  try {
    res.json({ shares: replaceShares(req.username, req.params.id, req.body?.usernames) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function profileResponse(row, username) {
  return (
    listProfiles(username).profiles.find((profile) => profile.id === row.id && profile.own) || {
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      own: true,
    }
  );
}

function ntfyResponse() {
  const config = ntfyConfig();
  return {
    enabled: config.enabled,
    server: config.server,
    topic: config.topic,
    has_token: !!config.token,
    token_hint: config.token ? `${config.token.slice(0, 4)}…${config.token.slice(-4)}` : '',
  };
}

router.get('/ntfy', (_req, res) => res.json(ntfyResponse()));

router.put('/ntfy', (req, res) => {
  const current = ntfyConfig();
  const next = {
    server: req.body?.server ?? current.server,
    topic: req.body?.topic ?? current.topic,
  };
  if (req.body?.enabled !== undefined && typeof req.body.enabled !== 'boolean')
    return res.status(400).json({ error: 'enabled must be a boolean' });
  try {
    if (req.body?.enabled || next.topic) validateNtfyConfig(next);
    // Fail at save time when the administrator's egress policy forbids this
    // ntfy server — same policy the publisher enforces at request time.
    if (req.body?.enabled || next.topic) assertEgressAllowed(next.server);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  setSetting(
    'ntfy_enabled',
    req.body?.enabled ? '1' : req.body?.enabled === false ? '0' : current.enabled ? '1' : '0',
  );
  setSetting('ntfy_server', String(next.server).trim().replace(/\/+$/, ''));
  setSetting('ntfy_topic', String(next.topic).trim());
  if (req.body?.token) setSetting('ntfy_token', String(req.body.token).trim());
  res.json(ntfyResponse());
});

router.post('/ntfy/test', async (_req, res) => {
  const config = ntfyConfig();
  if (!config.topic) return res.status(400).json({ error: 'Configure an ntfy topic first' });
  try {
    await publishNtfy({
      ...config,
      title: 'Budget Planner test notification',
      message: 'ntfy notifications are configured correctly.',
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

// ------------------------------------------------- outbound policy (admin)
// Global SSRF guard for AI + ntfy endpoints. 'all' preserves the default
// behavior; 'allowlist' restricts every outbound fetch to approved hosts.
router.get('/egress', requireAdmin, (_req, res) => {
  res.json(egressConfig());
});

router.put('/egress', requireAdmin, (req, res) => {
  const mode = req.body?.mode;
  if (!['all', 'allowlist'].includes(mode))
    return res.status(400).json({ error: "mode must be 'all' or 'allowlist'" });
  if (req.body?.allowlist !== undefined && !Array.isArray(req.body.allowlist))
    return res.status(400).json({ error: 'allowlist must be an array of hostnames' });
  let allowlist;
  try {
    allowlist = validateAllowlistEntries(req.body?.allowlist ?? []);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  setEgressConfig({ mode, allowlist });
  res.json(egressConfig());
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
      `SELECT currency FROM transactions WHERE currency != ?
       UNION SELECT display_currency AS currency FROM accounts WHERE display_currency != ?
       ORDER BY currency`,
    )
    .all(base, base)
    .map((r) => r.currency);
  const rates = db
    .prepare(
      `SELECT month, currency, rate, source, updated_at FROM fx_rates
       WHERE currency != ? ORDER BY month DESC, currency LIMIT 240`,
    )
    .all(base);
  const missingRows = db
    .prepare(
      `SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t
       LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE t.currency != ? AND f.month IS NULL
       UNION
       SELECT DISTINCT o.month, a.display_currency FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id
       LEFT JOIN fx_rates f ON f.month = o.month AND f.currency = a.display_currency
       WHERE a.display_currency != ? AND f.month IS NULL`,
    )
    .all(base, base);
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
     ON CONFLICT(month, currency) DO UPDATE SET rate = excluded.rate, source = 'manual', updated_at = datetime('now')`,
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
  const ratePairs = overwrite
    ? `SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t WHERE t.currency != ?
       UNION SELECT DISTINCT o.month, a.display_currency FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id WHERE a.display_currency != ?`
    : `SELECT DISTINCT substr(t.date,1,7) AS month, t.currency FROM transactions t
       LEFT JOIN fx_rates f ON f.month = substr(t.date,1,7) AND f.currency = t.currency
       WHERE t.currency != ? AND f.month IS NULL
       UNION
       SELECT DISTINCT o.month, a.display_currency FROM balance_observations o
       JOIN accounts a ON a.id = o.account_id
       LEFT JOIN fx_rates f ON f.month = o.month AND f.currency = a.display_currency
       WHERE a.display_currency != ? AND f.month IS NULL`;
  let rows = db.prepare(ratePairs).all(base, base);
  // Cap the work per call: years of foreign-currency data would otherwise
  // hang the request for minutes and hammer frankfurter.dev. The response
  // reports what remains so the client can offer another round.
  const MAX_PER_CALL = 60;
  const remaining = Math.max(0, rows.length - MAX_PER_CALL);
  if (rows.length > MAX_PER_CALL) rows = rows.slice(0, MAX_PER_CALL);

  const lastDay = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  };

  let filled = 0;
  const failed = [];
  const upsert = db.prepare(
    `INSERT INTO fx_rates (month, currency, rate, source) VALUES (?, ?, ?, 'ecb')
     ON CONFLICT(month, currency) DO UPDATE SET rate = excluded.rate, source = 'ecb', updated_at = datetime('now')`,
  );
  for (const row of rows) {
    try {
      const url = `https://api.frankfurter.dev/v1/${lastDay(row.month)}?from=${encodeURIComponent(row.currency)}&to=${encodeURIComponent(base)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const rate = data?.rates?.[base];
      if (!Number.isFinite(rate))
        throw new Error(`no ${base} rate for ${row.currency} in response`);
      upsert.run(row.month, row.currency, rate);
      filled++;
    } catch (e) {
      failed.push({ month: row.month, currency: row.currency, error: e.message });
    }
  }
  res.json({ ok: failed.length === 0, filled, attempted: rows.length, remaining, failed });
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
    `attachment; filename="budget-backup-${new Date().toISOString().slice(0, 10)}.db"`,
  );
  fs.createReadStream(row.file).pipe(res);
});

// Danger zone: delete all spending data, keep budgets/rules/funds/income.
router.delete('/spending', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  const files = db.prepare('SELECT filename FROM attachments').all();
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
  // Unlink only after the delete committed: if it had rolled back, the
  // attachment rows would survive pointing at missing files.
  if (files.length) {
    const dir = path.join(DATA_DIR, 'uploads', safeDbFilename(req.username));
    for (const f of files) {
      const resolved = path.resolve(dir, f.filename);
      if (resolved.startsWith(path.resolve(dir) + path.sep)) {
        try {
          fs.unlinkSync(resolved);
        } catch {}
      }
    }
  }
  res.json({ ok: true, deleted: n });
});

// Restore a previously downloaded backup (.db). Validates the file, keeps a
// timestamped copy of the current database as <name>.db.pre-restore-<ts>, then
// swaps it in via an atomic rename. On reopen failure the previous database is
// restored, so a failed copy can never leave the live database truncated.
let restoreBusy = false;
router.post('/restore', restoreUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (restoreBusy) return res.status(409).json({ error: 'A restore is already in progress' });

  const dataDir = DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = path.join(
    dataDir,
    `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  fs.writeFileSync(tmp, req.file.buffer);

  let check;
  try {
    check = new DatabaseSync(tmp, { readOnly: true });
    const tables = new Set(
      check
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length)
      throw new Error(`Not a valid budget backup — missing: ${missing.join(', ')}`);
    const integrity = check.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok')
      throw new Error('Backup failed the SQLite integrity check — refusing to restore');
    const fkViolations = check.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length)
      throw new Error(
        `Backup has ${fkViolations.length} broken reference(s) — refusing to restore`,
      );
    const txCount = check.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
    const catCount = check.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
    check.close();
    check = null;

    // Drain in-flight API requests before touching the live database file:
    // a request holding the old handle could otherwise write to the detached
    // inode after the rename (silently lost data) or crash on the closed
    // handle. New requests queue until the swap is done.
    restoreBusy = true;
    await pauseRequests();
    try {
      const username = req.username;
      const safe = safeDbFilename(username);
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
        try {
          fs.unlinkSync(target + suffix);
        } catch {}
      }

      // Atomic swap on the same filesystem.
      fs.renameSync(staged, target);
      try {
        fs.unlinkSync(tmp);
      } catch {}

      try {
        getUserDb(username); // reopen + cache
      } catch {
        // Roll back using renames so a failed restore never leaves a partial
        // database or a target WAL sidecar in place.
        const failed = `${target}.failed-restore-${stamp}`;
        try {
          fs.renameSync(target, failed);
        } catch {}
        fs.renameSync(pre, target);
        try {
          getUserDb(username);
        } catch {}
        try {
          fs.unlinkSync(failed);
        } catch {}
        throw new Error(
          'Restore failed while reopening the database — previous data was rolled back',
        );
      }
    } finally {
      resumeRequests();
      restoreBusy = false;
    }
    res.json({ ok: true, transactions: txCount, categories: catCount });
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    try {
      fs.unlinkSync(tmp + '.staged');
    } catch {}
    try {
      check?.close();
    } catch {}
    restoreBusy = false;
    res.status(e.status || 400).json({ error: e.message });
  }
});

// List models available to the given (or saved) key.
router.post('/models', async (req, res) => {
  try {
    const { provider, api_key, base_url } = req.body ?? {};
    const active = getAiConfig(req.username);
    const selectedProvider = provider || active.provider || 'openai';
    const url = baseUrlFor(
      selectedProvider,
      base_url ?? (!provider || provider === active.provider ? active.baseUrl : undefined),
    );
    const key = api_key || (!provider || provider === active.provider ? active.apiKey : '') || '';
    const needsKey = !PROVIDERS[selectedProvider].no_key;
    if (needsKey && !key) return res.status(400).json({ error: 'Enter your API key first' });

    const r = await fetch(`${url}/models`, {
      headers: needsKey ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      // Custom base URLs can point at internal services — their response
      // bodies are never echoed back (SSRF read primitive).
      const detail = isTrustedBaseUrl(url) && text ? `: ${text.slice(0, 200)}` : '';
      return res.status(502).json({ error: `Could not list models (${r.status})${detail}` });
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

router.post('/test', async (req, res) => {
  try {
    const cfg = getAiConfig(req.username);
    const msg = await chatComplete(cfg, [{ role: 'user', content: 'Reply with exactly: OK' }]);
    res.json({ ok: true, reply: (msg.content || '').slice(0, 100) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
