// Detect pairs of bank↔card transfers inside an import batch.
//
// A "transfer" here is a movement of money between two of the user's own
// accounts. The bank statement shows both sides as ordinary transactions
// (a -500 from "Bank account" and a +500 from "Card"). Without detection
// they pollute the budget as uncategorized spend/income.
//
// We look for: same date, same absolute amount, opposite signs, different
// accounts. Each pair is offered to the user for confirmation; on confirm
// the importer sets a shared `transfer_group` on both rows so the model
// excludes them from spend/income/category sums.

const AMOUNT_EPSILON = 0.005; // half a cent — tolerates tiny FX rounding

function amountKey(t) {
  return Math.round(Math.abs(Number(t.amount) || 0) * 100);
}

// Find every transfer pair in a list of previews. `accountIdByName` is a
// best-effort matcher so the user sees "Bank account ↔ Card" instead of
// numeric ids; pass `null` if no account has been picked yet.
export function detectTransferPairs(previews, _accountId = null) {
  // Index by (date, amount). Only keep rows that are non-zero amounts
  // (zero-amount rows are usually summaries and never form a pair).
  const buckets = new Map();
  for (let i = 0; i < previews.length; i++) {
    const t = previews[i];
    if (t.duplicate) continue; // already on the books; nothing to do
    if (!t.date || !Number.isFinite(Number(t.amount)) || Number(t.amount) === 0) continue;
    const k = `${t.date}|${amountKey(t)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  }

  const pairs = [];
  const used = new Set();
  for (const indices of buckets.values()) {
    if (indices.length < 2) continue;
    // Greedy left-to-right pairing: take the first row and pair it with
    // the first later row of opposite sign.
    for (let a = 0; a < indices.length; a++) {
      const ai = indices[a];
      if (used.has(ai)) continue;
      const ta = previews[ai];
      for (let b = a + 1; b < indices.length; b++) {
        const bi = indices[b];
        if (used.has(bi)) continue;
        const tb = previews[bi];
        if (Math.sign(ta.amount) === Math.sign(tb.amount)) continue;
        // Different accounts, or one of them unassigned. If both are
        // unassigned, we still link them — many statements split a single
        // top-up across two rows for no reason.
        if (ta.account_id != null && tb.account_id != null && ta.account_id === tb.account_id)
          continue;
        if (Math.abs(Math.abs(ta.amount) - Math.abs(tb.amount)) > AMOUNT_EPSILON) continue;
        // Confidence: high when amounts match exactly AND descriptions share
        // a transfer-like keyword; medium when amounts match exactly; low
        // when amounts match but descriptions look unrelated.
        const conf = scoreConfidence(ta, tb);
        pairs.push({
          a_index: ai,
          b_index: bi,
          amount: Math.abs(ta.amount),
          date: ta.date,
          description: pickDescription(ta, tb),
          account_a: ta.account_id,
          account_b: tb.account_id,
          confidence: conf,
        });
        used.add(ai);
        used.add(bi);
        break;
      }
    }
  }
  return pairs;
}

const TRANSFER_HINTS = /transfer|top[- ]?up|umbuch|Überweisung|verrechnung|sepa|interaccount/i;

function pickDescription(a, b) {
  for (const t of [a, b]) {
    if (t.description && TRANSFER_HINTS.test(t.description)) return t.description;
  }
  return a.description || b.description || 'Transfer';
}

function scoreConfidence(a, b) {
  const aHint = a.description && TRANSFER_HINTS.test(a.description);
  const bHint = b.description && TRANSFER_HINTS.test(b.description);
  if (aHint && bHint) return 'high';
  if (aHint || bHint) return 'high';
  // Exact amount match without keyword hint — still plausible.
  return 'medium';
}

// Annotate a list of previews with a `transfer_pair_id` for each row that is
// part of a detected pair. The same token is shared by both sides so the
// importer can set `transfer_group` on confirm.
export function annotateWithTransferPairs(previews, accountId = null) {
  const pairs = detectTransferPairs(previews, accountId);
  const byIndex = new Map();
  for (const p of pairs) {
    const id = `xfer-${p.date}-${p.amount.toFixed(2)}-${p.a_index}-${p.b_index}`;
    byIndex.set(p.a_index, { id, other: p.b_index, confidence: p.confidence });
    byIndex.set(p.b_index, { id, other: p.a_index, confidence: p.confidence });
  }
  return previews.map((t, i) => {
    const m = byIndex.get(i);
    return m
      ? {
          ...t,
          transfer_pair_id: m.id,
          transfer_pair_other: m.other,
          transfer_pair_confidence: m.confidence,
        }
      : t;
  });
}
