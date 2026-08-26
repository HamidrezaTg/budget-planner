# Changelog

All notable changes to the Budget Planner are documented here.
The project follows semantic versioning (`MAJOR.MINOR.PATCH`).

## [3.7.0] — 2026-08-26

### Added
- **Debian package** (`scripts/build-deb.sh` → `dist/*.deb`): ships server + built
  client + production deps, systemd service with hardening as system user `budget`,
  data in `/var/lib/budget-planner` (kept on remove, deleted on purge)
- **Android APK build** (`scripts/build-apk.sh`): Capacitor native shell that loads
  the planner server over LAN/Tailscale; auto-bootstraps the Android SDK and JDK
  requirements documented in the README
- Full end-to-end workflow test (21 checks) covering import → rules → dashboard →
  rollover → income → recurrences → funds/goals → FX → snapshots → splits →
  attachments → balances → **backup/restore round-trip** → password change → exports

### Verified
- Unauthenticated access returns 401 on every API mount; PWA assets serve correctly
- Backup→restore survives the multer async-context pitfall (no user context leaks)

## [3.6.0] — 2026-08-26

### Added
- **Occurrence-indexed dedup fingerprints** — two genuinely different purchases on the
  same day with the same amount and merchant (e.g. two identical coffees) used to
  silently swallow each other on import; they now both import, while re-imports and
  overlapping exports still insert nothing twice (verified by a 16-case test suite)

### Fixed
- **CSV import was broken on current Node** — multer's async streaming escapes the
  auth-scoped database context, so every import failed with "No user database context".
  Import handlers now re-enter the user's database context explicitly.

### Decided
- Bank synchronization stays manual for now (user choice): hardened CSV import is the
  sync path; GoCardless PSD2 integration may be added later and remains on the roadmap.

## [3.5.0] — 2026-08-26

### Added
- **Scheduled month-end reports** — closed months with activity are snapshotted
  automatically (lazily, on first view; no external scheduler). Snapshots are frozen:
  later edits/deletions never rewrite history. Reports page gains a Month-end history
  chart + table of income/spend/planned/result per month.
- **Excel exports** — monthly workbook (Transactions + Summary sheets) and yearly
  workbook (Months + By category); raw statement amounts/currency codes, matching CSV.

## [3.4.0] — 2026-08-26

### Added
- **Multi-currency reporting** — transactions keep their statement currency; actual
  spending converts to the display currency per month via the new `fx_rates` table
- **Exchange-rate management** on Settings: manual month/currency rates plus one-click
  autofill of missing rates from frankfurter.app (ECB reference rates, keyless,
  privacy-safe — requests contain only dates and currency codes)
- Foreign-currency transactions without a rate count 1:1 and raise an
  "Exchange rates missing" insight until a rate is added

### Changed
- Recurring transactions post with the base (display) currency label instead of
  hardcoded EUR
- CSV exports explicitly keep original amounts/currency codes (documented)

### Fixed
- Yearly report now converts foreign-currency rows consistently with all other views

## [3.3.0] — 2026-08-26

### Added
- **Transaction attachments** — attach receipts/documents (PDF, PNG, JPEG, WebP,
  CSV; max 10 MB) via the paperclip control on Transactions; list, download,
  preview images inline, delete; files live under `data/uploads/<user>/`, never in git

### Fixed
- Fund goals whose target date has passed now raise an overdue **danger** insight
  instead of silently disappearing from the dashboard
- Goal months-left math unified between the Funds page and dashboard insights
  (inclusive of the current month)
- Insight cards now carry raw numbers; amounts render client-side so they follow
  the currency chosen in Settings
- Funds page refuses goal saves without a positive target amount instead of
  silently dropping the date
- Rollover "previous month had activity" check ignores split-parent rows
- In-app Help documents Recurring, splits, rollover, advanced rules, rule tester,
  insights, and attachments

## [3.2.0] — 2026-08-26

### Added
- **Dashboard insights** — generated alerts for review backlog, over-budget
  categories, current-month spending pace, fund-goal risk, and recurring items due
  within seven days
- **Installable PWA** — app manifest, branded icon, and network-first app-shell
  service worker; financial API responses are never cached
- **Advanced categorization rules** — description, absolute amount range, account,
  transaction type, priority, and a read-only rule tester

### Fixed
- Existing user databases now receive migrations for v3 feature columns.
- Recurring-form errors use the in-app toast instead of a browser alert.
- Fund goals can be created as well as edited from the Funds page.

## [2.0.0] — 2026-08-26

The complete rebuild of the original single-user planner into a multi-user,
household-grade budgeting system.

### Added
- **Multi-user with private databases** — username + password login; every user
  gets their own SQLite database; admin account manages users (add, reset
  password, delete) from a dedicated Users page
- **Household money model** — persons, multiple accounts (bank + spending card),
  category groups, per-month budget overrides, commitments with start/end months
- **Sinking funds** — monthly accrual with In/Out movement ledger; negative
  balances surfaced as warnings
- **96-month projection** — commitments drop out at end dates; free vs committed
  savings split; **re-anchoring reconciliation** against manually entered real
  bank balances
- **Actual income tracking** — per person/source, actual vs usual amounts
- **AI layer** (any OpenAI-compatible provider: OpenAI, Anthropic, OpenRouter,
  Groq, DeepSeek, Mistral, Together, Ollama, LM Studio, custom):
  - AI category suggestions with per-item / bulk (≥80% confidence) apply
  - AI file doctor — detects the format of arbitrary bank exports and converts
    them for import
  - Read-only finance chat over a strictly guarded SELECT-only SQL tool
  - Guarded dev-mode chat — whitelisted change proposals, human-readable diffs,
    explicit apply, full audit log
- **Data safety** — full database backup download, backup restore with
  validation, spending-data reset (keeps budget)
- **Settings** — light/dark theme, currency selection, password change
- **In-app Help** page documenting every page and button

### Import engine
- CSV/XLSX auto-detection (handles Revolut's ".csv that is actually Excel")
- Only COMPLETED rows import; pendings from previous months treated as
  completed; current-month pendings and REVERTED rows skipped
- Duplicate blocking via date+amount+description key
- Pre-confirm preview with per-row status

### Design
- "Clarity" theme: warm paper light mode + navy dark mode, navy sidebar with
  profile block, glyph navigation, collapsible menu, editorial serif headings
- Custom modals and toast notifications (no native browser dialogs)

### Fixed
- Timezone-shifting dates on XLSX import (Excel serials now converted in UTC)
- Stale-cache white screens (index.html never cached; hashed assets immutable)

## [1.0.0] — 2026-08 (pre-git, superseded by 2.0.0)

The original single-user planner. Its concepts live on inside 2.0.0:

- Revolut statement import (CSV/XLSX) with state filtering and dedupe
- Learning keyword categorization ("needs review" queue)
- Monthly budgets with spent-vs-plan tracking
- Per-category savings envelopes (predecessor of sinking funds)
- Monthly & yearly reports with CSV export
- Single password login on localhost:2026

Version 1 was fully rebuilt into 2.0.0; its code was not preserved as a
separate tag.
