# User Guide

Every page, button and section explained. Open the in-app **Help** page for the
same content while using the app.

---

## First run

1. Open http://localhost:2026
2. Create the first account (username + password). Each account gets its own
   private database, pre-seeded with the household structure.
3. More accounts: log in, press **Add user** at the bottom of the sidebar.

---

## Sidebar

| Section | Pages |
|---|---|
| Overview | Dashboard, Projection, Reports |
| Money in & out | Import, Transactions, Recurring, Budgets, Income |
| Planning | Funds, Commitments, Balances, Categories |
| Assistant | AI Chat, Settings, Help |

---

## Dashboard

The month at a glance. Use **← / Today / →** to change months — every figure follows.

- **Transfer to Revolut** — the amount to move from your bank account(s) to your spending card this month:
  the sum of all budget lines tagged Revolut. This is the number the whole system
  exists to produce.
- **Income (actual)** — real income entered on the Income page.
- **Planned / Actual spend** — budget vs. reality. Actual is *net of refunds*: a
  refund reduces the spend of its own category instead of counting as income.
- **Month result** — planned − actual across all seven groups (including Savings).
  Positive = under budget overall.
- **Warnings** — categories without an account (their spending vanishes from account
  totals) and transactions still needing review.
- **Insights** — generated cards flag transactions needing review, categories over plan,
  spending ahead of the current month's pace, fund goals needing higher contributions,
  and recurring items due within seven days. The action on each card opens the relevant
  page; the alert count beside the month selector counts the current cards.
- **Group tables** — one table per block (Housing, Food, …). *Difference* =
  planned − actual per category.

## Import

- **Choose CSV / XLSX file** — standard path for Revolut exports. Handles the
  ".csv file that is secretly Excel" quirk. Only COMPLETED rows import; pendings
  dated in previous months are treated as completed (they settled but the bank
  didn't relabel them); current-month pendings and REVERTED rows are skipped.
  Duplicates (same date + amount + description) are blocked — re-uploading
  overlapping statements is safe.
- **Analyze format with AI** — for exports from other banks. The AI reads the raw
  file, detects the column layout, date format, decimal style and cancellation
  rows, and converts everything to the standard schema. You see the full preview
  (and what the AI detected) before anything is written.
- **Import into account** — which account the statement belongs to.
- **Confirm import** — the only step that writes to the database.

## Transactions

- **Month filter** and **Show needs-review only**.
- **Assign category…** — pick a category for an unknown merchant. This
  automatically creates a *keyword rule*: future transactions containing that name
  are categorized instantly, and older unmatched rows with the same name are fixed
  retroactively.
- **Suggest categories with AI** — the AI proposes a category + confidence for every
  pending row.
- **Apply all** / **Apply ≥80%** — accept every suggestion, or only confident ones.
  Applied suggestions become learned rules too.
- **Split** — divide one purchase across two or more categories. The parts must add up
  to the original amount. **Unsplit** removes the parts and restores the original.

## Budgets

- **Standing plan** — the normal monthly amount, used by every month.
- **Plan for \<month\>** — a one-month override (row gets an amber marker; ↺ removes it).
- **Account** — which account the category is paid from. Every category should have
  one; untagged categories are flagged on the Dashboard.

## Income

- **Usual** — the recurring amount the projection uses when a month has no actual entry.
- **Enter actual** — the real figure for that month. Actual income is always entered,
  never assumed.

## Funds (sinking funds)

For irregular bills: accrue monthly, withdraw when the bill lands.

- **Balance** = opening balance + monthly contribution × months since start +
  recorded movements. Contributions accrue automatically — you only record
  withdrawals (**Out**) when a bill actually arrives, and occasional extra deposits (**In**).
- A **negative balance is a warning, not an error** — the bill arrived early.

## Commitments

Fixed dated obligations (loans, instalments, kindergarten). Name, monthly amount,
start month, end month. When a commitment passes its end month the projection stops
charging it — you watch the burden decrease over time. Edit end months inline.

## Balances

- **Record** — type the real bank balance for an account and month.
- The projection compares its prediction with your entry, shows the **variance**
  as a discrete explained figure, then **re-anchors**: future months continue from
  reality, so errors never compound silently.

## Projection

96 months forward. Outgoings each month = active commitments + category plans not
already covered by a commitment (no double counting). Income = usual amounts unless
a month has an actual entry. Shows free vs committed savings and predicted total
balance per month.

## AI Chat

- **Finance (read-only)** — ask anything about your data. The AI can only run
  strictly read-only SELECT queries; it cannot change anything.
- **Dev mode** — proposes changes from a fixed whitelist (budgets, rules, categories,
  commitments, funds, income, balance anchors). Each proposal is shown as a plain
  sentence; **nothing is applied until you press Apply**. No raw SQL, no deletions,
  no auth changes — by construction. Every proposal and application is audit-logged.

## Settings

Provider → API key → **Load models** → pick a model → Save → Test connection.
Supported: OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, Together AI,
Ollama (local, no key), LM Studio (local, no key), Custom.

## Categories

- **Categorization rules** — keyword rules are learned from manual assignments.
- **Advanced rule** — combine description, absolute amount range, account, transaction
  type, and priority. Rules with higher priority are checked first.
- **Rule tester** — preview the category for a sample transaction. Testing never writes
  data.

Group, account, standing plan, active/retired. **Retire** clears the plan and rules
so retired categories can't silently collect money. Rules list shows learned keyword
mappings; add or delete manually if needed.
