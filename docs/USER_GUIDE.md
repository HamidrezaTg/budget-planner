# User Guide

Every page, button and section explained. Open the in-app **Help** page for the
same content while using the app.

---

## First run
On a fresh install, account creation is limited to the server's own machine
(localhost) unless a `SETUP_TOKEN` was configured — see the README's
Configuration table.

1. Open http://localhost:2026
2. Create the first account (username + password). Each account gets its own
   private database, pre-seeded with the household structure.
3. More accounts: log in as an admin and use **Admin → Users** in the sidebar.

Passwords must be at least **8 characters**.

---

## Sidebar

| Section | Pages |
|---|---|
| Overview | Dashboard, Projection, Reports |
| Money in & out | Import, Transactions, Recurring, Budgets, Income |
| Planning | Accounts, Funds, Commitments, Balances, Categories |
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
- **Duplicate protection** — re-importing the same file, or any export with overlapping
  date ranges, never creates a second copy: rows are fingerprinted by
  date + amount + description (plus an occurrence index for legitimate same-day twins,
  e.g. two identical coffees) and the database itself refuses duplicate fingerprints.
  The preview shows exactly which rows count as duplicates before you confirm.
- **Rows that cannot be read** (bad date, unparseable amount, missing description)
  are listed in the preview with row number and reason instead of being silently
  dropped — fix or ignore them deliberately.
  Limitations: a bank that changes the merchant *wording* between statements can still
  slip past the fingerprint; same-day twins split across two different exports may
  occasionally collide.

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
- **Attachments** — attach receipts/documents (PDF, PNG, JPEG, WebP, CSV; max 10 MB) to
  any transaction via the paperclip button. Files are stored under `data/uploads` on
  this machine and deleted with their transaction or individually.
  Note: the Settings **backup downloads the database only** — attachment files must be
  copied from `data/uploads/<username>/` separately when migrating to a new server.

## Budgets

- **Standing plan** — the normal monthly amount, used by every month.
- **Plan for \<month\>** — a one-month override (row gets an amber marker; ↺ removes it).
- **Account** — which account the category is paid from. Every category should have
  one; untagged categories are flagged on the Dashboard.

## Accounts

Manage the places where money lives: bank accounts, cards, cash, and spending pots.

- **Opening balance** — the real balance when you start using the planner. It is the
  starting point for per-account reconciliation and projection totals.
- **Currency** — the currency used for this account's opening balance, observations,
  and running balance. Choose EUR, USD, GBP, or CHF.
- **Edit** — rename the account, change its type, update the opening balance, or mark
  it as a spending pot.
- **Delete** — only succeeds when no transactions or balance observations reference
  the account; nothing is silently detached.
- **People** — the same page manages names used by income sources. Deleting a person
  leaves the income source and clears only its person link.

## Income

- **Usual** — the recurring amount the projection uses when a month has no actual entry.
- **Enter actual** — the real figure for that month. Actual income is always entered,
  never assumed.

## Recurring

Expected monthly transactions — rent, subscriptions, salary. They appear in the
Upcoming panel on the Dashboard.

- **Post now** — creates the real transaction for a month. Posting is idempotent:
  posting the same month twice creates nothing the second time.
- **auto-post** — posts itself on its day each month.
- **Pause** (edit) — keep the rule but stop it from posting.
- **Split template** — divide one recurring payment across two or more categories.
  The part amounts must add up to the signed recurrence amount; posting creates one
  split transaction with those category allocations.
- A future-month post never suppresses the current month's item, and the posting
  pointer never moves backwards.

## Funds (sinking funds)

For irregular bills: accrue monthly, withdraw when the bill lands.

- **Balance** = opening balance + monthly contribution × months since start +
  recorded movements + linked transactions. Contributions accrue automatically;
  manual deposits (**In**), withdrawals (**Out**), linked bills, and linked refunds
  all affect the same balance.
- A **negative balance is a warning, not an error** — the bill arrived early.
- **Goals** — set a target amount and optional date; the page shows progress, what is
  still needed per month, and whether you are on track. Overdue goals raise a danger
  card on the Dashboard.

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

- **Scenarios** — compare up to three transient alternatives with monthly income or
  outgoing changes and dated one-off amounts. Scenarios never change your saved budget.

## AI Chat

- **Finance (read-only)** — ask anything about your data. The AI can only run
  strictly read-only SELECT queries; it cannot change anything.
- **Dev mode** — proposes changes from a fixed whitelist (budgets, rules, categories,
  commitments, funds, income, balance anchors). Each proposal is shown as a plain
  sentence; **nothing is applied until you press Apply**. No raw SQL, no deletions,
  no auth changes — by construction. Every proposal and application is audit-logged.

## Settings

### AI assistant
Provider → API key → **Load models** → pick a model → Save → Test connection.
Supported: OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, Together AI,
Ollama (local, no key), LM Studio (local, no key), Custom.

### Backup & restore
- **Download full backup** — one SQLite file containing this user's entire budget.
  Do it before upgrades; it is your migration path to a new server.
- **Restore backup** — upload a downloaded backup. It is validated (SQLite
  integrity, required tables, broken references) and the current database is
  snapshotted before the swap; a failed restore rolls back automatically.
- **Danger zone: reset** — deletes all transactions and attachments, keeps
  budgets, rules, funds and income sources.

### Read-only sharing

Create a month-specific link in the Data section. The link shows planned category
amounts only, expires automatically, and can be revoked at any time. The raw token
is shown only when it is created; the server stores only its hash.

### Android notifications

Configure an ntfy server and topic in Settings, then subscribe to that topic in the
ntfy Android app. When enabled, the server sends at most one daily summary of new
warning or danger insights, and retries on a later sweep if delivery fails.

### Username
Change your username from the Identity section. The current password is required;
the private database, uploads, and the active session move with the account. Admins
can rename other users from **Admin → Users**.

### Password & theme
Change your password (invalidates all sessions) and switch light/dark.

### Multi-currency

Transactions keep the currency they were recorded in (from your statements). Each account
has its own display currency, while budgets and aggregate reports use the global currency
chosen under Appearance:

- Budgets, funds, commitments and income are planning figures and always live in the global
  display currency.
- Account balances and observations stay in the account's display currency.
- Actual spending converts per month via an **exchange rates** table: rate = display
  units per 1 foreign unit, applied by transaction month. Aggregate balances convert each
  account through the same monthly table.
- **Fetch missing from ECB** imports monthly reference rates from frankfurter.app
  (ECB data, keyless — requests contain only dates and currency codes).
- You can also enter or correct any month/currency rate manually.
- Foreign-currency transactions without a rate count 1:1 and raise an
  "Exchange rates missing" warning on the Dashboard until you add one.
- Changing the display currency clears all stored rates (they were relative to the
  old base) — refetch afterwards.
- CSV exports always contain the original statement amounts and currency codes.

## Reports

Monthly and yearly overviews: totals, per-category breakdowns, income vs expenses
chart, and CSV/XLSX downloads. Exports keep the original statement amounts and
currency codes.

- **Month-end history** — closed months are automatically snapshotted the first time
  you open the app after they end. Snapshots are frozen forever: later edits or
  deletions never rewrite them, so the chart shows budget accuracy as it actually was.
  Months appear only if they had activity.
- **Excel exports** — monthly workbook contains a Transactions sheet and a Summary
  sheet; yearly workbook contains Months and By-category sheets.

### Scheduled reports

The month-end snapshots above are the scheduler: nothing to configure, no external
service, nothing leaves this machine. They exist so that restated numbers can never
hide what actually happened.

## Categories

- **Categorization rules** — keyword rules are learned from manual assignments.
- **Advanced rule** — combine description, absolute amount range, account, transaction
  type, and priority. Rules with higher priority are checked first.
- **Rule tester** — preview the category for a sample transaction. Testing never writes
  data.

Group, account, standing plan, active/retired. **Retire** clears the plan and rules
so retired categories can't silently collect money. Rules list shows learned keyword
mappings; add or delete manually if needed.
