# Changelog

All notable changes to the Budget Planner are documented here.
The project follows semantic versioning (`MAJOR.MINOR.PATCH`).

## [3.18.0] — 2026-09-01

### Added
- Per-account display currencies with monthly FX conversion for aggregate balances.
- Transient side-by-side forecast scenarios with monthly and one-off adjustments.
- Hashed, expiring read-only budget share links with revocation.
- Optional ntfy daily warning summaries for Android subscribers.

### Changed
- Account balances and transaction views now display their recorded/account currency.

## [3.17.0] — 2026-08-31

### Added
- ESLint and Prettier checks in CI, with server and client coverage reports.
- A live-server Playwright flow covering setup, import, review, and dashboard navigation.
- A static OpenAPI 3.1 contract covering the public and authenticated API operations.
- Optional Prometheus request metrics at `/metrics` when `METRICS_ENABLED=1`.
- Caddy HTTPS deployment guidance for secure remote access.

### Changed
- Moved the mobile Capacitor CLI to development dependencies so production audits remain clean.

## [3.16.0] — 2026-08-31

### Added
- Persistent privacy mode that blurs financial values without hiding navigation.
- Keyboard navigation shortcuts: `g+d`, `g+t`, `g+r`, and `?` for Help.
- Drag-and-drop statement import with remembered import account selection.
- Per-category monthly spending trends, month-over-month comparisons, and
  browser Print / PDF output on Reports.

## [3.15.0] — 2026-08-31

### Added
- Linux CI now verifies and retains the Tauri `.deb` and AppImage bundles as
  downloadable build artifacts.
- AUR package generation now produces `.SRCINFO` and builds the package in a
  clean Arch container during tagged release validation.
- [`docs/INSTALL_ARCH.md`](docs/INSTALL_ARCH.md) documents yay installation and
  the AppImage fallback for Arch Linux, Manjaro, and Omarchy.

## [3.14.0] — 2026-08-31

### Added
- Native Tauri **File**, **Edit**, **View**, and **Help** menus with platform
  shortcuts, including `Cmd+Q` on macOS.
- Sandboxed macOS bundle metadata and network entitlements for self-hosted LAN,
  Tailscale, and HTTPS server connections.
- Unsigned macOS DMG build/upload workflow and
  [`docs/INSTALL_MAC.md`](docs/INSTALL_MAC.md) installation guidance.

## [3.13.1] — 2026-08-31

### Fixed
- Added committed JavaScript and Rust lockfiles so clean CI and release builds
  use reproducible dependency resolution.
- Corrected Tauri configuration, native icon assets, Rust window navigation, and
  Linux artifact names for Debian, AppImage, and AUR consumers.
- CI now validates the Tauri client on Linux, macOS, and Windows, and the
  release workflow uses the Tauri client instead of the removed Electron shell.

## [3.13.0] — 2026-08-31

### Added
- **Tauri v2 desktop client** (`desktop-client-tauri/`) replacing the old
  Electron shell. A single Rust binary per platform, no Chromium runtime,
  with the same multi-server saved-URL picker as the Android shell.
- Shared picker helper (`mobile/www/shell-picker.js`) so the Android and
  desktop shells use identical storage keys, normalization, and
  discovery probing.
- New Tauri plugins wired in: `single-instance`, `window-state`,
  `autostart`, `log`, `os`, `updater`.
- AUR package for Arch/Manjaro/Omarchy in `packaging/aur/budget-planner-client/`.
- Build scripts: `scripts/build-tauri-client.sh` (deb + AppImage on Linux),
  native `tauri:build` commands for macOS/Windows, and `scripts/build-aur.sh`.
- CI matrix builds the Tauri shell on Linux, macOS, and Windows in addition to
  the server test/build job.

### Changed
- The `/.well-known/budget-planner` endpoint now also sets
  `Access-Control-Allow-Origin: *` so the desktop shell can verify
  reachability from a separate origin without CORS errors.
- Removed the `desktop-client/` Electron directory, its Debian
  packaging (`scripts/build-deb-client.sh`), and the now-redundant
  `packaging/client-control`, `packaging/client-postinst`, and
  `packaging/budget-planner-client.desktop`. The Tauri shell replaces
  all of them with a single Rust binary (<10 MB instead of ~110 MB).

## [3.12.0] — 2026-08-31

### Added
- **Accounts page** with create, edit, opening-balance, spending-pot, and guarded delete controls.
- **People management** for names used by income sources, including safe rename and delete.
- `GET /api/accounts` and `POST`/`PATCH`/`DELETE /api/accounts/:id` for account management.
- `GET /api/persons` and `POST`/`PATCH`/`DELETE /api/persons/:id` for person management.
- Self-service and admin username renaming. Existing databases, uploads, and sessions are handled safely.
- `/.well-known/budget-planner` discovery metadata for clients.
- Android saved-server list with discovery validation and a mobile server-switch action.

### Fixed
- Account and person partial updates no longer require unrelated fields.
- Username database-file moves close cached SQLite handles and roll back file changes if the master update fails.
- API request draining no longer deadlocks a rename request on itself.

## [3.11.0] — 2026-08-31

### Added (data model)
- `accounts.opening_balance` — per-account starting balance. Reflected in the
  projection's anchor and total predicted numbers, and in the per-account
  reconciliation view on Balances.
- `transactions.fund_id` — a transaction can now be paid from a sinking fund;
  the fund's running balance includes the linked transaction (negative for
  spend, positive for top-up).
- `transactions.transfer_group` — shared token across two rows that form a
  bank↔card transfer. Such rows are excluded from spend / income / category
  sums but DO count in per-account balances (a transfer moves money, doesn't
  change wealth).

### Added (server)
- `GET /api/balances` now returns `per_account`: each account's predicted
  balance at the current month, its latest observation, and the variance.
- `PATCH /api/balances/:id` and `DELETE /api/balances/:id` — set
  opening_balance / rename / change kind; refuse delete when the account
  still has transactions or observations.
- `PATCH /api/transactions/:id` and `POST /api/transactions` accept `fund_id`
  and `transfer_group`; the response includes `fund_name` and `transfer_group`.
- The importer detects candidate transfer pairs (same date, same absolute
  amount, opposite sign, different accounts) and tags both rows with a
  `transfer_group` once the user confirms. The detector is conservative —
  pairs with no transfer-like description and no account split are not
  flagged.
- The importer also folds imported rows into active recurrences (matching
  by name, signed amount, and account) so a real bank statement and a
  planned recurrence count as one expected transaction, not two. The
  recurrence's `last_posted_month` is advanced to the latest month it
  matched in this import.
- A new dashboard insight surfaces per-account variance > 5% so the user
  can re-anchor before drift compounds.

### Changed
- The model separates "total" (everything you own, including transfers)
  from "free" (the liquid portion above opening). The total is the
  per-account sum so transfers show up in the right place.

## [3.10.0] — 2026-08-30

### Added (client)
- **Funds**: "Add fund" form (name, start month, contribution, opening balance),
  inline delete with confirm, and tooltips on every action.
- **Categories & groups**: full CRUD on the Categories page. Add, rename, and
  delete both groups and categories from the UI. Inline edit row for
  categories (name, group, account, monthly budget, active flag). Rules
  sections preserved.
- **Transactions**: an "Add transaction" button opens a modal for manual
  single-entry (date, description, signed amount, currency, account, category,
  type). The server endpoint also accepts an array for bulk entry with
  same-request dedup.
- **Transactions**: an "Edit" button on already-categorized rows swaps the
  category chip for a category select + "remember" checkbox. Save reuses the
  existing PATCH endpoint.
- **Income, Commitments, Recurring, Balances, Settings, Users**: every
  button now has a descriptive `title=` (tooltip) and icon-only controls have
  matching `aria-label=`s.
- **Settings**: 2-column responsive card layout for the five sections
  (Appearance, Account, Data, AI connection, Exchange rates). Each section
  has a panel header, copy, and labelled controls.
- **Users**: split into three cards (your account summary, add user, user
  list) for clearer hierarchy.

### Added (server)
- `POST /api/transactions` — single or bulk manual entry with per-row
  validation (date format, description, signed amount, currency, account,
  category existence) and the same dedup rules as CSV import.
- `DELETE /api/categories/:id` — refused with 409 if any transaction still
  uses the category (directs the user to retire instead).
- `POST /api/categories/groups`, `PATCH /api/categories/groups/:id`,
  `DELETE /api/categories/groups/:id` — full CRUD for budget groups. Deleting
  a group leaves its categories ungrouped (ON DELETE SET NULL cascade).

## [3.9.2] — 2026-08-27

Full-project review outcomes (server, client, packaging, docs).

### Fixed (data integrity)
- **Username collision** — the legacy filename sanitizer collapsed distinct
  usernames ("a.b", "a!b" → "a_b") onto the SAME database file: the second
  user opened the first user's data. Filenames are now collision-free
  (`%XX` encoding), existing legacy files are renamed automatically on first
  open, and new usernames reject `.` and `-`.
- **Rollover accumulates** — underspend older than one month is no longer
  silently lost; the carry chain compounds (lookback capped at 24 months).
- **Settings** — the currency switch (which wipes FX rates) can no longer run
  before another field's validation fails; `model: 123` no longer 500s.
- **Category retirement** is validated first and applied in one transaction —
  a name conflict no longer leaves it retired with rules destroyed.
- **Import confirm** runs in a single transaction (large imports are orders of
  magnitude faster and can no longer half-apply).
- **Timezone off-by-one** — non-ISO statement dates ("Aug 27, 2026") parsed via
  `Date` no longer shift back a day on UTC+1/+2 machines (also fixed the
  resulting dedup keys).

### Fixed (client)
- **FX-rate delete** from Settings was broken (wrong `api.del` payload) — it
  always failed with 400.
- **"Show needs-review only"** toggle now actually refilters the list, and
  deep links (`?review=1`, `?month=`) react while the page is open.
- **Rollover toggle** displays the real state and can be turned off again
  (the budgets endpoint now returns `roll_overs`).
- **Editing a source's usual amount** no longer silently deletes that month's
  actual income entry.
- Clearing a commitment's end month works (`null` is no longer ignored).
- Transactions: newest request wins (no stale-response races), bulk-apply
  reports partial failures, modal focus trap ignores hidden file inputs,
  logout works offline.

### Fixed (server quality)
- FK index coverage: `transactions.split_of`, `attachments.transaction_id`,
  `sessions.username`, `fund_movements(fund_id, month)` — the transactions
  list no longer does per-row full scans.
- `PATCH /recurrences` and `PATCH /commitments` validate like their POST
  counterparts; clearing a commitment's end month is possible again.
- Monthly snapshot capture moved off the dashboard request path and logs
  failures instead of silently disabling itself.
- `fx/fetch` caps external calls at 60 per request and reports remaining work.
- Import staging eviction prefers the current user's oldest upload.

### Fixed (security)
- **CSV/Excel formula injection** — export cells starting with `=` `+` `-` `@`
  are neutralized.
- **Login timing** no longer enumerates usernames (unknown users get identical
  scrypt work); per-IP login bucket added; password change rate-limited.
- AI outbound calls have explicit timeouts.
- Electron client: runtime pinned (no longer "whatever npm view returns"),
  zip verified against official `SHASUMS256.txt`, server-redirect navigation
  guard, all permission requests denied.
- Android: cloud/device backups of app data disabled; `allowMixedContent`
  removed; debug-key APKs can no longer be produced under the release
  filename without an explicit opt-in.
- The installer fails hard (instead of warning) when checksums are missing or
  mismatched; the server deb always builds the client fresh; Electron client
  deb gets full X11/GTK dependency set and a `chrome-sandbox` SUID fix.
- `DATA_DIR` must be explicit for the CLI admin creator; all cwd-dependent
  path fallbacks removed.

## [3.9.1] — 2026-08-27

### Android app (major UX rework, verified on an emulator)
- The client shell now **auto-connects** to the saved server on launch —
  previously every launch showed the setup form again.
- **Recovery screen**: if the server is unreachable you get "Can't reach your
  server" with *Try again* and *Change server address*; changing servers no
  longer requires clearing app storage ("Forget this server" included).
- **Back button works**: back inside the planner walks in-app history instead
  of instantly exiting (Capacitor loads the server page without WebView
  history); back from the planner's first page returns to the connect screen.

### Mobile web layout (verified on an emulator against seeded data)
- **Sidebar → top app bar with hamburger drawer** on phones. Previously all 13
  nav links wrapped into five rows covering half the screen, and the "Local
  planner" box overlapped the theme toggle and profile.
- **Charts**: the projection chart shows ~8 x-axis labels instead of all 96
  months painting over each other into a black smear; Reports charts are
  capped at ~6.
- **Tables** scroll inside their card and never wrap mid-value ("2026-08"
  breaking across lines); the page itself can no longer scroll horizontally.
- **Forms** (e.g. Recurring) stack full-width on phones instead of clipping
  the amount placeholder.
- Transactions split/attachment dialogs now use a shared accessible modal
  (focus trap, Escape, ARIA labelling, focus restore).

### Security & robustness
- The **installer verifies downloaded artifacts** against the release's
  `SHA256SUMS.txt` before installing.
- **AI endpoints**: per-user rate limit (30/min), chat history capped
  (16 messages × 8,000 chars), `/dev-apply` capped at 50 proposals.
- **Attachments**: uploaded files verified against their declared mimetype via
  magic bytes before being stored.
- Every response carries an **`X-Request-Id`**, echoed in 5xx error logs.
- The packaged systemd unit now ships `UMask=0077`.
- Import preview lists **row-level parse errors** (row, reason, sample) instead
  of silently dropping unreadable rows; re-import regression covered.
- New XLSX export round-trip test; suite grew to 41 tests, all green.

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
  enforce the allowlist at execution time on supported runtimes, with a Node 22
  lexical fallback; row limits are capped.
- **Upload limits** — import uploads are capped at 64 MB (single file).
- **Parser resource limits** — CSV/XLSX imports are bounded to 100,000 rows, 256
  columns, 10 sheets, and 5,000,000 workbook cells.
- **Spreadsheet dependency** — replaced vulnerable `xlsx@0.18.5` with the
  API-compatible `@e965/xlsx@0.20.3` npm alias; high-severity audit is clean.
- **Recurrence auto-post reporting** — duplicate-safe re-attempts no longer count
  as newly posted items.
- **Import staging isolation** — staged import tokens are bound to their owning user.
- **First-run setup** — setup is limited to localhost unless `SETUP_TOKEN` is used.

### Fixed (packaging & installer)
- The desktop client `.deb` now stamps its Debian metadata version from
  `desktop-client/package.json` (fixes the filename-vs-metadata mismatch).
- The installer preserves `--client`, `--version` and `--quiet` across the sudo
  re-exec; it no longer requires Node to parse release JSON; assets are downloaded
  via the direct release URL.
- CI installs root and client dependencies before running tests and the client build.
- **Desktop client hardening** — sandbox enabled, navigation locked to the
  configured server origin, new windows denied (external links open in the system
  browser), and IPC requests validated against the app's own window.
- Mobile package metadata synced with the release version (3.9.0); the CI version
  check now covers root, desktop, and mobile.
- `scripts/build-apk.sh` builds a signed release APK when `BP_ANDROID_KEYSTORE`,
  `BP_ANDROID_KEYSTORE_PASSWORD` and `BP_ANDROID_KEY_ALIAS` are set, and a clearly
  labeled debug-key build otherwise; keystores are provided via environment only.
### Added
- Test suite (`npm test`, 31 tests at release) covering parser, DB integrity,
  projection, security, and an end-to-end HTTP flow.
- GitHub Actions CI: server tests, client build, dependency audit, version checks.
- `docs/IMPROVEMENT_PLAN.md` — the validated improvement plan this release implements.
- Unauthenticated `/healthz` liveness endpoint for systemd/uptime monitors.
- Startup diagnostics: orphaned foreign-key rows in legacy databases are reported
  via `PRAGMA foreign_key_check` on first open of each user database.

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
