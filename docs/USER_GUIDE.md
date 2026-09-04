# User Guide

This is the complete end-user manual for Gulden. The same topics are
available as a searchable, public webpage at `/help`, so Help can be opened before
login and while the server is unavailable. Links below point to application pages
and are useful after signing in.

## How Gulden Works

Gulden has one server and many optional clients. The server stores the
databases and attachments. A browser, Android app, iOS shell, or desktop app only
connects to that server; it does not contain a second budget.

Each user has a separate SQLite database. The first account created during setup is
the administrator. Administrators can manage users, but users cannot see each
other's budgets.

The recommended operating loop is:

1. Set up accounts, categories, plans, and income.
2. Import statements or add transactions manually.
3. Review unknown transactions and transfer candidates.
4. Check Dashboard for variance, warnings, and upcoming events.
5. Enter actual income and observed account balances.
6. Use Projection and Reports to make decisions and preserve history.

## First Run and Sign In

On a fresh server, open the server URL in a browser. First-run setup is limited to
the server machine unless an operator intentionally configured `SETUP_TOKEN` for
remote setup.

1. Create a username and password. Passwords must have at least eight characters.
2. The first user becomes the administrator and receives a private database.
3. Sign in and follow the setup order in [Start here](#start-here).
4. To add other people, use **Admin → Users**. Each user receives an independent
   database and login.

If the server cannot be reached, the app shows a recovery screen. The offline cache
contains only the interface shell; it does not cache financial API data and does not
mean that accounts or data were deleted.

## Navigation and Working Month

The sidebar is grouped into Overview, Money in & out, Planning, Assistant, and,
for administrators, Admin. The Working month selector is shared by most pages and
is remembered in the browser.

- **Dashboard**: monthly summary and check-in.
- **Projection**: long-range forecast and temporary scenarios.
- **Reports**: history, charts, exports, and frozen month-end snapshots.
- **Import**: preview and confirm bank statements.
- **Transactions**: actual rows, review, transfers, splits, and attachments.
- **Scheduled**: expected monthly transactions.
- **Budgets**: monthly category plans.
- **Income**: income sources and monthly actuals.
- **Accounts**: bank accounts, currencies, opening balances, and people.
- **Funds**: sinking funds and goals.
- **Commitments**: dated obligations.
- **Balances**: observed account balances and reconciliation.
- **Categories**: groups and categories.
- **Rules**: keyword, advanced, and category-choice categorization rules.
- **AI Chat**: optional read-only questions and confirmed proposals.
- **Settings**: identity, display, currency, backups, sharing, notifications, and AI.
- **Help**: this guide.

Keyboard shortcuts are available when focus is not inside a form:

| Shortcut      | Destination  |
| ------------- | ------------ |
| `?`           | Help         |
| `g`, then `d` | Dashboard    |
| `g`, then `t` | Transactions |
| `g`, then `r` | Reports      |

The sidebar also provides collapse, mobile menu, theme, privacy blur, logout, and
native-client server switching controls.

## Start Here

### 1. Add accounts and opening balances

Open **Accounts** and create every place where money lives: bank accounts, cards,
cash, and other accounts. For each account:

- choose its type and currency;
- enter the real opening balance at the moment tracking starts;
- mark a spending pot when it represents a daily-spending account.

The opening balance is the starting point for account reconciliation and future
projection totals. Do not change it to correct a later transaction; use the actual
transaction or a balance observation instead.

### 2. Create categories and plans

Open **Categories** to create budget groups and categories. Assign a paying account
and then set standing plans in **Budgets**. Categories may be ungrouped or lack an
account, but the Dashboard warns because those rows cannot contribute to account
totals correctly.

Retiring a category stops it from receiving new plans or categorization rules and
clears its existing plan/rules. Historical transactions remain. Reactivate it when
it should be used again.

### 3. Add income and scheduled items

In **Income**, add income sources, usual amounts, and optional people. Enter actual
income for a month when it arrives; actual income overrides the usual amount in that
month's projection.

Use **Scheduled** for predictable monthly income or expenses. Use **Funds** for
irregular bills that need money accrued over time. Use **Commitments** for fixed
obligations with a start and end month.

## Dashboard

Dashboard follows the selected working month. Use the previous, Today, and next
controls to move between months.

- **Transfer to Revolut**: the amount of budget lines assigned to a spending account
  recognized as Revolut. It is a planning instruction, not an extra expense.
- **Income**: actual monthly income when entered; otherwise the usual income amount
  may be used as the projection fallback.
- **Planned / Actual spend**: plan compared with actual category spending. Refunds
  reduce the spending category rather than becoming unrelated income.
- **Month result**: planned minus actual across all groups, including Savings.
  Positive means actual spending is under plan.
- **Warnings**: unresolved transaction review, missing category/account assignments,
  missing exchange rates, and other data conditions that can affect totals.
- **Insights**: review backlog, over-budget categories, pace, fund goals, and
  recurring events due soon. Insight links open the relevant page and do not change
  data.
- **Group tables**: category totals grouped by budget block. Difference is planned
  minus actual; positive means under plan.

## Accounts and People

Accounts represent where money is held. An account has a name, type, currency,
opening balance, and optional spending-pot flag. Its currency controls opening
balances, observations, and running account balances.

Accounts cannot be deleted while transactions or balance observations reference
them. This prevents history from becoming detached silently.

People are names connected to income sources. Deleting a person preserves the income
source and clears only that connection.

## Categories

Categories are organized into groups and can have a paying account and standing
plan. Open **Rules** to determine how imported transactions are assigned.

- Assigning a category to a review row can learn a keyword rule.
- Learned rules can repair older matching rows retroactively.
- Unchecking "Remember" while editing a transaction removes the keyword rule that
  transaction taught — but never a rule you created manually in Rules or one
  still used by other transactions.
- Category choice rules cover keywords that may belong to several categories
  (for example "Amazon" → Household or Electronics). They never auto-assign:
  matching transactions wait in review and you pick one of the rule's candidate
  categories. Such rows are marked "choice rule" in the queue.
- The rules list can be searched and filtered by keyword, type, category, and
  enabled state; advanced and choice rules can be disabled and re-enabled.
- Advanced rules can combine description text, absolute amount range, account,
  transaction type, and priority.
- Higher-priority rules are checked first.
- The rule tester previews a result without writing data.
- Retiring a category clears its plan and associated rules.

## Budgets

Budgets define planned spending in the global display currency.

- **Standing plan** is the normal amount used by every month.
- **Plan for `<month>`** is a one-month override. Reset removes the override.
- **Account** identifies the account expected to pay the category.
- **Roll over underspend** carries qualifying unused plan into a later month.

Rollover does not create a negative amount for overspending. A category needs
qualifying activity for unused plan to be carried forward.

## Income

An income source can have a name, person, usual amount, active start month, active
end month, and monthly actual. The start and end months govern everything — there
is no separate recurring toggle. Leave the end month blank for income that
continues indefinitely.

- **Usual** is the amount projected for months without an actual entry.
- **Start month** is the first month in which the usual amount is projected.
- **End month** is the last month in which it is projected. This lets an old salary
  end while a separate future salary source starts later.
- **Actual** is the amount that really arrived in that month and overrides usual.

Outside a source's period its income counts as zero: the actual column is disabled,
an out-of-period actual write is refused, and any historical out-of-period entries
stay in the database but are not counted or shown.

Enter refunds as transactions according to their actual account movement; do not
inflate income just to make a spending category look correct.

## Importing Statements

Open **Import**, choose CSV/XLS/XLSX/PDF/JPG/PNG, and select the destination account. For CSV
files, choose **Reuse matching saved templates** or **Start fresh and ignore saved templates**.
Import is always preview-first:

1. Select or drop the statement.
2. For an unfamiliar format, optionally use **Analyze format with AI**.
3. Inspect detected columns, dates, signed amounts, currencies, statuses, invalid
   rows, duplicates, and transfer candidates.
4. Correct the account choice if necessary.
5. Press **Confirm import** only after reviewing the preview.

Reuse mode applies a saved mapping only when the CSV header signature matches exactly. Fresh mode
does not use any saved mapping, so an unfamiliar or ambiguous file can be sent through AI analysis
again. An AI-approved mapping is still saved after analysis for future reuse; nothing is imported
until the preview is confirmed.

Nothing is saved before confirmation. Standard handling includes:

- CSV, XLS, XLSX, PDF, JPG, and PNG statements;
- selectable PDF text extracted with Poppler;
- scanned PDF pages rasterized and OCR'd locally with Tesseract;
- JPG and PNG statement images OCR'd locally with Tesseract;
- real calendar-date and amount validation;
- completed rows;
- settled older pending rows treated as completed;
- current-month pending rows skipped;
- reverted rows skipped;
- invalid rows displayed with source row and reason;
- duplicate protection at the database level.

Duplicate fingerprints use date, signed amount, description, and an occurrence index
for legitimate identical same-day transactions. Re-importing an overlapping export
is safe in normal cases, although a bank changing merchant wording can still require
manual cleanup.

AI format analysis sends extracted statement text/rows, not PDF bytes, to the AI
provider configured by the user. The Import page also offers explicit online vision
OCR. That mode sends bounded PDF page renders or image bytes to the active provider;
choose local OCR when the statement must remain on this server. Verify the preview
even when the detected format looks correct. Debian packages keep OCR tools optional:
install `poppler-utils` for PDF support and `tesseract-ocr` for local scanned-PDF and
image OCR. Set `TESSERACT_LANG` when a local language pack is needed.

## Transactions

Use **Transactions** to maintain actual rows. Filter by month, paginate, or show
only transactions that need review.

- Assign a category to learn a keyword rule.
- Add, edit, or delete a manual transaction.
- Change account, category, fund, or commitment links.
- Request optional AI category suggestions and apply them individually, all at
  once, or only at confidence of 80% or higher.
- Split a purchase across multiple categories. Signed parts must sum to the parent;
  Unsplit restores the original.
- Attach PDF, PNG, JPEG, WebP, or CSV documents up to 10 MB.
- Download or delete an attachment individually.

Attachments live under the server uploads directory, outside the SQLite database.
Deleting a transaction deletes its attachments. See [Backups and restore](#backups-and-restore)
before migrating.

## Transfers

Transfers represent money moving between two accounts. They should not become income
or spending.

- Create a paired transfer manually.
- Choose candidate pairs during import.
- Pair equal-and-opposite existing transactions from different accounts.
- Mark a one-sided transfer as **Awaiting transfer** when its counterpart will be
  imported later. It is excluded from calculations and the review count until the
  other account is imported.
- Unpair a wrong match.
- Delete both sides together only when the movement should be removed entirely.

After review, the Dashboard's spending-account transfer guidance should reflect the
planned move without inflating the month's expenses.

## Scheduled Transactions

Create expected monthly income or expenses with a signed amount, day 1–28, account,
category, optional auto-post, and an optional schedule (start month, end month,
skip months).

- **Post now** creates the selected occurrence.
- **Auto-post** posts on the scheduled day.
- **Pause** retains the rule but stops posting.
- **Schedule** limits the item to its start/end months and skips months it must
  not post (a vacation pause, a cancelled month). Import folding respects the
  schedule too — a bank row for a skipped month is imported as a normal
  transaction instead of being folded in.
- **Split template** posts one split transaction across multiple categories.
- Posting is idempotent; repeating the same month does not create duplicates.

The Dashboard shows upcoming occurrences. A future-month post does not suppress the
current-month occurrence.

## Funds

Funds are sinking funds for irregular bills. A fund can have a start month, opening
balance, monthly contribution, goal amount, goal date, and linked transactions.

The balance combines the opening balance, contributions since the start month,
manual deposits, withdrawals, linked bills, and linked refunds. Use **In** for a
deposit and **Out** for a withdrawal. A negative fund balance is a warning that the
bill arrived before enough money was accrued.

Goals show progress, remaining amount per month, and whether the contribution is on
track. Overdue or underfunded goals can raise Dashboard warnings.

The Funds page shows contributions and balances for the selected working month.
Fund contributions reduce spendable cash in Projection but increase reserved fund
balances by the same amount. A fund is not a recurring category. When a linked bill
is recorded, it remains actual spending in its selected category and receives a
one-month category budget addition for that month.

## Commitments

Commitments model fixed dated obligations such as loans, instalments, or childcare.
Set a name, monthly amount, start month, end month, account, and optional category
or fund links.

Creating a commitment automatically creates a dated category in the Loans group.
That category is the commitment's budget source, so it is counted once rather than
being added again as a separate expense. The projection includes an active
commitment and stops charging it after its end month. This makes the future relief
from a finished obligation visible.

## Balances and Reconciliation

Open **Balances** and record the real observed balance for an account and month.
The month-by-month table shows the observed input, calculated balance, and variance
for every account, alongside the total variance.

Use the variance to investigate missing imports, incorrect opening balances,
uncategorized rows, unpaired transfers, or currency rates. A correct observation
re-anchors future projections so a one-time discrepancy does not compound silently.

Remove an observation only when it was entered incorrectly or is no longer useful.

## Projection

Projection shows a default 96-month forecast. Each month combines income, ordinary
category plans, dated Loan-category plans, fund allocations, free savings, committed
savings, and total balance.

Use the **Projection horizon** control above the What-if builder to change the
baseline forecast to any whole number from 1 to 240 months. Press **Update
projection**; this changes only the baseline and does not create a scenario.

- **Free savings** is accumulated surplus not assigned to future fund obligations.
- **Committed savings** is money already spoken for by sinking funds.
- **Fund allocations** are the monthly amounts moved from free cash into funds.
- Commitment end months stop future commitment charges.
- Actual income replaces usual income only for months with an actual entry.
- Balance observations anchor future totals to reality.

Create up to three temporary scenarios with monthly income/outgoing changes and
dated one-off amounts. Scenarios are comparisons only and never change saved plans.

## Reports and Month-End History

Reports includes monthly and yearly totals, category breakdowns, account filters,
month-over-month comparisons, category trends, charts, and browser Print/PDF.

CSV and XLSX exports preserve original statement amounts and currency codes. Summary
workbooks include transaction and summary/month/category sheets as appropriate.

When the app is opened after a month closes, an active month with activity can be
captured as a frozen month-end snapshot. This is triggered by app use, not a separate
background scheduler. A snapshot is not rewritten by later edits or deletions, so it
shows what the plan-versus-reality comparison looked like at that time.

## Multi-Currency

Transactions retain their statement currency. The global display currency is used
for budgets, funds, commitments, income, and aggregate reports. Each account keeps
its own currency for balances and observations.

Exchange rates are monthly and mean display-currency units per one foreign unit.
Enter rates manually or fetch missing ECB reference data through Frankfurter.
Missing rates count as 1:1 and produce a Dashboard warning. Changing the global
display currency clears rates relative to the old base; refetch afterwards.

Exports retain original amounts and currency codes.

## AI Chat

AI is optional and can use OpenAI-compatible hosted or local providers, including
9Router, OpenCode Zen, OpenRouter, Ollama, and LM Studio. Settings supports multiple
named profiles and an active-profile selector. Every user owns their own profiles;
only an administrator can share one of the administrator's profiles with selected
users. Recipients can use a shared profile but cannot see its API key or private URL.

- **Finance** is read-only. It can answer questions using permitted budget data but
  cannot alter the database.
- **Import analysis** proposes a file mapping that must still be reviewed.
- **Category suggestions** propose categories and confidence values.
- **Dev mode** creates changes from a fixed whitelist. Nothing is applied until the
  user presses Apply. It cannot execute raw SQL, delete data, or change authentication.

Configured providers receive only the data needed for the selected request. Review
provider privacy policies before using hosted AI with financial data.

## Settings

### Appearance and privacy

Choose `System`, `Light`, `Dark`, `Midnight`, or `Forest`, plus the global display
currency and privacy blur. The theme is saved per user on the server and follows
you to other signed-in devices. Privacy mode blurs values in the current browser;
it is not encryption and does not alter stored data.

### Identity

Change username with the current password. The private database, uploads, and active
session move with the account. Change password to invalidate existing sessions.

### Backups and restore

**Download full backup** downloads a ZIP containing the user's SQLite database
(budget data, settings, plans, transactions) plus every attachment file in an
`attachments/` folder.

**Restore backup** accepts that ZIP or a legacy bare `.db` file (attachments of a
legacy backup are not included — copy the matching `uploads/<username>/`
directory separately). It validates SQLite integrity, required tables, and
references. A pre-restore copy is created and a failed restore rolls back.
Attachment files from a ZIP are written only after the database swap succeeded.

For a complete server migration, use the release installer with
`--restore-server-data /path/to/server-data`. The source must contain `master.db` and
`users/` (plus optional `uploads/`). Every database is integrity-checked before the
service is stopped. The existing destination is retained as a timestamped
`.before-restore` directory and the validated data is installed with an atomic directory
swap. Do not use a single user's SQLite backup as a server-data restore source.

During an upgrade, choose **Network only** after selecting reconfigure if you only need
to change the listen address or port. This keeps the existing database and skips the
restore prompt. Full reconfiguration offers an explicit database choice: **Keep the
existing database** or **Restore a complete server-data directory**. A blank restore
source is no longer described as a fresh setup; it keeps existing data when the target
directory already contains `master.db` and `users/`.

**Reset spending data** removes transactions and attachments while retaining planning
configuration. Treat it as destructive and back up first.

### Read-only sharing

Create a month-specific, expiring share link. A recipient sees planned category/group
totals only. Transactions, balances, accounts, settings, and private identity are
not exposed. The token is shown when created, stored as a hash, and can be revoked.

### Notifications

Configure an ntfy server and topic, then subscribe to that topic in the ntfy app.
The server sends at most one daily warning/danger summary and retries a failed
delivery later. The configured ntfy server receives the notification content.

## Administration

Administrators use **Admin → Users** to create users, reset passwords, rename users,
and delete another user with that user's private database. Regular users do not see
the Admin route.

Debian packages also provide `sudo gulden`. Use `gulden status` and
`gulden doctor` for service checks, `gulden users list` for account
status, and `gulden users disable USERNAME` or `enable USERNAME` to control
login without deleting data. `gulden backup create` snapshots the complete
server data; `backup restore` validates the source and requires explicit confirmation.

Filesystem access to the server data directory is equivalent to access to the
financial data. Protect the host, service account, backups, and reverse proxy.

## Connecting Clients Safely

The web server speaks HTTP directly for localhost and trusted private networks. For
public or untrusted networks, use HTTPS through Caddy or another reverse proxy and
set `SECURE_COOKIE=1` and `TRUST_PROXY=1`.

Native Android currently accepts both HTTP and HTTPS. Use HTTP only on a trusted
LAN or trusted Tailscale network, for example `http://192.168.1.20:2026` or
`http://100.x.y.z:2026`; the Android picker warns before saving an HTTP address.
Use HTTPS on public Wi-Fi or any network where another device may inspect or alter
traffic. An HTTPS Tailscale DNS hostname or HTTPS reverse proxy is recommended.

Desktop clients may use trusted LAN HTTP, but HTTPS is recommended outside a private
network. All native clients are clients only and do not contain the server database.

See [Mobile Clients](MOBILE_CLIENTS.md), [Desktop Client](DESKTOP_CLIENT.md),
[HTTPS With Caddy](HTTPS_CADDY.md), and [Troubleshooting](TROUBLESHOOTING.md).

## Troubleshooting Checklist

1. Confirm the device opens the complete server URL in its browser.
2. Confirm the working month is the month you intended to inspect.
3. Check server status, bind address, port, firewall, Wi-Fi client isolation, and
   Tailscale membership.
4. Check transaction review, duplicate/invalid import rows, transfer pairing,
   account/category assignments, opening balances, and exchange-rate warnings.
5. If two devices show different users or data, compare numeric server IPs; they are
   likely connected to different servers.
6. For server errors, keep the `X-Request-Id` response header and match it to the
   service log. Never share passwords, API keys, database files, or private backups.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for commands and deployment-specific
diagnosis.
