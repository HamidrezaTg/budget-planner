import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { parseStatement, rawGrid, transactionsFromGrid } from '../services/parser.js';
import { applyCategorization } from '../services/categorizer.js';
import { getAiConfig, chatComplete, parseJsonLoose } from '../services/ai.js';

const router = Router();
const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(process.cwd(), 'data', 'uploads');

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const token = crypto.randomBytes(8).toString('hex');
    cb(null, `${token}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`);
  },
});
const upload = multer({ storage });

// In-memory staging: token -> { file, spec? }
const staged = new Map();

function stageFile(file) {
  const token = path.basename(file.filename).split('-')[0];
  staged.set(token, { path: file.path });
  while (staged.size > 20) staged.delete(staged.keys().next().value);
  return token;
}

function previewParsed(parsed) {
  const withCats = applyCategorization(parsed.transactions);
  const existing = new Set(
    db.prepare('SELECT dedup_key FROM transactions').all().map((r) => r.dedup_key)
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

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const parsed = parseStatement(req.file.path);
    const token = stageFile(req.file);
    const { preview, summary } = previewParsed(parsed);
    res.json({ token, stats: parsed.stats, summary, preview, ai_spec: null });
  } catch (e) {
    res.status(400).json({
      error: `${e.message} — try “Analyze format with AI”.`,
      suggest_ai: true,
    });
  }
});

// AI format doctor: inspects the raw file and proposes a column mapping.
router.post('/smart', upload.single('file'), async (req, res) => {
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
    const token = stageFile(req.file);
    staged.get(token).spec = spec;

    const { preview, summary } = previewParsed(parsed);
    auditImport(`AI format fix via ${cfg.model}: ${spec.notes ?? ''}`);
    res.json({
      token,
      stats: parsed.stats,
      summary,
      preview,
      ai_spec: spec,
      model: cfg.model,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

function auditImport(detail) {
  db.prepare('INSERT INTO ai_audit_log (kind, detail) VALUES (?, ?)').run('import_fix', String(detail).slice(0, 2000));
}

router.post('/confirm', (req, res) => {
  const { token, account_id = null } = req.body ?? {};
  const stagedEntry = staged.get(token);
  if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
  const filePath = stagedEntry.path;
  const accId =
    account_id && db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)
      ? Number(account_id)
      : db.prepare(`SELECT id FROM accounts WHERE kind = 'revolut'`).get()?.id ?? null;
  try {
    const parsed = stagedEntry.spec
      ? transactionsFromGrid(rawGrid(filePath, 1000000), stagedEntry.spec)
      : parseStatement(filePath);
    const withCats = applyCategorization(parsed.transactions);
    const ins = db.prepare(`
      INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedup_key) DO NOTHING`);
    let inserted = 0;
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
    staged.delete(token);
    const remainingReview = db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE needs_review = 1')
      .get().c;
    res.json({ inserted, skippedDuplicates: withCats.length - inserted, remainingReview });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
