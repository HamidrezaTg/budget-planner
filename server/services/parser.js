import fs from 'node:fs';
import papaparse from 'papaparse';
import xlsxModule from 'xlsx';

const XLSX = xlsxModule.default ?? xlsxModule;
const Papa = papaparse.default ?? papaparse;

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
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
    ? 'xlsx'
    : 'csv';
}

function parseSheetRows(rows) {
  // rows: array of objects keyed by header names (from either parser)
  if (!rows.length) return { mapping: null, raw: [] };
  const headers = Object.keys(rows[0]);
  const findCol = (candidates) =>
    candidates.find((c) => headers.some((h) => h.trim() === c));

  const mapping = {};
  for (const [field, candidates] of Object.entries(REVOLUT_COLUMNS)) {
    const col = findCol(candidates);
    if (col) mapping[field] = col;
  }
  // generic fallbacks for non-Revolut files
  if (!mapping.date) {
    mapping.date =
      headers.find((h) => /^date/i.test(h)) ||
      headers.find((h) => /date/i.test(h));
  }
  if (!mapping.description) {
    mapping.description =
      headers.find((h) => /desc|payee|merchant|name|details/i.test(h)) || headers[2];
  }
  if (!mapping.amount) {
    mapping.amount = headers.find((h) => /amount|value|sum/i.test(h));
  }
  if (!mapping.state) mapping.state = headers.find((h) => /state|status/i.test(h));
  if (!mapping.type) mapping.type = headers.find((h) => /type/i.test(h));
  if (!mapping.currency) mapping.currency = headers.find((h) => /currency/i.test(h));
  return { mapping, raw: rows };
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function parseStatement(filePath) {
  const format = detectFormat(filePath);
  let rows;

  if (format === 'xlsx') {
    // no cellDates: keep raw serial numbers and convert with UTC math,
    // otherwise SheetJS shifts dates through the local timezone
    const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  } else {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    rows = parsed.data;
  }
  return finalize(parseSheetRows(rows), format === 'xlsx' ? 'date' : 'string');
}

function toISODate(value, mode) {  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    return new Date(EXCEL_EPOCH + Math.floor(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return new Date(EXCEL_EPOCH + Math.floor(parseFloat(s)) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return null;
}

export function normalizeDesc(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function finalize({ mapping, raw }, mode) {
  if (!mapping || !mapping.date || !mapping.amount) {
    throw new Error(
      'Could not detect required columns (date / amount). Headers found: ' +
        (raw[0] ? Object.keys(raw[0]).join(', ') : '(empty file)')
    );
  }

  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const transactions = [];
  const stats = {
    total: 0,
    imported: 0,
    skippedReverted: 0,
    skippedPendingCurrentMonth: 0,
    invalid: 0,
  };

  for (const row of raw) {
    stats.total++;
    const state = String(row[mapping.state] ?? '').trim().toLowerCase();
    if (state === 'reverted') {
      stats.skippedReverted++;
      continue;
    }
    const iso = toISODate(row[mapping.date], mode);
    const amount = parseFloat(String(row[mapping.amount] ?? '').replace(',', '.'));
    const description = String(row[mapping.description] ?? '').trim();
    if (!iso || isNaN(amount) || !description) {
      stats.invalid++;
      continue;
    }
    if (state === 'pending' && iso >= currentMonthStart) {
      stats.skippedPendingCurrentMonth++;
      continue;
    }
    stats.imported++;
    transactions.push({
      date: iso,
      description,
      amount,
      revolut_type: mapping.type ? String(row[mapping.type] ?? '') : null,
      currency: mapping.currency ? String(row[mapping.currency] ?? 'EUR') : 'EUR',
      dedup_key: `${iso}|${amount.toFixed(2)}|${normalizeDesc(description)}`,
    });
  }
  return { transactions, stats, mapping };
}

// -------------------------------------------------------------- AI file doctor

// Raw grid of first rows (no header assumptions) for the AI to inspect.
export function rawGrid(filePath, maxRows = 25) {
  const format = detectFormat(filePath);
  if (format === 'xlsx') {
    const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
      .slice(0, maxRows);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  return Papa.parse(text.trim(), { skipEmptyLines: false }).data.slice(0, maxRows);
}

// Build normalized transactions from a full grid using an AI-proposed spec.
export function transactionsFromGrid(grid, spec) {
  const colDate = Number(spec.col_date);
  const colDesc = Number(spec.col_description);
  const colAmount = spec.col_amount != null && spec.col_amount !== '' ? Number(spec.col_amount) : null;
  const colIn = spec.col_in != null && spec.col_in !== '' ? Number(spec.col_in) : null;
  const colOut = spec.col_out != null && spec.col_out !== '' ? Number(spec.col_out) : null;
  const colState = spec.col_state != null && spec.col_state !== '' ? Number(spec.col_state) : null;
  const colType = spec.col_type != null && spec.col_type !== '' ? Number(spec.col_type) : null;
  const colCurrency = spec.col_currency != null && spec.col_currency !== '' ? Number(spec.col_currency) : null;
  const ignoreStates = Array.isArray(spec.ignore_states) ? spec.ignore_states.map((s) => String(s).toLowerCase()) : [];
  const headerRow = Number(spec.header_row_index ?? 0);
  const decimal = spec.decimal_point === ',' ? ',' : '.';
  const dateFormat = String(spec.date_format || 'auto');

  const parseAmount = (v) => {
    if (v === '' || v == null) return NaN;
    let s = String(v).trim().replace(/[€\s]/g, '');
    if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  };

  const parseDate = (v) => {
    if (v === '' || v == null) return null;
    if (/^\d{5}(\.\d+)?$/.test(String(v)) || dateFormat === 'excel_serial') {
      const n = Number(v);
      if (isNaN(n)) return null;
      return new Date(EXCEL_EPOCH + Math.floor(n) * 86400000).toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m;
    if (dateFormat === 'DD.MM.YYYY' || (dateFormat === 'auto' && (m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)))) {
      m = m || s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (dateFormat === 'DD/MM/YYYY' || (dateFormat === 'auto' && (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)))) {
      m = m || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (dateFormat === 'MM/DD/YYYY') {
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  };

  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const transactions = [];
  const stats = { total: 0, imported: 0, skippedReverted: 0, skippedPendingCurrentMonth: 0, invalid: 0 };

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    stats.total++;
    const state = colState != null ? String(row[colState] ?? '').trim().toLowerCase() : '';
    if (state && ignoreStates.includes(state)) {
      stats.skippedReverted++;
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
    const description = String(row[colDesc] ?? '').trim();
    if (!iso || isNaN(amount) || !description) {
      stats.invalid++;
      continue;
    }
    if (state === 'pending' && iso >= currentMonthStart) {
      stats.skippedPendingCurrentMonth++;
      continue;
    }
    stats.imported++;
    transactions.push({
      date: iso,
      description,
      amount,
      revolut_type: colType != null ? String(row[colType] ?? '') : null,
      currency: colCurrency != null ? String(row[colCurrency] ?? 'EUR') : 'EUR',
      dedup_key: `${iso}|${amount.toFixed(2)}|${normalizeDesc(description)}`,
    });
  }
  return { transactions, stats };
}
