import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import {
  parseStatement,
  toISODate,
  parseAmountValue,
  transactionsFromGrid,
  extractPdfText,
} from '../server/services/parser.js';

function makePdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`));
  }
  const xref = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (let i = 1; i < offsets.length; i++)
    chunks.push(Buffer.from(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`));
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

function makeZip({ compressedSize = 1, uncompressedSize = 1, centralSignature = 0x02014b50 } = {}) {
  const name = Buffer.from('xl/workbook.xml');
  const data = Buffer.from('x');
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt32LE(compressedSize, 18);
  local.writeUInt32LE(uncompressedSize, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(centralSignature, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 8);
  central.writeUInt32LE(compressedSize, 20);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

test('toISODate rejects impossible calendar dates', () => {
  assert.equal(toISODate('31/31/2026', 'string'), null);
  assert.equal(toISODate('29.02.2026', 'string'), null); // not a leap year
  assert.equal(toISODate('30/02/2026', 'string'), null);
});

test('toISODate parses common formats', () => {
  assert.equal(toISODate('13/05/2026', 'string'), '2026-05-13');
  assert.equal(toISODate('31/05/2026', 'string'), '2026-05-31');
  assert.equal(toISODate('05.06.2026', 'string'), '2026-06-05');
  assert.equal(toISODate('2026-05-31', 'string'), '2026-05-31');
});

test('MM/DD dates that are impossible as DMY fall back to MDY (05/31/2026)', () => {
  // Previously this produced the invalid '2026-31-05' and stored it silently.
  assert.equal(toISODate('05/31/2026', 'string'), '2026-05-31');
});

test('genuinely ambiguous slash dates stay DMY (05/06/2026)', () => {
  assert.equal(toISODate('05/06/2026', 'string'), '2026-06-05');
});

test('parseAmountValue handles European and US number formats', () => {
  assert.equal(parseAmountValue('1.234,56'), 1234.56);
  assert.equal(parseAmountValue('1,234.56'), 1234.56);
  assert.equal(parseAmountValue('1234,56'), 1234.56);
  assert.equal(parseAmountValue('(12,50)'), -12.5);
  assert.equal(parseAmountValue('-12,50'), -12.5);
  assert.equal(parseAmountValue('€ 45.90'), 45.9);
  assert.equal(parseAmountValue('1234.56'), 1234.56);
  assert.equal(Number.isNaN(parseAmountValue('')), true);
});

test('dedup keys include the currency so same-date/amount/desc rows in different currencies stay distinct', () => {
  const spec = {
    header_row_index: 0,
    col_date: 0,
    col_description: 1,
    col_amount: 2,
    col_currency: 3,
    date_format: 'auto',
    decimal_point: '.',
  };
  const grid = [
    ['Date', 'Description', 'Amount', 'Currency'],
    ['2026-05-01', 'Coffee', '-4.5', 'EUR'],
    ['2026-05-01', 'Coffee', '-4.5', 'USD'],
  ];
  const { transactions } = transactionsFromGrid(grid, spec);
  assert.equal(transactions.length, 2);
  assert.notEqual(transactions[0].dedup_key, transactions[1].dedup_key);
  assert.ok(transactions[0].dedup_key.includes('|EUR|coffee'));
  assert.ok(transactions[1].dedup_key.includes('|USD|coffee'));
});

test('AI-imported grids enforce row and column limits', () => {
  const spec = {
    header_row_index: 0,
    col_date: 0,
    col_description: 1,
    col_amount: 2,
  };
  assert.throws(
    () =>
      transactionsFromGrid(
        Array.from({ length: 100_002 }, () => []),
        spec,
      ),
    /100000-row limit/,
  );
  assert.throws(
    () => transactionsFromGrid([Array.from({ length: 257 }, () => '')], spec),
    /maximum 256/,
  );
});

test('XLSX import remains compatible with the maintained spreadsheet package', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-xlsx-'));
  const file = path.join(dir, 'statement.xlsx');
  try {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount', 'Currency'],
      ['2026-05-01', 'Coffee', '-4,50', 'EUR'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Transactions');
    writeFileSync(file, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

    const parsed = parseStatement(file);
    assert.equal(parsed.transactions.length, 1);
    assert.deepEqual(parsed.transactions[0], {
      date: '2026-05-01',
      description: 'Coffee',
      amount: -4.5,
      revolut_type: null,
      currency: 'EUR',
      dedup_key: '2026-05-01|-4.50|EUR|coffee',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF statement text is extracted locally and normalized into transactions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-pdf-'));
  const file = path.join(dir, 'statement.pdf');
  try {
    writeFileSync(file, makePdf('BT /F1 12 Tf 50 750 Td (01.09.2026 REWE Market -12,50) Tj ET'));
    assert.match(extractPdfText(file), /REWE Market/);
    const parsed = parseStatement(file);
    assert.equal(parsed.transactions.length, 1);
    assert.equal(parsed.transactions[0].date, '2026-09-01');
    assert.equal(parsed.transactions[0].amount, -12.5);
    assert.equal(parsed.transactions[0].description, 'REWE Market');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('XLSX ZIP preflight rejects malformed archives before spreadsheet parsing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-xlsx-malformed-'));
  try {
    const missingEnd = path.join(dir, 'missing-end.xlsx');
    writeFileSync(missingEnd, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    assert.throws(() => parseStatement(missingEnd), /missing ZIP end record/);

    const badCentral = path.join(dir, 'bad-central.xlsx');
    writeFileSync(badCentral, makeZip({ centralSignature: 0xdeadbeef }));
    assert.throws(() => parseStatement(badCentral), /invalid central directory entry/);

    const oversizedEntry = path.join(dir, 'oversized-entry.xlsx');
    writeFileSync(oversizedEntry, makeZip({ uncompressedSize: 64 * 1024 * 1024 + 1 }));
    assert.throws(() => parseStatement(oversizedEntry), /byte limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('XLSX ZIP preflight rejects unsafe expansion ratios and entry counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-xlsx-limits-'));
  try {
    const ratio = path.join(dir, 'ratio.xlsx');
    writeFileSync(ratio, makeZip({ compressedSize: 1, uncompressedSize: 1001 }));
    assert.throws(() => parseStatement(ratio), /compression ratio/);

    const tooMany = path.join(dir, 'too-many.xlsx');
    const archive = makeZip();
    archive.writeUInt16LE(2001, archive.length - 12);
    writeFileSync(tooMany, archive);
    assert.throws(() => parseStatement(tooMany), /too many ZIP entries/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
