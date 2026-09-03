import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { als, DATA_DIR } from '../db.js';
import {
  parseStatement,
  rawGrid,
  rowsFromExtractedText,
  transactionsFromGrid,
  csvPreflight,
  csvHeaderSignature,
  detectFileFormat,
  extractImageRows,
} from '../services/parser.js';
import { applyCategorization } from '../services/categorizer.js';
import { getAiConfig, chatComplete, parseJsonLoose } from '../services/ai.js';
import { onlineOcr } from '../services/online-ocr.js';
import { annotateWithTransferPairs } from '../services/transfer-detect.js';

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
  staged.set(token, { path: file.path, username, originalName: file.originalname });
  // Evict the oldest entry when the global cap is hit — but prefer evicting
  // the SAME user's oldest upload first: evicting another user's in-progress
  // import mid-flow would delete their staged file out from under them.
  while (staged.size > 20) {
    let oldest = null;
    for (const k of staged.keys()) {
      if (staged.get(k).username === username) {
        oldest = k;
        break;
      }
    }
    if (oldest === null) oldest = staged.keys().next().value;
    const entry = staged.get(oldest);
    try {
      fs.unlinkSync(entry.path);
    } catch {}
    staged.delete(oldest);
  }
  return token;
}

function removeStagedFile(token) {
  const entry = staged.get(token);
  if (entry) {
    try {
      fs.unlinkSync(entry.path);
    } catch {}
    staged.delete(token);
  }
}

function getOwnedStage(req, token) {
  const entry = staged.get(token);
  if (!entry || entry.username !== req.username) return null;
  return entry;
}

function templateFromRow(row) {
  if (!row) return null;
  try {
    return {
      id: row.id,
      name: row.name,
      format: row.format,
      headers: JSON.parse(row.headers),
      spec: JSON.parse(row.spec),
      updated_at: row.updated_at,
      use_count: row.use_count,
    };
  } catch {
    return null;
  }
}

function templateSignature(format, grid, headerRow) {
  const signature = csvHeaderSignature(grid, headerRow);
  // Existing CSV templates use the unprefixed signature. Namespace new XLSX
  // signatures so identical CSV and XLSX headers can coexist in old databases.
  return format === 'xlsx' ? `xlsx:${signature}` : signature;
}

function findImportTemplate(conn, format, grid) {
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const signature = templateSignature(format, grid, i);
    if (!signature) continue;
    const row = conn
      .prepare('SELECT * FROM import_templates WHERE format = ? AND header_signature = ?')
      .get(format, signature);
    const template = templateFromRow(row);
    if (template) return { ...template, header_row_index: i, signature };
  }
  return null;
}

function touchImportTemplate(conn, id) {
  conn
    .prepare(
      `UPDATE import_templates
       SET updated_at = datetime('now'), use_count = use_count + 1
       WHERE id = ?`,
    )
    .run(id);
}

function saveImportTemplate(conn, { name, format, headers, signature, spec }) {
  if (!signature || !spec) return null;
  const cleanName =
    String(name || 'CSV statement')
      .trim()
      .slice(0, 160) || 'CSV statement';
  const result = conn
    .prepare(
      `INSERT INTO import_templates (name, format, header_signature, headers, spec)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(header_signature) DO UPDATE SET
         name = excluded.name,
         headers = excluded.headers,
         spec = excluded.spec,
         updated_at = datetime('now')`,
    )
    .run(cleanName, format, signature, JSON.stringify(headers || []), JSON.stringify(spec));
  const id =
    result.lastInsertRowid ||
    conn.prepare('SELECT id FROM import_templates WHERE header_signature = ?').get(signature)?.id;
  return id ? conn.prepare('SELECT * FROM import_templates WHERE id = ?').get(id) : null;
}

function validTemplateParse(parsed) {
  const validRows = parsed.stats.imported + parsed.stats.skippedCancelled;
  return validRows > 0 && parsed.stats.invalid / Math.max(parsed.stats.total, 1) <= 0.1;
}

function csvCheckResponse(preflight, status, extra = {}) {
  return {
    status,
    format: 'csv',
    can_import_directly: status === 'ready' || status === 'template',
    headers: preflight.headers,
    sample_rows: preflight.sample_rows,
    issues: preflight.issues,
    ...extra,
  };
}

const AI_IMPORT_PROMPT =
  'You map bank statement rows to a normalized transaction schema. Respond with ONLY a JSON object:\n' +
  '{"header_row_index": <row number of the header, or -1 if none>, ' +
  '"col_date": <column index>, "col_description": <column index>, "col_payee": <index or null>, ' +
  '"col_amount": <index or null if separate in/out columns>, ' +
  '"col_in": <index or null>, "col_out": <index or null>, ' +
  '"col_state": <index or null>, "ignore_states": ["reverted", ...], ' +
  '"col_type": <index or null>, "col_currency": <index or null>, ' +
  '"date_format": "YYYY-MM-DD" | "DD.MM.YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY" | "excel_serial" | "auto", ' +
  '"decimal_point": "." | ",", "notes": "<one sentence>", ' +
  '"direct_import_instruction": "<one sentence explaining when this mapping is safe>"}\n' +
  'Column indexes are zero-based positions in each row array. Expenses must be negative. ' +
  'If spending and income are separate, use col_out for spending and col_in for income. ' +
  'Do not invent columns or values. Use the exact row structure shown.';

function validateAiSpec(spec, grid) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec))
    throw new Error('AI returned an invalid import mapping');
  const headerRow = Number(spec.header_row_index ?? 0);
  if (!Number.isInteger(headerRow) || headerRow < -1 || headerRow >= grid.length)
    throw new Error('AI returned an invalid header row');
  const firstRowWidth = Math.max(...grid.slice(0, 25).map((row) => row.length), 0);
  const columns = [
    'col_date',
    'col_description',
    'col_payee',
    'col_amount',
    'col_in',
    'col_out',
    'col_state',
    'col_type',
    'col_currency',
  ];
  for (const key of columns) {
    if (spec[key] == null || spec[key] === '') continue;
    if (
      !Number.isInteger(Number(spec[key])) ||
      Number(spec[key]) < 0 ||
      Number(spec[key]) >= firstRowWidth
    )
      throw new Error(`AI returned an invalid ${key} column`);
  }
  if (spec.col_date == null || spec.col_description == null)
    throw new Error('AI mapping must include date and description columns');
  if (spec.col_amount == null && spec.col_in == null && spec.col_out == null)
    throw new Error('AI mapping must include an amount or debit/credit column');
  if (
    spec.date_format != null &&
    !['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'excel_serial', 'auto'].includes(
      String(spec.date_format),
    )
  )
    throw new Error('AI returned an invalid date format');
  if (spec.decimal_point != null && !['.', ','].includes(String(spec.decimal_point)))
    throw new Error('AI returned an invalid decimal format');
  return {
    ...spec,
    header_row_index: headerRow,
    // Import policy is deliberately narrow: only explicitly cancelled rows
    // are excluded. Refunded and reverted rows remain financial history.
    ignore_states: ['cancelled', 'canceled'],
    notes: String(spec.notes || '').slice(0, 500),
    direct_import_instruction: String(
      spec.direct_import_instruction ||
        'Future files with the same columns can use this saved mapping without AI.',
    ).slice(0, 500),
  };
}

async function aiMapGrid(cfg, grid) {
  const msg = await chatComplete(cfg, [
    { role: 'system', content: AI_IMPORT_PROMPT },
    {
      role: 'user',
      content:
        'Here are the first rows of the statement as JSON arrays:\n' +
        JSON.stringify(grid.slice(0, 25)),
    },
  ]);
  const spec = validateAiSpec(parseJsonLoose(msg.content), grid);
  const parsed = transactionsFromGrid(grid, spec);
  const validRows = parsed.stats.imported + parsed.stats.skippedCancelled;
  if (!validRows) throw new Error('AI mapping produced no valid transaction rows');
  if (parsed.stats.invalid / Math.max(parsed.stats.total, 1) > 0.1)
    throw new Error(
      `AI mapping could not validate the full file: ${parsed.stats.invalid} of ${parsed.stats.total} rows were invalid`,
    );
  return { spec, parsed };
}

async function gridForFile(filePath, online, cfg) {
  if (online) {
    const extractedText = await onlineOcr(filePath, cfg);
    return [['Date', 'Description', 'Amount', 'Currency'], ...rowsFromExtractedText(extractedText)];
  }
  const format = detectFileFormat(filePath);
  if (format === 'png' || format === 'jpeg') {
    const extracted = extractImageRows(filePath);
    const grid = [['Date', 'Description', 'Amount', 'Currency'], ...extracted.rows];
    Object.defineProperty(grid, '__extraction', { value: extracted.diagnostics });
    return grid;
  }
  return rawGrid(filePath, 1_000_000);
}

function stageStructuredFile(file, username, grid, spec) {
  const token = stageFile(file, username);
  const entry = staged.get(token);
  entry.spec = spec;
  entry.grid = grid;
  return token;
}

function directImportResponse(token, parsed, conn, accountId, extra = {}) {
  const { preview, summary } = previewParsed(parsed, conn, accountId);
  return {
    token,
    stats: parsed.stats,
    errors: parsed.errors ?? [],
    summary,
    preview,
    ...extra,
  };
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
try {
  sweepStaleUploads();
} catch {}

function previewParsed(parsed, conn, accountId = null) {
  let withCats = applyCategorization(parsed.transactions);
  withCats = annotateWithTransferPairs(withCats, accountId);
  const existing = new Set(
    conn
      .prepare('SELECT dedup_key FROM transactions')
      .all()
      .map((r) => r.dedup_key),
  );
  const preview = withCats.map((tx) => ({ ...tx, duplicate: existing.has(tx.dedup_key) }));
  const dupCount = preview.filter((p) => p.duplicate).length;
  const transferPairs = preview
    .filter((p) => p.transfer_pair_id)
    .map((p) => ({
      id: p.transfer_pair_id,
      amount: Math.abs(p.amount),
      date: p.date,
      description: p.description,
      account_a: p.account_id,
      account_b: preview[p.transfer_pair_other]?.account_id ?? null,
      confidence: p.transfer_pair_confidence,
    }));
  // De-duplicate pairs (each pair is represented twice — once per row).
  const seenPair = new Set();
  const uniquePairs = transferPairs.filter((p) => {
    const k = `${p.id}`;
    if (seenPair.has(k)) return false;
    seenPair.add(k);
    return true;
  });
  return {
    preview,
    summary: {
      toImport: preview.length - dupCount,
      duplicates: dupCount,
      needsReview: preview.filter((p) => p.needs_review && !p.duplicate).length,
      income: preview.filter((p) => !p.duplicate && p.amount > 0).length,
      expenses: preview.filter((p) => !p.duplicate && p.amount < 0).length,
      zero: preview.filter((p) => !p.duplicate && p.amount === 0).length,
      transferPairs: uniquePairs.length,
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

router.post(
  '/upload',
  upload.single('file'),
  withCtx(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const format = detectFileFormat(req.file.path);
      const online = req.body?.ocr_mode === 'online';
      const templateMode = req.body?.template_mode === 'fresh' ? 'fresh' : 'reuse';
      if (format === 'csv') {
        const preflight = csvPreflight(req.file.path);
        const template =
          templateMode === 'reuse' ? findImportTemplate(req.impDb, 'csv', preflight.grid) : null;
        if (template) {
          const grid = rawGrid(req.file.path, 1_000_000);
          // Header position belongs to this file, not to the reusable mapping.
          // Older templates may contain a stale position from their original export.
          const templateSpec = { ...template.spec, header_row_index: template.header_row_index };
          const parsed = transactionsFromGrid(grid, templateSpec);
          if (!validTemplateParse(parsed)) {
            // Do not trust a template that fails against the complete file.
          } else {
            touchImportTemplate(req.impDb, template.id);
            const token = stageStructuredFile(req.file, req.username, grid, templateSpec);
            return res.json(
              directImportResponse(token, parsed, req.impDb, null, {
                csv_check: csvCheckResponse(preflight, 'template', {
                  template: {
                    id: template.id,
                    name: template.name,
                    use_count: template.use_count + 1,
                  },
                  instruction: `This CSV matches the saved "${template.name}" template and was imported directly without AI analysis.`,
                }),
                ai_spec: null,
                template_used: true,
                template_mode: templateMode,
              }),
            );
          }
        }
        if (!preflight.can_import_directly) {
          const token = stageFile(req.file, req.username);
          staged.get(token).grid = rawGrid(req.file.path, 1_000_000);
          staged.get(token).requires_ai = true;
          staged.get(token).template_mode = templateMode;
          return res.json({
            token,
            file_type: 'csv',
            stats: preflight.stats,
            errors: [],
            summary: null,
            preview: [],
            csv_check: csvCheckResponse(preflight, 'needs_ai', {
              instruction:
                templateMode === 'fresh'
                  ? 'Fresh mode is active, so saved templates are being ignored. AI analysis is recommended because the preflight checks did not pass.'
                  : 'AI analysis is recommended before importing this CSV because the preflight checks did not pass.',
              template_mode: templateMode,
            }),
            ai_spec: null,
            template_mode: templateMode,
          });
        }
        const grid = rawGrid(req.file.path, 1_000_000);
        const parsed = transactionsFromGrid(grid, preflight.spec);
        const token = stageStructuredFile(req.file, req.username, grid, preflight.spec);
        return res.json(
          directImportResponse(token, parsed, req.impDb, null, {
            csv_check: csvCheckResponse(preflight, 'ready', {
              instruction:
                'This CSV passed the preflight checks and is ready to import directly without AI analysis.',
            }),
            ai_spec: null,
            template_mode: templateMode,
          }),
        );
      }

      if (format === 'xlsx') {
        const grid = rawGrid(req.file.path, 1_000_000);
        const template =
          templateMode === 'reuse' ? findImportTemplate(req.impDb, 'xlsx', grid) : null;
        if (template) {
          const templateSpec = { ...template.spec, header_row_index: template.header_row_index };
          const parsed = transactionsFromGrid(grid, templateSpec);
          if (validTemplateParse(parsed)) {
            touchImportTemplate(req.impDb, template.id);
            const token = stageStructuredFile(req.file, req.username, grid, templateSpec);
            return res.json(
              directImportResponse(token, parsed, req.impDb, null, {
                file_type: 'xlsx',
                template_check: {
                  status: 'template',
                  format: 'xlsx',
                  can_import_directly: true,
                  template: {
                    id: template.id,
                    name: template.name,
                    use_count: template.use_count + 1,
                  },
                  instruction: `This Excel file matches the saved "${template.name}" template and was imported directly without AI analysis.`,
                },
                ai_spec: null,
                template_used: true,
                template_mode: templateMode,
              }),
            );
          }
        }

        const parsed = parseStatement(req.file.path);
        const token = stageFile(req.file, req.username);
        return res.json(
          directImportResponse(token, parsed, req.impDb, null, {
            file_type: 'xlsx',
            template_mode: templateMode,
            ai_spec: null,
          }),
        );
      }

      if (format === 'pdf' || format === 'png' || format === 'jpeg') {
        const cfg = getAiConfig(req.username);
        const grid = await gridForFile(req.file.path, online, cfg);
        const { spec, parsed } = await aiMapGrid(cfg, grid);
        const token = stageStructuredFile(req.file, req.username, grid, spec);
        auditImport(
          req.impDb,
          `${online ? 'Online OCR and ' : 'OCR and '}AI structuring via ${cfg.model}: ${spec.notes}`,
        );
        return res.json(
          directImportResponse(token, parsed, req.impDb, null, {
            file_type: format,
            ai_spec: spec,
            ai_instruction:
              'OCR text was structured by AI and validated before it was shown for import.',
            extraction: grid.__extraction,
            ocr_structured_by_ai: true,
          }),
        );
      }

      const parsed = parseStatement(req.file.path);
      const token = stageFile(req.file, req.username);
      res.json(directImportResponse(token, parsed, req.impDb, null, { ai_spec: null }));
    } catch (e) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
      res.status(400).json({
        error: `${e.message}${/csv|column|mapping|OCR|AI/i.test(e.message) ? ' — try “Analyze format with AI”.' : ''}`,
        suggest_ai: true,
      });
    }
  }),
);

// AI format doctor: inspects the raw file and proposes a column mapping.
router.post(
  '/smart',
  upload.single('file'),
  withCtx(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const cfg = getAiConfig(req.username);
      const format = detectFileFormat(req.file.path);
      const online = req.body?.ocr_mode === 'online';
      const grid = await gridForFile(req.file.path, online, cfg);
      if (!grid.length) return res.status(400).json({ error: 'File appears to be empty' });
      const { spec, parsed } = await aiMapGrid(cfg, grid);
      const token = stageStructuredFile(req.file, req.username, grid, spec);
      let template = null;
      if ((format === 'csv' || format === 'xlsx') && spec.header_row_index >= 0) {
        template = saveImportTemplate(req.impDb, {
          name: req.file.originalname,
          format,
          headers: grid[spec.header_row_index],
          signature: templateSignature(format, grid, spec.header_row_index),
          spec,
        });
      }

      const { preview, summary } = previewParsed(parsed, req.impDb, null);
      auditImport(
        req.impDb,
        `${online ? 'Online OCR and ' : format === 'csv' ? '' : 'OCR and '}AI structuring via ${cfg.model}: ${spec.notes ?? ''}`,
      );
      res.json({
        token,
        stats: parsed.stats,
        summary,
        preview,
        ai_spec: spec,
        extraction: grid.__extraction,
        template_mode: 'fresh',
        model: cfg.model,
        ai_instruction:
          format === 'csv' || format === 'xlsx'
            ? `Template "${template?.name || req.file.originalname}" was saved. Future ${format === 'xlsx' ? 'Excel' : 'CSV'} files with the same columns can be imported directly without AI analysis.`
            : 'The OCR text was structured by AI and validated before it was shown for import.',
        csv_check:
          format === 'csv'
            ? {
                status: 'analyzed',
                can_import_directly: true,
                headers: grid[spec.header_row_index] || [],
                template_saved: !!template,
                template_mode: 'fresh',
                instruction: `Future CSV files with the same columns can be imported directly without AI analysis.`,
              }
            : undefined,
        template_check:
          format === 'xlsx'
            ? {
                status: 'analyzed',
                format: 'xlsx',
                can_import_directly: true,
                headers: grid[spec.header_row_index] || [],
                template_saved: !!template,
                template_mode: 'fresh',
                instruction:
                  'Future Excel files with the same columns can be imported directly without AI analysis.',
              }
            : undefined,
        ocr_structured_by_ai: format === 'pdf' || format === 'png' || format === 'jpeg',
      });
    } catch (e) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
      res.status(e.status || 500).json({ error: e.message });
    }
  }),
);

// Analyze a CSV that failed preflight without requiring the user to upload it again.
router.post(
  '/analyze',
  withCtx(async (req, res) => {
    const stagedEntry = getOwnedStage(req, req.body?.token);
    if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
    try {
      const cfg = getAiConfig(req.username);
      const grid = stagedEntry.grid || rawGrid(stagedEntry.path, 1_000_000);
      const { spec, parsed } = await aiMapGrid(cfg, grid);
      stagedEntry.spec = spec;
      stagedEntry.requires_ai = false;
      let template = null;
      if (spec.header_row_index >= 0) {
        template = saveImportTemplate(req.impDb, {
          name: stagedEntry.originalName,
          format: 'csv',
          headers: grid[spec.header_row_index],
          signature: templateSignature('csv', grid, spec.header_row_index),
          spec,
        });
      }
      const { preview, summary } = previewParsed(parsed, req.impDb, null);
      auditImport(req.impDb, `AI CSV template via ${cfg.model}: ${spec.notes ?? ''}`);
      res.json({
        token: req.body.token,
        stats: parsed.stats,
        errors: parsed.errors ?? [],
        summary,
        preview,
        ai_spec: spec,
        template_mode: stagedEntry.template_mode || 'fresh',
        model: cfg.model,
        ai_instruction: `Template "${template?.name || 'CSV statement'}" was saved. Future CSV files with the same columns can be imported directly without AI analysis.`,
        csv_check: {
          status: 'analyzed',
          can_import_directly: true,
          headers: grid[spec.header_row_index] || [],
          template_saved: !!template,
          template_mode: stagedEntry.template_mode || 'fresh',
          instruction: 'This AI-approved mapping is now saved for matching CSV files.',
        },
      });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  }),
);

router.get(
  '/templates',
  withCtx((req, res) => {
    const templates = req.impDb
      .prepare(
        `SELECT id, name, format, headers, created_at, updated_at, use_count
         FROM import_templates ORDER BY updated_at DESC, id DESC`,
      )
      .all()
      .map((row) => ({ ...row, headers: JSON.parse(row.headers) }));
    res.json({ templates });
  }),
);

router.patch(
  '/templates/:id',
  withCtx((req, res) => {
    const name = String(req.body?.name ?? '')
      .trim()
      .slice(0, 160);
    if (!name) return res.status(400).json({ error: 'Template name is required' });
    const result = req.impDb
      .prepare('UPDATE import_templates SET name = ? WHERE id = ?')
      .run(name, Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Import template not found' });
    const row = req.impDb
      .prepare(
        `SELECT id, name, format, headers, created_at, updated_at, use_count
         FROM import_templates WHERE id = ?`,
      )
      .get(Number(req.params.id));
    res.json({ ...row, headers: JSON.parse(row.headers) });
  }),
);

router.delete(
  '/templates/:id',
  withCtx((req, res) => {
    const result = req.impDb
      .prepare('DELETE FROM import_templates WHERE id = ?')
      .run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Import template not found' });
    res.status(204).end();
  }),
);

// Recompute the preview for a staged file with a chosen account. Import
// categorization depends on the account (account-scoped automation rules), so
// the preview is refreshed whenever the user picks a different account.
router.post(
  '/preview',
  withCtx((req, res) => {
    const { token, account_id = null } = req.body ?? {};
    const stagedEntry = getOwnedStage(req, token);
    if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
    if (stagedEntry.requires_ai)
      return res
        .status(400)
        .json({ error: 'This CSV must be analyzed by AI before previewing it' });
    const accId = resolveAccountId(req.impDb, account_id);
    if (account_id && accId === null)
      return res.status(400).json({ error: 'Unknown account — please pick a valid account' });
    try {
      const parsed = stagedEntry.spec
        ? transactionsFromGrid(
            stagedEntry.grid || rawGrid(stagedEntry.path, 1000000),
            stagedEntry.spec,
          )
        : parseStatement(stagedEntry.path);
      parsed.transactions.forEach((t) => {
        t.account_id = accId;
      });
      const { preview, summary } = previewParsed(parsed, req.impDb, accId);
      res.json({ token, stats: parsed.stats, errors: parsed.errors ?? [], summary, preview });
    } catch (e) {
      res.status(400).json({ error: e.message, suggest_ai: true });
    }
  }),
);

function auditImport(conn, detail) {
  conn
    .prepare('INSERT INTO ai_audit_log (kind, detail) VALUES (?, ?)')
    .run('import_fix', String(detail).slice(0, 2000));
}

router.post(
  '/confirm',
  withCtx((req, res) => {
    const { token, account_id = null, transfer_pairs = [] } = req.body ?? {};
    const stagedEntry = getOwnedStage(req, token);
    if (!stagedEntry) return res.status(400).json({ error: 'Unknown or expired import token' });
    if (stagedEntry.requires_ai)
      return res.status(400).json({ error: 'This CSV must be analyzed by AI before importing it' });
    const accId = resolveAccountId(req.impDb, account_id);
    if (account_id && accId === null)
      return res.status(400).json({ error: 'Unknown account — please pick a valid account' });
    const filePath = stagedEntry.path;
    try {
      const parsed = stagedEntry.spec
        ? transactionsFromGrid(stagedEntry.grid || rawGrid(filePath, 1000000), stagedEntry.spec)
        : parseStatement(filePath);
      // Account-aware categorization: assign the chosen account BEFORE rules run,
      // so account-scoped automation rules actually match on import.
      parsed.transactions.forEach((t) => {
        t.account_id = accId;
      });
      const withCats = applyCategorization(parsed.transactions);

      // Look up active recurrences so an imported row that matches a not-yet-
      // posted recurrence can be folded into it. The user pays attention to one
      // statement entry; the recurrence is the same expected transaction; the
      // books should count it once.
      const recurrences = req.impDb
        .prepare(
          `SELECT id, name, amount, account_id, last_posted_month FROM recurrences WHERE active = 1`,
        )
        .all();
      const matchedRecurrenceByIndex = new Array(withCats.length).fill(null);
      function findRecurrenceMatch(tx) {
        const desc = String(tx.description).toLowerCase().replace(/\s+/g, ' ').trim();
        const txMonth = tx.date.slice(0, 7);
        for (const r of recurrences) {
          if (Number(r.amount) !== Number(tx.amount)) continue;
          if (r.account_id != null && tx.account_id != null && r.account_id !== tx.account_id)
            continue;
          if (r.account_id != null && tx.account_id == null) continue;
          if (r.account_id == null && tx.account_id != null) continue;
          const rname = String(r.name).toLowerCase().replace(/\s+/g, ' ').trim();
          if (rname !== desc) continue;
          if (r.last_posted_month && r.last_posted_month >= txMonth) continue;
          return r;
        }
        return null;
      }

      // Pre-compute the desired dedup_key for each row: the original import
      // fingerprint, OR a `rec|<id>|<month>` token if this row matches a
      // recurrence, OR a `xfer|<pair_id>` token if the user confirmed this
      // transfer. The ON CONFLICT below then folds everything together.
      const confirmedPairs = new Set(Array.isArray(transfer_pairs) ? transfer_pairs : []);
      const finalDedupKeys = withCats.map((tx, i) => {
        const rec = findRecurrenceMatch(tx);
        matchedRecurrenceByIndex[i] = rec;
        if (rec) return `rec|${rec.id}|${tx.date.slice(0, 7)}`;
        if (tx.transfer_pair_id && confirmedPairs.has(tx.transfer_pair_id))
          return `xfer|${tx.transfer_pair_id}`;
        return tx.dedup_key;
      });

      const ins = req.impDb.prepare(`
      INSERT INTO transactions (date, description, amount, tx_type, currency, account_id, category_id, needs_review, source_file, dedup_key, transfer_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedup_key) DO NOTHING`);
      // One transaction for the whole file: row-by-row autocommit means a WAL
      // fsync per row (minutes on large statements) and a partially imported
      // file if the request dies halfway.
      req.impDb.exec('BEGIN');
      let inserted = 0;
      try {
        for (let i = 0; i < withCats.length; i++) {
          const tx = withCats[i];
          const dedupKey = finalDedupKeys[i];
          const isTransfer = tx.transfer_pair_id && confirmedPairs.has(tx.transfer_pair_id);
          const transferGroup = isTransfer ? tx.transfer_pair_id : null;
          const r = ins.run(
            tx.date,
            tx.description,
            tx.amount,
            tx.revolut_type,
            tx.currency,
            accId,
            isTransfer ? null : tx.suggested_category_id,
            isTransfer ? 0 : tx.needs_review,
            path.basename(filePath),
            dedupKey,
            transferGroup,
          );
          inserted += r.changes;
        }
        // Advance last_posted_month on every matched recurrence to the latest
        // month in this file, so the dashboard "Coming up" panel doesn't show
        // the same item twice.
        const advance = req.impDb.prepare(
          `UPDATE recurrences
         SET last_posted_month = CASE
           WHEN last_posted_month IS NULL OR ? > last_posted_month THEN ?
           ELSE last_posted_month END
         WHERE id = ?`,
        );
        for (let i = 0; i < matchedRecurrenceByIndex.length; i++) {
          const r = matchedRecurrenceByIndex[i];
          if (!r) continue;
          advance.run(withCats[i].date.slice(0, 7), withCats[i].date.slice(0, 7), r.id);
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
      res.json({
        inserted,
        skippedDuplicates: withCats.length - inserted,
        remainingReview,
        transferPairs: withCats.filter((tx) => tx.transfer_pair_id).length / 2,
        recurrenceMatches: matchedRecurrenceByIndex.filter(Boolean).length,
        errors: parsed.errors ?? [],
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }),
);

export default router;
