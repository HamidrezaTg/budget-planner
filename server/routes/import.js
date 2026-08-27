import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, als, DATA_DIR } from '../db.js';
import { parseStatement, rawGrid, transactionsFromGrid } from '../services/parser.js';
import { applyCategorization } from '../services/categorizer.js';
import { getAiConfig, chatComplete, parseJsonLoose } from '../services/ai.js';

const router = Router();

// Multer's async streaming resumes outside the AsyncLocalStorage scope on
// current Node: capture the user's concrete database handle BEFORE multer
// runs (requireAuth context is still intact here), then re-enter it around
// each handler.
router.use((req, _res, next) => {
  req.impDb = als.getStore();
  next();
});
const withCtx = (handler) => (req, res) => als.run(req.impDb, () => handler(req, res));

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const token = crypto.randomBytes(8).toString('hex');
    cb(null, `${token}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024, files: 1 } });

// In-memory staging: token -> { path, username, spec? }
const staged = new Map();

function stageFile(file, username) {
  const token = path.basename(file.filename).split('-')[0];
  staged.set(token, { path: file.path, username });
  // Evict the oldest entry when the global cap is hit — but prefer evicting
  // the SAME user's oldest upload first: evicting another user's in-progress
  // import mid-flow would delete their staged file out from under them.
  while (staged.size > 20) {
    let oldest = null;
    for (const k of staged.keys()) {
      if (staged.get(k).username === username) { oldest = k; break; }
    }
    if (oldest === null) oldest = staged.keys().next().value;
    const entry = staged.get(oldest);
    try { fs.unlinkSync(entry.path); } catch {}
    staged.delete(oldest);
  }
  return token;
}

function removeStagedFile(token) {
  const entry = staged.get(token);
  if (entry) {
    try { fs.unlinkSync(entry.path); } catch {}
    staged.delete(token);
  }
}

function getOwnedStage(req, token) {
  const entry = staged.get(token);
  if (!entry || entry.username !== req.username) return null;
  return entry;
}

// Abandoned uploads (never confirmed) are swept on startup: files older than
// 24h that are not referenced by a live staging token are removed.
function sweepStaleUploads() {
  let live = new Set();
  for (const [, entry] of staged) live.add(entry.path);
  const maxAge = 24 * 3600 * 1000;
  fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).forEach((dirent) => {
    if (!dirent.isFile()) return;
    const full = path.join(UPLOAD_DIR, dirent.name);
    if (live.has(full)) return;
    try {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > maxAge) fs.unlinkSync(full);
    } catch {}
  });
}
try { sweepStaleUploads(); } catch {}

function previewParsed(parsed, conn) {
  const withCats = applyCategorization(parsed.transactions);
  const existing = new Set(
    conn.prepare('SELECT dedup_key FROM transactions').all().map((r) => r.dedup_key)
  );
  const preview = withCats.map((tx) => ({ ...tx, duplicate: existing.has(tx.dedup_key) }));
  const dupCount = preview.filter((p) => p.duplicate).length;
  return {
    preview,
    summary: {
      toImport: preview.length - dupCount,
      duplicates: dupCount,
      needsReview: preview.filter((p) => p.needs_review && !p.duplicate).length,
      income: preview.filter((p) => !p.duplicate && p.amount > 0).length,
      expenses: preview.filter((p) => !p.duplicate && p.amount < 0).length,
    },
  };
}

// Validate the requested import account: explicit only, never silently pick
// the first Revolut account. Returns the numeric id or null for "Unassigned".
function resolveAccountId(conn, account_id) {
  if (account_id == null || account_id === '' || account_id === 0) return null;
  const acc = conn.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(account_id));
  if (!acc) return null;
  return Number(account_id);
}

router.post('/upload', upload.single('file'), withCtx((req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const parsed = parseStatement(req.file.path);
    const token = stageFile(req.file, req.username);
    const { preview, summary } = previewParsed(parsed, req.impDb);
    res.json({ token, stats: parsed.stats, errors: parsed.errors ?? [], summary, preview, ai_spec: null });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({
      error: `${e.message} — try “Analyze format with AI”.`,
      suggest_ai: true,
    });
  }
}));

// AI format doctor: inspects the raw file and proposes a column mapping.
router.post('/smart', upload.single('file'), withCtx(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const cfg = getAiConfig();
    const grid = rawGrid(req.file.path, 25);
    if (!grid.length) return res.status(400).json({ error: 'File appears to be empty' });

    const msg = await chatComplete(cfg, [
      {
        role: 'system',
        content:
          'You map bank statement files to a normalized schema. Respond with ONLY a JSON object:\n' +
          '{"header_row_index": <row number of the header, or -1 if none>, ' +
          '"col_date": <column index>, "col_description": <column index>, ' +
          '"col_amount": <index or null if separate in/out columns>, ' +
          '"col_in": <index or null>, "col_out": <index or null>, ' +
          '"col_state": <index or null>, "ignore_states": ["reverted", ...], ' +
          '"col_type": <index or null>, "col_currency": <index or null>, ' +
          '"date_format": "YYYY-MM-DD" | "DD.MM.YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY" | "excel_serial", ' +
          '"decimal_point": "." | ",", "notes": "<one sentence about what you detected>"}\n' +
          'Column indexes are 0-based positions in each row array. ' +
          'Expenses must end up negative: if spending and income are in separate columns, use col_out for spending. ' +
          'If amounts use German format (1.234,56), set decimal_point to ",". ' +
          'If dates look like 45123.5 (Excel serial numbers), use "excel_serial". ' +
          'Rows that are cancellations/reversals: put their state column and the values to ignore in ignore_states.',
      },
      {
        role: 'user',
        content:
          'Here are the first rows of the file (JSON arrays):\n' +
          JSON.stringify(grid),
      },
    ]);

    const spec = parseJsonLoose(msg.content);
    const fullGrid = rawGrid(req.file.path, 1000000);
    const parsed = transactionsFromGrid(fullGrid, spec);
    const token = stageFile(req.file, req.username);
    staged.get(token).spec = spec;

    const { preview, summary } = previewParsed(parsed, req.impDb);
    auditImport(req.impDb, `AI format fix via ${cfg.model}: ${spec.notes ?? ''}`);
    res.json({
      token,
      stats: parsed.stats,
      summary,
      preview,
      ai_spec: spec,
      model: cfg.model,
    });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// Recompute the preview for a staged file with a chosen account. Import
// categorization depends on the account (account-scoped automation rules), so
// the preview is refreshed whenever the user picks a different account.
router.post('/preview', withCtx((req, res) => {
  const { token, account_id = null } = req.body ?? {};
  const stagedEntry = getOwnedStage(req, token);
  if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
  const accId = resolveAccountId(req.impDb, account_id);
  if (account_id && accId === null)
    return res.status(400).json({ error: 'Unknown account — please pick a valid account' });
  try {
    const parsed = stagedEntry.spec
      ? transactionsFromGrid(rawGrid(stagedEntry.path, 1000000), stagedEntry.spec)
      : parseStatement(stagedEntry.path);
    parsed.transactions.forEach((t) => { t.account_id = accId; });
    const { preview, summary } = previewParsed(parsed, req.impDb);
    res.json({ token, stats: parsed.stats, errors: parsed.errors ?? [], summary, preview });
  } catch (e) {
    res.status(400).json({ error: e.message, suggest_ai: true });
  }
}));

function auditImport(conn, detail) {
  conn.prepare('INSERT INTO ai_audit_log (kind, detail) VALUES (?, ?)').run('import_fix', String(detail).slice(0, 2000));
}

router.post('/confirm', withCtx((req, res) => {
  const { token, account_id = null } = req.body ?? {};
  const stagedEntry = getOwnedStage(req, token);
  if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
  const accId = resolveAccountId(req.impDb, account_id);
  if (account_id && accId === null)
    return res.status(400).json({ error: 'Unknown account — please pick a valid account' });
  const filePath = stagedEntry.path;
  try {
    const parsed = stagedEntry.spec
      ? transactionsFromGrid(rawGrid(filePath, 1000000), stagedEntry.spec)
      : parseStatement(filePath);
    // Account-aware categorization: assign the chosen account BEFORE rules run,
    // so account-scoped automation rules actually match on import.
    parsed.transactions.forEach((t) => { t.account_id = accId; });
    const withCats = applyCategorization(parsed.transactions);
    const ins = req.impDb.prepare(`
      INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedup_key) DO NOTHING`);
    // One transaction for the whole file: row-by-row autocommit means a WAL
    // fsync per row (minutes on large statements) and a partially imported
    // file if the request dies halfway.
    req.impDb.exec('BEGIN');
    let inserted = 0;
    try {
      for (const tx of withCats) {
        const r = ins.run(
          tx.date,
          tx.description,
          tx.amount,
          tx.revolut_type,
          tx.currency,
          accId,
          tx.suggested_category_id,
          tx.needs_review,
          path.basename(filePath),
          tx.dedup_key
        );
        inserted += r.changes;
      }
      req.impDb.exec('COMMIT');
    } catch (e) {
      req.impDb.exec('ROLLBACK');
      throw e;
    }
    removeStagedFile(token);
    const remainingReview = req.impDb
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')
      .get().c;
    res.json({ inserted, skippedDuplicates: withCats.length - inserted, remainingReview, errors: parsed.errors ?? [] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

export default router;
