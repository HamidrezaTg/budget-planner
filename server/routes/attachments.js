import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { als, DATA_DIR, safeDbFilename } from '../db.js';

const router = Router();

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'text/csv': '.csv',
};

// The browser-declared mimetype is trivially spoofable; verify the file
// actually starts with the expected magic bytes before storing it. CSV has
// no signature — accept any non-binary-looking text.
function contentMatchesDeclared(buffer, mime) {
  const ascii = (offset, text) =>
    buffer.subarray(offset, offset + text.length).toString('latin1') === text;
  switch (mime) {
    case 'application/pdf':
      return ascii(0, '%PDF-');
    case 'image/png':
      return buffer[0] === 0x89 && ascii(1, 'PNG\r\n\x1a\n'.slice(1));
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'text/csv':
      return !buffer.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

function userUploadDir(username) {
  // same sanitization as getUserDb
  const safe = safeDbFilename(username);
  return path.join(DATA_DIR, 'uploads', safe);
}

// username arrives via auth middleware on req.username.
// Multipart handling resumes outside the AsyncLocalStorage scope, so we
// capture the user's concrete database handle up front instead of using the
// request-scoped proxy.
router.use((req, res, next) => {
  req.uploadDir = userUploadDir(req.username);
  req.attDb = als.getStore();
  if (!req.attDb) return res.status(500).json({ error: 'No user database context' });
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1 },
});

function attachmentPath(uploadDir, storedName) {
  const resolved = path.resolve(uploadDir, storedName);
  if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) return null;
  return resolved;
}

function findAttachment(attDb, id) {
  return attDb.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
}

// List attachments for one transaction
router.get('/', (req, res) => {
  const txId = Number(req.query.transaction_id);
  if (!txId || !req.attDb.prepare('SELECT id FROM transactions WHERE id = ?').get(txId))
    return res.status(400).json({ error: 'Valid transaction_id required' });
  res.json({
    attachments: req.attDb
      .prepare(
        'SELECT id, original_name, mime, size, created_at FROM attachments WHERE transaction_id = ? ORDER BY id',
      )
      .all(txId),
  });
});

router.post('/', upload.single('file'), (req, res) => {
  const txId = Number(req.body?.transaction_id ?? req.body?.transactionId);
  if (!txId || !req.attDb.prepare('SELECT id FROM transactions WHERE id = ?').get(txId))
    return res.status(400).json({ error: 'Valid transaction_id required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (req.file.size === 0) return res.status(400).json({ error: 'Empty file' });

  const ext = ALLOWED[req.file.mimetype];
  if (!ext)
    return res.status(400).json({
      error: `Unsupported file type (${req.file.mimetype}). Allowed: PDF, PNG, JPEG, WebP, CSV`,
    });
  if (!contentMatchesDeclared(req.file.buffer, req.file.mimetype))
    return res
      .status(400)
      .json({ error: `File content does not look like a ${req.file.mimetype}` });

  const original = String(req.file.originalname ?? 'file').slice(0, 200);
  const storedName = `${txId}-${crypto.randomUUID()}${ext}`;
  fs.mkdirSync(req.uploadDir, { recursive: true });
  const target = attachmentPath(req.uploadDir, storedName);
  if (!target) return res.status(500).json({ error: 'Invalid storage path' });

  try {
    fs.writeFileSync(target, req.file.buffer);
  } catch {
    return res.status(500).json({ error: 'Could not store file' });
  }

  const r = req.attDb
    .prepare(
      'INSERT INTO attachments (transaction_id, filename, original_name, mime, size) VALUES (?, ?, ?, ?, ?)',
    )
    .run(txId, storedName, original, req.file.mimetype, req.file.size);

  const row = findAttachment(req.attDb, r.lastInsertRowid);
  res.json({
    id: row.id,
    original_name: row.original_name,
    mime: row.mime,
    size: row.size,
    created_at: row.created_at,
  });
});

// Download (or preview inline with ?inline=1)
router.get('/:id/file', (req, res) => {
  const row = findAttachment(req.attDb, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const file = attachmentPath(req.uploadDir, row.filename);
  if (!file || !fs.existsSync(file))
    return res.status(404).json({ error: 'File missing from disk' });

  const inline = req.query.inline === '1';
  res.setHeader(
    'Content-Type',
    inline && row.mime.startsWith('image/') ? row.mime : 'application/octet-stream',
  );
  const safeName = row.original_name.replace(/[\r\n"\\]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
  );
  res.sendFile(file);
});

router.delete('/:id', (req, res) => {
  const row = findAttachment(req.attDb, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const file = attachmentPath(req.uploadDir, row.filename);
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
  req.attDb.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// map multer errors to clean client responses
router.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File exceeds the 10 MB limit' });
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
});

export default router;
