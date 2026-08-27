import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toISODate, parseAmountValue, transactionsFromGrid } from '../server/services/parser.js';

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
