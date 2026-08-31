import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTransferPairs, annotateWithTransferPairs } from '../server/services/transfer-detect.js';

function tx(o) { return { date: o.date, amount: o.amount, description: o.description ?? '', account_id: o.account_id ?? null }; }

test('detects a matching bank↔card pair on the same date', () => {
  const pairs = detectTransferPairs([
    tx({ date: '2026-08-15', amount: -500, description: 'TOP-UP TO CARD', account_id: 1 }),
    tx({ date: '2026-08-15', amount: 500, description: 'TOP-UP FROM BANK', account_id: 2 }),
    tx({ date: '2026-08-16', amount: -20, description: 'REWE', account_id: 2 }),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].amount, 500);
  assert.equal(pairs[0].date, '2026-08-15');
  assert.equal(pairs[0].confidence, 'high');
  assert.equal(pairs[0].account_a, 1);
  assert.equal(pairs[0].account_b, 2);
});

test('does not pair rows on the same account', () => {
  const pairs = detectTransferPairs([
    tx({ date: '2026-08-15', amount: -500, description: 'A', account_id: 1 }),
    tx({ date: '2026-08-15', amount: 500, description: 'B', account_id: 1 }),
  ]);
  assert.equal(pairs.length, 0);
});

test('does not pair same-sign rows or different amounts', () => {
  const pairs = detectTransferPairs([
    tx({ date: '2026-08-15', amount: -500, description: 'A', account_id: 1 }),
    tx({ date: '2026-08-15', amount: -500, description: 'B', account_id: 2 }),
    tx({ date: '2026-08-15', amount: 500, description: 'C', account_id: 2 }),
    tx({ date: '2026-08-15', amount: 600, description: 'D', account_id: 2 }),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].amount, 500);
});

test('skips duplicate rows (already in the database)', () => {
  const pairs = detectTransferPairs([
    { ...tx({ date: '2026-08-15', amount: -500, description: 'X' }), duplicate: true },
    tx({ date: '2026-08-15', amount: 500, description: 'Y' }),
  ]);
  assert.equal(pairs.length, 0);
});

test('annotateWithTransferPairs stamps the same id on both sides', () => {
  const ann = annotateWithTransferPairs([
    tx({ date: '2026-08-15', amount: -500, description: 'X' }),
    tx({ date: '2026-08-15', amount: 500, description: 'Y' }),
  ]);
  assert.ok(ann[0].transfer_pair_id);
  assert.equal(ann[0].transfer_pair_id, ann[1].transfer_pair_id);
  assert.equal(ann[0].transfer_pair_other, 1);
  assert.equal(ann[1].transfer_pair_other, 0);
});
