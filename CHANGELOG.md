# Changelog

All notable changes to the Budget Planner are documented here.
The project follows semantic versioning (`MAJOR.MINOR.PATCH`).

## [3.9.0] — 2026-08-27

### Fixed (data integrity)
- **Split deletion** — deleting a split parent now removes its children (SQLite
  foreign-key enforcement is enabled on every database). Attachment files for the
  parent AND its children are deleted from disk.
- **Atomic restore** — backups are integrity-checked (`PRAGMA integrity_check`,
  `foreign_key_check`) before restore, applied via an atomic rename with a
  timestamped `.pre-restore-<ts>` snapshot, and rolled back if the database cannot
  be reopened. An interrupted restore can no longer truncate the live database.
- **Projection anchoring** — when the latest observed balance predates the forecast
  start month, the projection now rolls forward from the observed balance instead
  of silently ignoring the anchor.
- **Recurrence posting** — posting a future month no longer suppresses the current
  month's item; `last_posted_month` never moves backwards; month input is validated.
- **Import categorization** — account-scoped automation rules now match on import:
  categorization runs AFTER the selected account is assigned. Picking an account in
  the preview re-runs rules via `/api/import/preview`.
- **Import account selection** — an invalid account is now rejected explicitly; the
  silent "first Revolut account" fallback is gone.
- **Currency-aware dedup** — deduplication fingerprints include the transaction
  currency, so identical date/amount/description rows in different currencies no
  longer collide. Existing keys are migrated once (guarded by `PRAGMA user_version`).
- **Date parsing** — impossible dates (e.g. `31/31/2026`) are rejected instead of
  stored; MM/DD files like `05/31/2026` resolve via a validity-based fallback.
- **Number parsing** — German (`1.234,56`) and US (`1,234.56`) amounts, currency
  symbols and parenthesised negatives parse correctly.
- **Import staging cleanup** — uploaded files are deleted on confirm, on parse
  failure, on eviction, and stale uploads are swept on startup.
- **Dedup migration safety** — application-owned `rec|...` and `split|...` keys are
  preserved; normal-key migration is transactional and collision-safe.
- **Split part deletion** — direct deletion of a split child is rejected; undo the
  split from its parent instead.

### Fixed (security)
- **Login protection** — per-IP+username rate limiting (10/minute) with a generic
  error message; the setup endpoint is rate-limited too.
- **Password policy** — minimum raised to 8 characters for new and changed passwords.
- **Async password hashing** — scrypt no longer blocks the event loop.
- **Session lifecycle** — sessions expire server-side after 30 days; expired sessions
  are swept; changing your own password now invalidates every session.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` removed. CSP hash matches
  the built client's inline theme script.
- **Error handling** — centralized error middleware; no stack traces in production;
  clean JSON 404s for unknown API routes.
- **AI SQL allowlist** — the finance chat can only read budget tables; `settings`
  (AI API key) and internal audit tables are unreachable; SQLite authorizer checks
  enforce the allowlist at execution time and row limits are capped.
- **Upload limits** — import uploads are capped at 64 MB (single file).
- **Parser resource limits** — CSV/XLSX imports are bounded to 100,000 rows, 256
  columns, 10 sheets, and 5,000,000 workbook cells.
- **Import staging isolation** — staged import tokens are bound to their owning user.
- **First-run setup** — setup is limited to localhost unless `SETUP_TOKEN` is used.

### Fixed (packaging & installer)
- The desktop client `.deb` now stamps its Debian metadata version from
  `desktop-client/package.json` (fixes the filename-vs-metadata mismatch).
- The installer preserves `--client`, `--version` and `--quiet` across the sudo
  re-exec; it no longer requires Node to parse release JSON; assets are downloaded
  via the direct release URL.
- CI installs root and client dependencies before running tests and the client build.

### Added
- Test suite (`npm test`, 34 tests) covering parser, DB integrity,
  projection, security, import rules and an end-to-end HTTP flow.
- GitHub Actions CI: server tests, client build, dependency audit, version checks.
- `docs/IMPROVEMENT_PLAN.md` — the validated improvement plan this release implements.

### Removed
- Dead `client/src/pages/Savings.jsx` (referenced non-existent `/envelopes` routes).

## [3.8.0] — 2026-08-26

### Added
- **Client-only application architecture** — apps contain no backend and connect to
  a server running elsewhere (the user's choice for multi-device use)
- **Android APK** (`scripts/build-apk.sh`): pure Capacitor client; first launch asks
  for the server address, validates reachability, remembers it; cleartext HTTP enabled
  for LAN use. Built and verified (`dist/budget-planner-android.apk`).
- **Linux desktop client** (`scripts/build-deb-client.sh`): Electron shell with a
  connect-once setup screen, offline/lost-connection handling, and per-user server
  address in `~/.config/budget-planner-client/config.json`. Application-menu entry
  included.

### Changed
- The `budget-planner` Debian package remains the **server**; `budget-planner-client`
  is the desktop client — install the server on one machine, clients everywhere else.

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
