import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import xlsxModule from 'xlsx';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const { applyCategorization, createAutomationRule } =
  await import('../server/services/categorizer.js');
const { csvPreflight, parseStatement, rawGrid, transactionsFromGrid } =
  await import('../server/services/parser.js');
const XLSX = xlsxModule.default ?? xlsxModule;
const { als } = dbm;
after(() => {
  cleanup(dir);
});

function categorizeWith(db, tx) {
  return als.run(db, () => applyCategorization([tx]))[0];
}

test('account-scoped automation rules only match once the account is assigned', () => {
  const db = dbm.getUserDb('import-acc');
  const accA = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name, kind) VALUES ('CardA', 'revolut')").run(),
  ).lastInsertRowid;
  const accB = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name, kind) VALUES ('CardB', 'sparkasse')").run(),
  ).lastInsertRowid;
  const cat = als.run(db, () =>
    db.prepare("INSERT INTO categories (name) VALUES ('StreamingAcc')").run(),
  ).lastInsertRowid;
  const rule = als.run(db, () =>
    createAutomationRule({
      description_contains: 'Netflix',
      account_id: accA,
      category_id: cat,
    }),
  );
  assert.ok(rule.id);

  // No account assigned -> rule cannot match (account is null).
  let out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: null });
  assert.equal(out.suggested_category_id, null);
  assert.equal(out.needs_review, 1);

  // Wrong account -> no match.
  out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: accB });
  assert.equal(out.suggested_category_id, null);

  // Correct account -> match.
  out = categorizeWith(db, { description: 'Netflix', amount: -9.99, account_id: accA });
  assert.equal(out.suggested_category_id, cat);
  assert.equal(out.needs_review, 0);

  dbm.closeUserDb('import-acc');
});

test('account-agnostic rules match regardless of account', () => {
  const db = dbm.getUserDb('import-any');
  const acc = als.run(db, () =>
    db.prepare("INSERT INTO accounts (name) VALUES ('AnyAcc')").run(),
  ).lastInsertRowid;
  const cat = als.run(db, () =>
    db.prepare("INSERT INTO categories (name) VALUES ('MarketX')").run(),
  ).lastInsertRowid;
  als.run(db, () => createAutomationRule({ description_contains: 'REWE', category_id: cat }));

  const out = categorizeWith(db, { description: 'REWE Berlin', amount: -12.4, account_id: acc });
  assert.equal(out.suggested_category_id, cat);
  dbm.closeUserDb('import-any');
});

test('CSV preflight parses the complete file and skips only cancelled rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-parser-csv-'));
  const file = path.join(dir, 'statement.csv');
  try {
    const rows = ['Buchungstag;Beschreibung;Betrag;Währung;Buchungsstatus'];
    for (let i = 0; i < 30; i++) {
      rows.push(`01.08.2026;Purchase ${i};-1,00;EUR;gebucht`);
    }
    rows.push('02.08.2026;Cancelled purchase;-9,99;EUR;storniert');
    writeFileSync(file, rows.join('\n'), 'utf8');

    const preflight = csvPreflight(file);
    assert.equal(preflight.can_import_directly, true);
    assert.equal(preflight.stats.total, 31);
    assert.equal(preflight.stats.imported, 30);
    assert.equal(preflight.stats.skippedCancelled, 1);
    assert.equal(preflight.stats.invalid, 0);
    assert.equal(preflight.stats.source_rows, 32);

    const parsed = transactionsFromGrid(rawGrid(file, 1_000_000), preflight.spec);
    assert.equal(parsed.transactions.length, 30);
    assert.equal(parsed.transactions.at(-1).date, '2026-08-01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('XLSX parser reads all rows in a workbook', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-parser-xlsx-'));
  const file = path.join(dir, 'statement.xlsx');
  try {
    const rows = [['Date', 'Description', 'Amount', 'Currency']];
    for (let i = 0; i < 112; i++) rows.push(['2026-08-01', `Purchase ${i}`, -1, 'EUR']);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Statement');
    writeFileSync(file, XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));

    const parsed = parseStatement(file);
    assert.equal(parsed.transactions.length, 112);
    assert.equal(parsed.stats.total, 112);
    assert.equal(parsed.stats.invalid, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
