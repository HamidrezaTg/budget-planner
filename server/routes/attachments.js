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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let sawHeader = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return false;
    if (crc32(buffer, offset + 4, offset + 8 + length) !== buffer.readUInt32BE(offset + 8 + length))
      return false;
    if (!sawHeader && type !== 'IHDR') return false;
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) return false;
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (!width || !height || width * height > 100_000_000) return false;
      sawHeader = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || !sawHeader) return false;
      return chunkEnd === buffer.length;
    }
    offset = chunkEnd;
  }
  return false;
}

function validJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let offset = 2;
  let sawFrame = false;
  while (offset + 1 < buffer.length) {
    if (buffer[offset++] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9) return sawFrame;
    if (marker === 0xda) {
      if (offset + 2 > buffer.length) return false;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) return false;
      // Entropy-coded data can contain arbitrary bytes. Require an EOI marker
      // after the scan header, while frame dimensions were checked below.
      return sawFrame && buffer.subarray(offset + length).includes(Buffer.from([0xff, 0xd9]));
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return false;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) return false;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height || width * height > 100_000_000) return false;
      sawFrame = true;
    }
    offset += length;
  }
  return false;
}

function validWebp(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buffer.readUInt32LE(4) !== buffer.length - 8 || buffer.toString('ascii', 8, 12) !== 'WEBP')
    return false;
  let offset = 12;
  let chunks = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset + 4);
    const padded = length + (length % 2);
    if (offset + 8 + padded > buffer.length) return false;
    if (
      chunks === 0 &&
      !['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', offset, offset + 4))
    )
      return false;
    chunks++;
    offset += 8 + padded;
  }
  return chunks > 0 && offset === buffer.length;
}

function validPdf(buffer) {
  if (!/^%PDF-[0-9]\.[0-9]/.test(buffer.subarray(0, 16).toString('ascii'))) return false;
  return buffer.subarray(Math.max(0, buffer.length - 1024)).includes(Buffer.from('%%EOF'));
}

function validCsv(buffer) {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

// The browser-declared mimetype is trivially spoofable. Validate enough of
// each supported container to reject truncated files and common polyglots;
// attachments are served as downloads except for validated images.
function contentMatchesDeclared(buffer, mime) {
  switch (mime) {
    case 'application/pdf':
      return validPdf(buffer);
    case 'image/png':
      return validPng(buffer);
    case 'image/jpeg':
      return validJpeg(buffer);
    case 'image/webp':
      return validWebp(buffer);
    case 'text/csv':
      return validCsv(buffer);
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
  const safeName = [...row.original_name]
    .map((char) => {
      const code = char.codePointAt(0);
      return code < 0x20 || code === 0x7f || char === '"' || char === '\\' ? '_' : char;
    })
    .join('');
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
