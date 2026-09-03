import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import papaparse from 'papaparse';
import xlsxModule from 'xlsx';

const XLSX = xlsxModule.default ?? xlsxModule;
const Papa = papaparse.default ?? papaparse;

const MAX_IMPORT_ROWS = 100_000;
const MAX_IMPORT_COLUMNS = 256;
const MAX_IMPORT_SHEETS = 10;
const MAX_IMPORT_CELLS = 5_000_000;
const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ZIP_ENTRIES = 2_000;
const MAX_XLSX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ZIP_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_XLSX_ZIP_COMPRESSION_RATIO = 1_000;
const MAX_XLSX_ZIP_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 40;
const MAX_PDF_TEXT_BYTES = 16 * 1024 * 1024;
const PDF_COMMAND_TIMEOUT_MS = 120_000;
const MAX_IMAGE_PIXELS = 100_000_000;

const REVOLUT_COLUMNS = {
  date: ['Started Date', 'started date'],
  completedDate: ['Completed Date'],
  description: ['Description'],
  amount: ['Amount'],
  fee: ['Fee'],
  currency: ['Currency'],
  state: ['State'],
  type: ['Type'],
};

function detectFormat(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const signature = buf.readUInt32LE(0);
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x02014b50
    ? 'xlsx'
    : 'csv';
}

export function detectFileFormat(filePath) {
  return detectFormat(filePath);
}

function imageDimensions(filePath, format) {
  const buffer = fs.readFileSync(filePath);
  let width;
  let height;

  if (format === 'png') {
    if (
      buffer.length < 24 ||
      !buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      buffer.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('Invalid PNG image');
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
      throw new Error('Invalid JPEG image');
    let offset = 2;
    while (offset + 1 < buffer.length) {
      if (buffer[offset++] !== 0xff) throw new Error('Invalid JPEG image');
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > buffer.length) throw new Error('Invalid JPEG image');
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new Error('Invalid JPEG image');
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (length < 7) throw new Error('Invalid JPEG image');
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }

  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw new Error(`Image dimensions exceed the ${MAX_IMAGE_PIXELS}-pixel limit`);
  return { width, height };
}

function runImageOcr(filePath) {
  try {
    return execFileSync(
      'tesseract',
      [filePath, 'stdout', '-l', process.env.TESSERACT_LANG || 'eng'],
      {
        encoding: 'utf8',
        timeout: PDF_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_PDF_TEXT_BYTES,
      },
    );
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('Image OCR requires Tesseract. Install tesseract-ocr on the server');
    if (error.killed || error.signal === 'SIGTERM') throw new Error('Image OCR timed out');
    throw new Error('Image OCR failed');
  }
}

function runImageOcrTsv(filePath) {
  try {
    return execFileSync(
      'tesseract',
      [filePath, 'stdout', '-l', process.env.TESSERACT_LANG || 'eng', '--psm', '3', 'tsv'],
      {
        encoding: 'utf8',
        timeout: PDF_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_PDF_TEXT_BYTES,
      },
    );
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('Image OCR requires Tesseract. Install tesseract-ocr on the server');
    if (error.killed || error.signal === 'SIGTERM') throw new Error('Image OCR timed out');
    throw new Error('Image OCR failed');
  }
}

function parseTsvWords(tsv) {
  const words = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 12 || Number(fields[0]) !== 5) continue;
    const text = fields[11].trim();
    const confidence = Number(fields[10]);
    if (!text || !Number.isFinite(confidence) || confidence < 20) continue;
    words.push({
      block: fields[2],
      paragraph: fields[3],
      line: fields[4],
      text,
      left: Number(fields[6]),
      top: Number(fields[7]),
      width: Number(fields[8]),
      height: Number(fields[9]),
    });
  }
  return words.filter((word) =>
    [word.left, word.top, word.width, word.height].every((value) => Number.isFinite(value)),
  );
}

const IMAGE_DATE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/;
const IMAGE_AMOUNT_RE = /^[+\-−]?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{2}|\.\d{2})[€$£]?$/;

function imageAmountToken(value) {
  return IMAGE_AMOUNT_RE.test(String(value).replace(/\s+/g, ''));
}

function imageLineText(words) {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.top - b.top || a.left - b.left)) {
    let line = lines.at(-1);
    if (!line || Math.abs(line.top - word.top) > 18) {
      line = { top: word.top, words: [] };
      lines.push(line);
    }
    line.words.push(word);
  }
  return lines
    .map((line) =>
      line.words
        .sort((a, b) => a.left - b.left)
        .map((word) => word.text)
        .join(' '),
    )
    .filter(Boolean)
    .join(' · ');
}

export function rowsFromImageLayout(tsv, { width, height }) {
  const words = parseTsvWords(tsv);
  const dates = words
    .filter(
      (word) =>
        IMAGE_DATE_RE.test(word.text.replace(/[()]/g, '')) &&
        word.top > height * 0.09 &&
        word.top < height * 0.9,
    )
    .sort((a, b) => a.top - b.top);
  const amounts = words
    .filter(
      (word) =>
        imageAmountToken(word.text) &&
        word.left >= width * 0.65 &&
        word.top > height * 0.09 &&
        word.top < height * 0.9,
    )
    .sort((a, b) => a.top - b.top);
  const rows = [];
  const usedAmountTops = new Set();
  for (const amount of amounts) {
    const duplicateTop = [...usedAmountTops].some((top) => Math.abs(top - amount.top) < 30);
    if (duplicateTop) continue;
    usedAmountTops.add(amount.top);
    const date = dates.filter((candidate) => candidate.top < amount.top).at(-1);
    if (!date) continue;
    const description = imageLineText(
      words.filter(
        (word) =>
          word.left >= width * 0.17 &&
          word.left < amount.left - 10 &&
          word.top >= amount.top - 220 &&
          word.top < amount.top - 25 &&
          !IMAGE_DATE_RE.test(word.text.replace(/[()]/g, '')) &&
          !imageAmountToken(word.text),
      ),
    );
    if (!description) continue;
    rows.push([date.text, description, amount.text.replace('−', '-'), 'EUR']);
  }
  return {
    rows,
    diagnostics: {
      method: 'tesseract-tsv-layout',
      words: words.length,
      date_anchors: dates.length,
      amount_candidates: amounts.length,
      structured_rows: rows.length,
    },
  };
}

export function extractImageRows(filePath) {
  const format = detectFormat(filePath);
  if (format !== 'png' && format !== 'jpeg') throw new Error('File is not a PNG or JPEG image');
  const dimensions = imageDimensions(filePath, format);
  const layout = rowsFromImageLayout(runImageOcrTsv(filePath), dimensions);
  if (layout.rows.length) return layout;
  const fallback = rowsFromExtractedText(runImageOcr(filePath));
  return {
    rows: fallback,
    diagnostics: {
      ...layout.diagnostics,
      method: 'tesseract-line-fallback',
      structured_rows: fallback.length,
    },
  };
}

export function extractImageText(filePath) {
  const format = detectFormat(filePath);
  if (format !== 'png' && format !== 'jpeg') throw new Error('File is not a PNG or JPEG image');
  imageDimensions(filePath, format);
  const text = runImageOcr(filePath);
  if (Buffer.byteLength(text, 'utf8') > MAX_PDF_TEXT_BYTES)
    throw new Error('Extracted image text exceeds the size limit');
  if (!text.trim()) throw new Error('Image contains no readable text and OCR returned nothing');
  return text.slice(0, MAX_PDF_TEXT_BYTES);
}

function runPdfCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: PDF_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_PDF_TEXT_BYTES,
      ...options,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `PDF support requires ${command}. Install Poppler (poppler-utils) and Tesseract (tesseract-ocr) on the server`,
      );
    }
    if (error.killed || error.signal === 'SIGTERM') throw new Error(`PDF ${command} timed out`);
    throw new Error(`PDF ${command} failed`);
  }
}

function pdfPageCount(filePath) {
  const info = runPdfCommand('pdfinfo', [filePath], { maxBuffer: 64 * 1024 });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!Number.isInteger(pages) || pages < 1)
    throw new Error('Could not determine the PDF page count');
  if (pages > MAX_PDF_PAGES) throw new Error(`PDF has too many pages (maximum ${MAX_PDF_PAGES})`);
  return pages;
}

function ocrPdf(filePath, pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-planner-pdf-'));
  const prefix = path.join(dir, 'page');
  try {
    runPdfCommand(
      'pdftoppm',
      ['-f', '1', '-l', String(pages), '-r', '150', '-png', filePath, prefix],
      {
        encoding: 'buffer',
        maxBuffer: 1024 * 1024,
      },
    );
    const images = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('page-') && name.endsWith('.png'))
      .sort((a, b) => Number(a.match(/page-(\d+)/)?.[1]) - Number(b.match(/page-(\d+)/)?.[1]));
    if (!images.length) throw new Error('PDF rasterization produced no pages');
    return images
      .map((image) =>
        runPdfCommand(
          'tesseract',
          [path.join(dir, image), 'stdout', '-l', process.env.TESSERACT_LANG || 'eng'],
          { maxBuffer: MAX_PDF_TEXT_BYTES },
        ),
      )
      .join('\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function extractPdfText(filePath) {
  const pages = pdfPageCount(filePath);
  let text = runPdfCommand('pdftotext', ['-layout', filePath, '-']);
  if (Buffer.byteLength(text, 'utf8') > MAX_PDF_TEXT_BYTES)
    throw new Error('Extracted PDF text exceeds the size limit');
  // Scanned statements usually produce an empty or nearly empty text layer.
  // OCR is local and only its resulting text can continue to the AI mapper.
  if (text.split('\n').filter((line) => line.trim()).length < 2) text = ocrPdf(filePath, pages);
  if (!text.trim()) throw new Error('PDF contains no readable text and OCR returned nothing');
  return text.slice(0, MAX_PDF_TEXT_BYTES);
}

const PDF_DATE_RE = /\b(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/;
const PDF_AMOUNT_RE = /(?:[-+]?\(?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})\)?|[-+]?\d+[.,]\d{2})/g;

export function rowsFromExtractedText(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const date = line.match(PDF_DATE_RE)?.[0];
    if (!date) continue;
    const amounts = [...line.matchAll(PDF_AMOUNT_RE)];
    const amount = amounts.at(-1);
    if (!amount) continue;
    const description = line
      .replace(date, ' ')
      .replace(amount[0], ' ')
      .replace(/\s+/g, ' ')
      .replace(/[|;]/g, ' ')
      .trim();
    if (!description) continue;
    rows.push([date, description, amount[0], 'EUR']);
    if (rows.length > MAX_IMPORT_ROWS)
      throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
  }
  return rows;
}

function parseSheetRows(rows) {
  // rows: array of objects keyed by header names (from either parser)
  if (!rows.length) return { mapping: null, raw: [] };
  if (rows.length > MAX_IMPORT_ROWS)
    throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
  const headers = Object.keys(rows[0]);
  if (headers.length > MAX_IMPORT_COLUMNS)
    throw new Error(`Import has too many columns (maximum ${MAX_IMPORT_COLUMNS})`);
  const findCol = (candidates) => candidates.find((c) => headers.some((h) => h.trim() === c));

  const mapping = {};
  for (const [field, candidates] of Object.entries(REVOLUT_COLUMNS)) {
    const col = findCol(candidates);
    if (col) mapping[field] = col;
  }
  // generic fallbacks for non-Revolut files
  if (!mapping.date) {
    mapping.date = headers.find((h) => /^date/i.test(h)) || headers.find((h) => /date/i.test(h));
  }
  if (!mapping.description) {
    mapping.description =
      headers.find((h) => /desc|payee|merchant|name|details/i.test(h)) || headers[2];
  }
  if (!mapping.payee)
    mapping.payee = headers.find((h) => /beneficiary|payee|recipient|counterparty/i.test(h));
  if (!mapping.amount) {
    mapping.amount = headers.find((h) => /amount|value|sum/i.test(h));
  }
  if (!mapping.state) mapping.state = headers.find((h) => /state|status/i.test(h));
  if (!mapping.type) mapping.type = headers.find((h) => /type/i.test(h));
  if (!mapping.currency) mapping.currency = headers.find((h) => /currency/i.test(h));
  return { mapping, raw: rows };
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new Error(`Import file exceeds the 64 MB limit`);
  preflightXlsxZip(buffer);
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    // Avoid materializing unbounded row counts before the range checks below.
    sheetRows: MAX_IMPORT_ROWS + 1,
  });
  if (wb.SheetNames.length > MAX_IMPORT_SHEETS)
    throw new Error(`Workbook has too many sheets (maximum ${MAX_IMPORT_SHEETS})`);

  let cells = 0;
  for (const name of wb.SheetNames) {
    const ref = wb.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows > MAX_IMPORT_ROWS)
      throw new Error(`Workbook sheet "${name}" exceeds the ${MAX_IMPORT_ROWS}-row limit`);
    if (columns > MAX_IMPORT_COLUMNS)
      throw new Error(`Workbook sheet "${name}" exceeds the ${MAX_IMPORT_COLUMNS}-column limit`);
    cells += rows * columns;
    if (cells > MAX_IMPORT_CELLS)
      throw new Error(`Workbook exceeds the ${MAX_IMPORT_CELLS}-cell limit`);
  }
  return wb;
}

// SheetJS must not be allowed to inspect an untrusted ZIP before its archive
// metadata has been bounded. This catches malformed central directories and
// compressed entries whose expansion would otherwise exhaust memory.
function preflightXlsxZip(buffer) {
  const minEocd = 22;
  const eocdStart = Math.max(0, buffer.length - minEocd - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= eocdStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Malformed XLSX archive: missing ZIP end record');

  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (eocd + minEocd + commentLength !== buffer.length)
    throw new Error('Malformed XLSX archive: invalid ZIP comment or trailing data');
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0)
    throw new Error('Malformed XLSX archive: multi-disk ZIP is not supported');

  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('XLSX ZIP64 archives are not supported');
  if (entries > MAX_XLSX_ZIP_ENTRIES)
    throw new Error(`XLSX archive has too many ZIP entries (maximum ${MAX_XLSX_ZIP_ENTRIES})`);
  if (centralSize > MAX_XLSX_ZIP_CENTRAL_DIRECTORY_BYTES)
    throw new Error('XLSX archive central directory is too large');
  if (
    centralOffset > eocd ||
    centralSize > eocd - centralOffset ||
    centralOffset + centralSize !== eocd
  )
    throw new Error('Malformed XLSX archive: invalid central directory bounds');

  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let i = 0; i < entries; i++) {
    if (cursor > eocd - 46 || buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Malformed XLSX archive: invalid central directory entry');
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + entryCommentLength;
    if (cursor + recordLength > eocd)
      throw new Error('Malformed XLSX archive: truncated directory entry');
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff)
      throw new Error('XLSX ZIP64 entries are not supported');
    if (flags & 0x1) throw new Error('Encrypted XLSX archives are not supported');
    if (uncompressed > MAX_XLSX_ZIP_ENTRY_BYTES)
      throw new Error(`XLSX ZIP entry exceeds the ${MAX_XLSX_ZIP_ENTRY_BYTES} byte limit`);
    if (uncompressed > compressed * MAX_XLSX_ZIP_COMPRESSION_RATIO && uncompressed > 0)
      throw new Error('XLSX ZIP entry has an unsafe compression ratio');
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_XLSX_ZIP_UNCOMPRESSED_BYTES)
      throw new Error('XLSX archive exceeds the uncompressed size limit');

    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (!name || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..'))
      throw new Error('Malformed XLSX archive: unsafe ZIP entry name');
    if (localOffset > centralOffset || localOffset > buffer.length - 30)
      throw new Error('Malformed XLSX archive: invalid local entry offset');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('Malformed XLSX archive: invalid local entry header');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart > centralOffset || compressed > centralOffset - dataStart)
      throw new Error('Malformed XLSX archive: truncated ZIP entry');
    cursor += recordLength;
  }
  if (cursor !== eocd) throw new Error('Malformed XLSX archive: central directory size mismatch');
}

export function parseStatement(filePath) {
  const format = detectFormat(filePath);
  let parsedRows;

  if (format === 'pdf' || format === 'png' || format === 'jpeg') {
    parsedRows = {
      mapping: { date: 0, description: 1, amount: 2, currency: 3 },
      raw:
        format === 'pdf'
          ? rowsFromExtractedText(extractPdfText(filePath))
          : extractImageRows(filePath).rows,
    };
  } else if (format === 'xlsx') {
    // no cellDates: keep raw serial numbers and convert with UTC math,
    // otherwise SheetJS shifts dates through the local timezone
    const wb = readWorkbook(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    parsedRows = parseSheetRows(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }));
  } else {
    const text = readCsvText(filePath);
    const parsed = Papa.parse(text.trim(), {
      header: true,
      skipEmptyLines: true,
      preview: MAX_IMPORT_ROWS + 1,
    });
    if (parsed.data.length > MAX_IMPORT_ROWS)
      throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
    parsedRows = parseSheetRows(parsed.data);
  }
  return finalize(parsedRows, format === 'xlsx' ? 'date' : 'string');
}

function validISODate(y, m, d) {
  if (!Number.isInteger(y) || y < 1000 || y > 9999) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(y, m, 0).getDate();
  return d <= dim;
}

const pad2 = (n) => String(n).padStart(2, '0');

function expandShortYear(value) {
  const year = Number(value);
  return String(value).length === 2 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
}

function isCancelledState(state) {
  return /\b(?:cancelled|canceled|storniert|storno|annulliert)\b/.test(
    String(state ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function toISODate(value, _mode) {
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    const d = new Date(EXCEL_EPOCH + Math.floor(value) * 86400000);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(EXCEL_EPOCH + Math.floor(parseFloat(s)) * 86400000);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const d1 = Number(dmy[1]);
    const d2 = Number(dmy[2]);
    const y = expandShortYear(dmy[3]);
    // Default DMY; fall back to MDY only when DMY is an impossible calendar
    // date (e.g. 05/31/2026). Genuinely ambiguous dates stay DMY.
    if (validISODate(y, d2, d1)) return `${y}-${pad2(d2)}-${pad2(d1)}`;
    if (validISODate(y, d1, d2)) return `${y}-${pad2(d1)}-${pad2(d2)}`;
    return null; // impossible date like 31/31/2026 — reject instead of storing it
  }
  const parsed = new Date(s);
  if (!isNaN(parsed)) {
    // Use LOCAL calendar parts: toISOString() would shift a "Aug 27, 2026"
    // style date back a day on UTC+1/+2 machines (and corrupt the dedup key).
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dd}`;
  }
  return null;
}

// Parse statement amounts across European and US formats: "1.234,56",
// "1,234.56", "1234.56", "1.234", with optional currency symbols and
// parenthesised negatives "(12,50)".
export function parseAmountValue(v) {
  if (v === '' || v == null) return NaN;
  let s = String(v)
    .trim()
    .replace(/[€$£\s]/g, '');
  const negative = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[()]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, ''); // 1,234.56
  } else if (/^-?\d+,\d+$/.test(s)) {
    s = s.replace(',', '.'); // 1234,56
  }
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

export function normalizeDesc(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Two genuinely different purchases CAN share a day, amount and merchant
// (two coffees at the same place). Keys must stay deterministic across
// re-imports and overlapping exports, so identical rows get an occurrence
// index in file order: first occurrence keeps the plain key, subsequent ones
// gain "|#1", "|#2", … A re-import of the same or an overlapping file
// reproduces the same keys, so dedup still blocks everything already stored.
function assignDedupKeys(transactions) {
  const seen = new Map();
  for (const tx of transactions) {
    const n = seen.get(tx.dedup_key) ?? 0;
    seen.set(tx.dedup_key, n + 1);
    if (n > 0) tx.dedup_key = `${tx.dedup_key}|#${n}`;
  }
  return transactions;
}

function finalize({ mapping, raw }, mode) {
  if (
    !mapping ||
    mapping.date === undefined ||
    mapping.date === null ||
    mapping.amount === undefined ||
    mapping.amount === null
  ) {
    throw new Error(
      'Could not detect required columns (date / amount). Headers found: ' +
        (raw[0] ? Object.keys(raw[0]).join(', ') : '(empty file)'),
    );
  }

  const transactions = [];
  const errors = [];
  const MAX_PARSE_ERRORS = 50;
  const stats = {
    total: 0,
    imported: 0,
    skippedCancelled: 0,
    skippedReverted: 0,
    skippedPendingCurrentMonth: 0,
    invalid: 0,
  };

  let dataRow = 0;
  for (const row of raw) {
    dataRow++;
    stats.total++;
    const state = String(row[mapping.state] ?? '')
      .trim()
      .toLowerCase();
    if (isCancelledState(state)) {
      stats.skippedCancelled++;
      continue;
    }
    const iso = toISODate(row[mapping.date], mode);
    const amount = parseAmountValue(row[mapping.amount]);
    const description = String(row[mapping.description] ?? '').trim();
    if (!iso || isNaN(amount) || !description) {
      stats.invalid++;
      if (errors.length < MAX_PARSE_ERRORS) {
        const reason = !iso
          ? 'unrecognized date'
          : isNaN(amount)
            ? 'unrecognized amount'
            : 'missing description';
        errors.push({ row: dataRow, reason, value: String(row[mapping.date] ?? '').slice(0, 40) });
      }
      continue;
    }
    stats.imported++;
    const currency = mapping.currency ? String(row[mapping.currency] ?? '').trim() || 'EUR' : 'EUR';
    const descriptionParts = [String(row[mapping.description] ?? '').trim()];
    if (mapping.payee) {
      const payee = String(row[mapping.payee] ?? '').trim();
      if (payee && !descriptionParts.includes(payee)) descriptionParts.push(payee);
    }
    transactions.push({
      date: iso,
      description: descriptionParts.filter(Boolean).join(' · '),
      amount,
      revolut_type: mapping.type ? String(row[mapping.type] ?? '') : null,
      currency,
      dedup_key: `${iso}|${amount.toFixed(2)}|${currency}|${normalizeDesc(description)}`,
    });
  }
  if (stats.invalid > errors.length) errors.push({ truncated: stats.invalid - errors.length });
  stats.source_rows = raw.length + 1;
  stats.header_row = 0;
  stats.pre_header_rows = 0;
  return { transactions: assignDedupKeys(transactions), stats, errors, mapping };
}

// -------------------------------------------------------------- AI file doctor

// Raw grid of first rows (no header assumptions) for the AI to inspect.
export function rawGrid(filePath, maxRows = 25) {
  const format = detectFormat(filePath);
  if (format === 'pdf' || format === 'png' || format === 'jpeg') {
    const text = format === 'pdf' ? extractPdfText(filePath) : extractImageText(filePath);
    const rows = rowsFromExtractedText(text).slice(0, Math.min(maxRows - 1, MAX_IMPORT_ROWS));
    return [['Date', 'Description', 'Amount', 'Currency'], ...rows];
  }
  if (format === 'xlsx') {
    const wb = readWorkbook(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils
      .sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
      .slice(0, Math.min(maxRows, MAX_IMPORT_ROWS + 1));
  }
  const text = readCsvText(filePath);
  const parsed = Papa.parse(text, { skipEmptyLines: false });
  const rows = parsed.data.filter((row) => row.some((value) => String(value ?? '').trim()));
  const limit = Math.min(maxRows, MAX_IMPORT_ROWS + 1);
  if (maxRows > MAX_IMPORT_ROWS && rows.length > limit)
    throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
  return rows.slice(0, limit);
}

const CSV_HEADER_MATCHERS = {
  date: /\b(date|datum|booking|value|buchung|buchungstag|valutadatum|started|completed)\b/i,
  description:
    /desc|beschreibung|memo|merchant|payee|name|details|narration|reference|purpose|verwendungszweck/i,
  payee: /beneficiary|payee|beguenstigter|zahlungspflichtiger|recipient|counterparty/i,
  amount: /\b(amount|sum|value|betrag|total|price)\b/i,
  in: /credit|deposit|income|incoming|money.?in|haben|gutschrift/i,
  out: /debit|withdraw|expense|outgoing|money.?out|soll|lastschrift/i,
  state: /\b(state|status|zustand|info|buchungsstatus)\b/i,
  type: /\b(type|art|transaction type)\b/i,
  currency: /\b(currency|währung|waehrung|curr)\b/i,
};

function normalizedHeader(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readCsvText(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    return buffer.subarray(3).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // German bank exports are commonly ISO-8859-1/Windows-1252 encoded.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function csvHeaderSignature(grid, headerRow) {
  const row = grid[headerRow];
  if (!Array.isArray(row) || !row.some((value) => String(value ?? '').trim())) return '';
  const normalized = row.map(normalizedHeader);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function inferCsvSpec(grid) {
  let best = null;
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 25); rowIndex++) {
    const row = grid[rowIndex];
    if (!Array.isArray(row)) continue;
    const scores = {};
    for (const [field, matcher] of Object.entries(CSV_HEADER_MATCHERS)) {
      const index = row.findIndex((value) => matcher.test(normalizedHeader(value)));
      if (index >= 0) scores[field] = index;
    }
    const hasAmount =
      scores.amount !== undefined || scores.in !== undefined || scores.out !== undefined;
    const score =
      (scores.date !== undefined ? 2 : 0) +
      (scores.description !== undefined ? 2 : 0) +
      (hasAmount ? 2 : 0) +
      (scores.currency !== undefined ? 1 : 0) +
      (scores.state !== undefined ? 1 : 0);
    if (!best || score > best.score) best = { rowIndex, scores, score };
  }

  if (!best || best.score < 6) {
    return {
      spec: null,
      header_row_index: best?.rowIndex ?? -1,
      headers: best ? grid[best.rowIndex].map((value) => String(value ?? '').trim()) : [],
      signature: best ? csvHeaderSignature(grid, best.rowIndex) : '',
      issues: ['Required date, description, and amount columns were not identified confidently.'],
    };
  }

  const { scores } = best;
  const spec = {
    header_row_index: best.rowIndex,
    col_date: scores.date,
    col_description: scores.description,
    col_payee: scores.payee ?? null,
    col_amount: scores.amount ?? null,
    col_in: scores.amount === undefined ? (scores.in ?? null) : null,
    col_out: scores.amount === undefined ? (scores.out ?? null) : null,
    col_state: scores.state ?? null,
    ignore_states: ['cancelled', 'canceled'],
    col_type: scores.type ?? null,
    col_currency: scores.currency ?? null,
    date_format: 'auto',
    decimal_point: '.',
  };
  const sample = grid
    .slice(best.rowIndex + 1)
    .filter((row) => row.some((value) => String(value ?? '').trim()));
  const dateValues = sample.map((row) => String(row[scores.date] ?? '').trim()).filter(Boolean);
  const amountValues = sample
    .flatMap((row) => [row[scores.amount], row[scores.in], row[scores.out]])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  const ambiguousSlashDate = dateValues.some((value) => {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return match && Number(match[1]) <= 12 && Number(match[2]) <= 12;
  });
  if (ambiguousSlashDate) spec.date_format = 'auto';
  else if (dateValues.some((value) => /^\d{1,2}\.\d{1,2}\.\d{4}/.test(value)))
    spec.date_format = 'DD.MM.YYYY';
  else if (dateValues.some((value) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)))
    spec.date_format = 'DD/MM/YYYY';
  if (amountValues.some((value) => /\d\.\d{3},\d{1,2}$/.test(value) || /\d,\d{1,2}$/.test(value)))
    spec.decimal_point = ',';

  return {
    spec,
    header_row_index: best.rowIndex,
    headers: grid[best.rowIndex].map((value) => String(value ?? '').trim()),
    signature: csvHeaderSignature(grid, best.rowIndex),
    sample_rows: sample.length,
    ambiguous_date: ambiguousSlashDate,
    issues: [],
  };
}

export function csvPreflight(filePath) {
  // Parse the complete bounded file before taking the AI sample. This keeps
  // blank lines from consuming the sample window and validates every row.
  const grid = rawGrid(filePath, MAX_IMPORT_ROWS + 1);
  if (!grid.length || !grid.some((row) => row.some((value) => String(value ?? '').trim())))
    throw new Error('CSV file appears to be empty');
  const inferred = inferCsvSpec(grid);
  const issues = [...inferred.issues];
  let stats = null;
  if (inferred.spec) {
    const parsed = transactionsFromGrid(grid, inferred.spec);
    stats = parsed.stats;
    const valid = stats.imported + stats.skippedCancelled + stats.skippedPendingCurrentMonth;
    const invalidRate = stats.total ? stats.invalid / stats.total : 1;
    if (!valid) issues.push('No valid transaction rows were found.');
    if (invalidRate > 0.1)
      issues.push(`${stats.invalid} of ${stats.total} sample rows could not be read.`);
    if (inferred.ambiguous_date)
      issues.push('Dates use an ambiguous slash format; AI should confirm the date order.');
  }
  return {
    format: 'csv',
    headers: inferred.headers,
    signature: inferred.signature,
    spec: inferred.spec,
    sample_rows: inferred.sample_rows ?? 0,
    stats,
    issues,
    can_import_directly: !!inferred.spec && issues.length === 0,
    grid,
  };
}

// Build normalized transactions from a full grid using an AI-proposed spec.
export function transactionsFromGrid(grid, spec) {
  if (!Array.isArray(grid) || grid.length > MAX_IMPORT_ROWS + 1)
    throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
  if (grid.some((row) => Array.isArray(row) && row.length > MAX_IMPORT_COLUMNS))
    throw new Error(`Import has too many columns (maximum ${MAX_IMPORT_COLUMNS})`);

  const colDate = Number(spec.col_date);
  const colDesc = Number(spec.col_description);
  const colPayee = spec.col_payee != null && spec.col_payee !== '' ? Number(spec.col_payee) : null;
  const colAmount =
    spec.col_amount != null && spec.col_amount !== '' ? Number(spec.col_amount) : null;
  const colIn = spec.col_in != null && spec.col_in !== '' ? Number(spec.col_in) : null;
  const colOut = spec.col_out != null && spec.col_out !== '' ? Number(spec.col_out) : null;
  const colState = spec.col_state != null && spec.col_state !== '' ? Number(spec.col_state) : null;
  const colType = spec.col_type != null && spec.col_type !== '' ? Number(spec.col_type) : null;
  const colCurrency =
    spec.col_currency != null && spec.col_currency !== '' ? Number(spec.col_currency) : null;
  const headerRow = Number(spec.header_row_index ?? 0);
  const decimal = spec.decimal_point === ',' ? ',' : '.';
  const dateFormat = String(spec.date_format || 'auto');

  const parseAmount = (v) => {
    if (v === '' || v == null) return NaN;
    if (decimal === ',') {
      let s = String(v).trim().replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
      return parseFloat(s);
    }
    return parseAmountValue(v);
  };

  const parseDate = (v) => {
    if (v === '' || v == null) return null;
    if (/^\d{5}(\.\d+)?$/.test(String(v)) || dateFormat === 'excel_serial') {
      const n = Number(v);
      if (isNaN(n)) return null;
      const d = new Date(EXCEL_EPOCH + Math.floor(n) * 86400000);
      if (isNaN(d)) return null;
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m;
    if (
      dateFormat === 'DD.MM.YYYY' ||
      (dateFormat === 'auto' && (m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)))
    ) {
      m = m || s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
      if (m) {
        const year = expandShortYear(m[3]);
        if (validISODate(year, Number(m[2]), Number(m[1])))
          return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return null;
      }
    }
    if (
      dateFormat === 'DD/MM/YYYY' ||
      (dateFormat === 'auto' && (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)))
    ) {
      m = m || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (m) {
        const year = expandShortYear(m[3]);
        if (validISODate(year, Number(m[2]), Number(m[1])))
          return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return null;
      }
    }
    if (dateFormat === 'MM/DD/YYYY') {
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) {
        const year = expandShortYear(m[3]);
        if (validISODate(year, Number(m[1]), Number(m[2])))
          return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        return null;
      }
    }
    const d = new Date(s);
    if (isNaN(d)) return null;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dd}`;
  };

  const transactions = [];
  const errors = [];
  const MAX_PARSE_ERRORS = 50;
  const stats = {
    total: 0,
    imported: 0,
    skippedCancelled: 0,
    skippedReverted: 0,
    skippedPendingCurrentMonth: 0,
    invalid: 0,
  };

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    stats.total++;
    const state =
      colState != null
        ? String(row[colState] ?? '')
            .trim()
            .toLowerCase()
        : '';
    if (isCancelledState(state)) {
      stats.skippedCancelled++;
      continue;
    }
    const iso = parseDate(row[colDate]);
    let amount = NaN;
    if (colAmount != null) {
      amount = parseAmount(row[colAmount]);
    } else if (colIn != null || colOut != null) {
      const inn = colIn != null ? parseAmount(row[colIn]) : NaN;
      const out = colOut != null ? parseAmount(row[colOut]) : NaN;
      if (!isNaN(out) && out !== 0) amount = -Math.abs(out);
      else if (!isNaN(inn) && inn !== 0) amount = Math.abs(inn);
    }
    const descriptionParts = [String(row[colDesc] ?? '').trim()];
    if (colPayee != null) {
      const payee = String(row[colPayee] ?? '').trim();
      if (payee && !descriptionParts.includes(payee)) descriptionParts.push(payee);
    }
    const description = descriptionParts.filter(Boolean).join(' · ');
    if (!iso || isNaN(amount) || !description) {
      stats.invalid++;
      if (errors.length < MAX_PARSE_ERRORS) {
        const reason = !iso
          ? 'unrecognized date'
          : isNaN(amount)
            ? 'unrecognized amount'
            : 'missing description';
        errors.push({ row: i - headerRow, reason, value: String(row[colDate] ?? '').slice(0, 40) });
      }
      continue;
    }
    stats.imported++;
    const currency = colCurrency != null ? String(row[colCurrency] ?? '').trim() || 'EUR' : 'EUR';
    transactions.push({
      date: iso,
      description,
      amount,
      revolut_type: colType != null ? String(row[colType] ?? '') : null,
      currency,
      dedup_key: `${iso}|${amount.toFixed(2)}|${currency}|${normalizeDesc(description)}`,
    });
  }
  if (stats.invalid > errors.length) errors.push({ truncated: stats.invalid - errors.length });
  stats.source_rows = grid.length;
  stats.header_row = headerRow;
  stats.pre_header_rows = Math.max(0, headerRow);
  return { transactions: assignDedupKeys(transactions), stats, errors };
}
