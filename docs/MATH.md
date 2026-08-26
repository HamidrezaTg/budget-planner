# The Math Behind the Numbers

Every figure the app produces, defined exactly. All money values are EUR.

## Conventions

- **Month** is `YYYY-MM`. Comparisons are lexicographic (`2026-08 < 2026-09`), which
  is safe for zero-padded months.
- **Transaction amounts are signed**: negative = money out, positive = money in
  (a refund or credit).
- **Actual cost is net of refunds**: for a category,
  `actual = −(sum of all transaction amounts in that category that month)`.
  A −50 purchase and a +50 refund cancel to 0. This is deliberate: a budget cares
  about net cost, not gross flow. (Carried over from the Excel system, column D.)

## Budget figures (per month M)

```
planned(c, M) = budget_lines[c, M]              if an override exists
              = categories.monthly_budget[c]    otherwise
              = 0                               if c is inactive or outside its active window

actual(c, M)  = −Σ transactions.amount  where category = c and month(t) = M

difference(c, M) = planned(c, M) − actual(c, M)      positive → under budget

group totals   = Σ over categories in the group
planned_total  = Σ over ALL categories (all 7 groups, Savings included)
actual_total   = Σ over ALL categories
month_result   = planned_total − actual_total
```

The month result covers **all** groups by construction (it is a sum over the category
list, not a hand-maintained formula) — this eliminates the old defect where the
Savings block was silently dropped from totals.

## Transfer to Revolut (month M)

```
transfer(M) = Σ planned(c, M)   over all categories c whose account is Revolut
```

Everything tagged Revolut is day-to-day variable spending funded by one monthly
transfer; everything tagged to the bank account(s) leaves by direct debit without touching the card.

## Sinking funds

```
balance(f, M) = opening_balance(f)
              + monthly_contribution(f) × (months between start_month(f) and M, inclusive)
              + Σ fund_movements.amount(f, month ≤ M)      (withdrawals are negative)
```

- Contributions accrue automatically; only withdrawals are recorded by hand.
- The balance is **not clamped at zero**. A withdrawal larger than the balance
  produces a negative running balance — a legitimate early-bill warning.
- Funds with a start month simply don't accrue before it.

## Projection (from month F, horizon N)

For each month M = F … F+N−1:

```
income(M)  = Σ over income sources s:
               income_entries[s, M]        if an actual entry exists
             = sources.current_amount[s]   if the source is recurring
             = 0                           otherwise (one-off sources without entry)

commitments(M) = Σ commitments.monthly_amount  over commitments where
                 start_month ≤ M AND (end_month is NULL OR M ≤ end_month)

variable(M)    = Σ planned(c, M)  over categories NOT linked to any commitment
                 (avoids double counting — e.g. the car-loan commitment already
                  represents the Vehicle budget)

outgoings(M)   = commitments(M) + variable(M)
net(M)         = income(M) − outgoings(M)
```

Running balances:

```
free(M)      = free(M−1) + net(M)          free(·) starts at 0
committed(M) = Σ balance(f, M) over all funds
total(M)     = free(M) + committed(M)
```

`free` is spendable surplus; `committed` is money already earmarked for future bills.

### Re-anchoring (why you can trust the long horizon)

Small model errors would otherwise compound for 96 months. So:

1. When you record an observed balance for month A (summed over accounts),
   the projection finds the predicted total at A:
   `predicted(A) = free(A) + committed(A)`
2. It computes the one-off drift: `variance = predicted(A) − observed(A)`
3. It absorbs the drift at A: `free(A) ← free(A) + net(A) − variance`,
   so `total(A)` now equals exactly what the bank says.
4. All later months continue from the corrected value.

The variance is displayed as a discrete, explained number at the anchor month
instead of silently smearing into every future figure.

## Import rules

```
dedup_key = ISO_date | amount(2dp) | lowercase-collapsed description
```

- A row is skipped if its dedup_key already exists → overlapping statements are safe.
- `State = REVERTED` → skipped.
- `State = PENDING` and date ≥ first of current month → skipped (it may still change);
  `State = PENDING` and date in a previous month → imported as completed.

## Categorization rules

```
normalize(d) = lowercase(d), collapse whitespace
match(d)     = exact rule where keyword = normalize(d)
             → else longest rule whose keyword is a substring of normalize(d)
```

Assigning a category with "remember" inserts `normalize(description) → category`
and retro-applies it to all `needs_review` transactions whose normalized description
contains the keyword.

## AI guardrails

- Finance chat: single `SELECT`/`WITH` statement only; forbidden keywords
  (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA, …) rejected anywhere
  in the query; multiple statements rejected; `LIMIT 500` appended if absent.
- Dev mode: the model can only emit one of 12 whitelisted proposal types. Each is
  validated server-side (names resolved to ids, amounts and months checked), shown
  to you, applied only on confirmation, and written to `ai_audit_log`.
```
