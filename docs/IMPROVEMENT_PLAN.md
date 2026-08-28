# Improvement Plan — Budget Planner

> Status: active implementation plan, validated against the current codebase
> (v3.9.2). Updated 2026-08-28.

## Current Progress

**v3.9.2 is published** (https://github.com/HamidrezaTg/budget-planner/releases/tag/v3.9.2)
with server `.deb`, client `.deb`, signed APK and CI-generated `SHA256SUMS.txt`,
all publicly downloadable. The release was cut by the new tag-triggered release
workflow (its first run, after two pipeline bugs were fixed by dogfooding it).

- Verification: 43/43 tests, client build, shellcheck clean, packaging smoke
  (deb from clean checkout), client + root dependency audits — all green in CI.
- A full four-way project review (server, client, packaging/CI, docs) was
  completed; all HIGH and MEDIUM findings are fixed and released. LOW findings
  and expansion ideas are recorded under "Remaining Work" below.

### 2026-08-27 Full-Project Review (released in v3.9.2)

Data integrity:
- Username → database-file collision closed ("a.b"/"a!b" collided with
  "a_b" — cross-user data bleed). Collision-free encoding, automatic legacy
  file rename on first open, new usernames reject `.` and `-`.
- Budget rollover now accumulates across months (previously underspend older
  than one month silently vanished); lookback capped at 24 months.
- Settings PUT validates everything before the FX-rate wipe; category
  retirement validates first and applies in one transaction.
- Import confirm runs in a single transaction (large imports are far faster
  and can no longer half-apply).
- Timezone off-by-one fixed for non-ISO statement dates (UTC+1/+2 machines).

Client:
- FX-rate delete (broken payload), needs-review toggle (dead state), rollover
  toggle (always "off"/always re-enabled), income usual-amount edit silently
  deleting the month's actual entry, commitment end-month clearing — all fixed.
- Transactions: newest-request-wins guard, bulk-apply failure reporting,
  modal focus trap ignores hidden inputs, logout works offline.

Server quality:
- FK indexes (split_of, attachments.transaction_id, sessions.username,
  fund_movements); monthly snapshot capture off the request path with logged
  failures; fx/fetch capped at 60 external calls per request; PATCH endpoints
  validate like POST; staging eviction prefers the current user's uploads.

Security:
- CSV/Excel formula injection neutralized in exports; login timing no longer
  enumerates usernames; per-IP login bucket; password-change rate limit;
  AI outbound timeouts; Electron runtime pinned + SHASUMS-verified,
  will-redirect guard, all permission requests denied; Android cloud/device
  backups disabled, debug-key APK can no longer use the release filename;
  installer fails hard on missing/mismatched checksums; server deb always
  builds the client fresh; Electron deb gets the full X11/GTK dependency set
  and a chrome-sandbox SUID fix; `DATA_DIR` required for the CLI admin
  creator (the silent wrong-directory trap).

Docs:
- Obsolete "clear app storage" advice replaced everywhere with the recovery
  screen flow; MATH.md corrected (AI row limit 200, dedup formula with
  currency + occurrence index, FX conversion, re-anchor formula); USER_GUIDE
  gained Recurring and Settings backup/restore sections; CHANGELOG 3.9.0/3.9.1
  duplication removed; 3.9.2 section added.

CI/release:
- shellcheck on all scripts, packaging smoke job, client dependency audit,
  timeouts/concurrency/permissions; tag-triggered release workflow that
  builds debs, generates checksums, and publishes (APK when signing secrets
  are configured).

### 2026-08-27 Progress Log

- Fixed the currency-aware dedup migration so application-owned `rec|...` and
  `split|...` keys are preserved; normal-key rewrites are transactional and
  collision-safe.
- Split parts can no longer be deleted directly; users must undo the split from
  its parent. Parent deletion still cascades to children and attachment metadata.
- Enforced the AI SQL table allowlist at execution time with SQLite's authorizer,
  including comma-join queries; write/DDL/PRAGMA/extension operations are denied.
  Added a Node 22-compatible lexical fallback because `setAuthorizer` is only
  available in newer Node runtimes.
- Bound staged import tokens to the authenticated username.
- Restricted first-run setup to loopback requests unless `SETUP_TOKEN` is supplied
  in the `X-Setup-Token` header.
- Hardened restore snapshots with a WAL checkpoint, mandatory pre-restore copy,
  and rename-based rollback.
- Added bounded import parsing: 64 MB files, 100,000 rows, 256 columns, 10 sheets,
  and 5,000,000 workbook cells maximum.
- Replaced vulnerable `xlsx@0.18.5` with the API-compatible `@e965/xlsx@0.20.3`
  npm alias; dependency audit is now clean.
- Added an XLSX compatibility fixture and regression coverage for these paths; the suite increased from 31 to 37 tests.
- Added an unauthenticated `/healthz` probe and per-open `PRAGMA foreign_key_check`
  diagnostics that log orphaned legacy rows with repair guidance.
- Hardened the Electron shell: sandbox enabled, same-origin navigation lock-in,
  denied window.open (external origins go through `shell.openExternal`), and
  IPC sender validation.
- Fixed recurrence auto-post counting: re-attempts that hit the dedup key no
  longer report `autoPosted: 1`; only actual inserts count. Regression tests now
  cover recurrence idempotency and future-post semantics.
- Added restore regression coverage: garbage files, non-budget SQLite databases,
  and a full backup→restore round trip preserving live data.
- Restricted process umask (0077) and chmod'ed DATA_DIR, user DB, and upload
  directories to owner-only; file creation is now private by default.
- Synced the mobile package metadata to 3.9.0 and extended the CI version check
  to root/desktop/mobile.
- Added opt-in Android release signing: `build-apk.sh` builds a signed release
  APK when `BP_ANDROID_KEYSTORE*` environment variables are present and falls
  back to a clearly labeled debug-key build otherwise; gradle reads signing from
  the same environment so keystores never enter git.
- Fresh-install smoke test of v3.9.0 from the public release passed (installer,
  systemd hardening, healthz, headers, setup lockout, data-dir permissions).
- Installer now downloads SHA256SUMS.txt and verifies the artifact checksum
  before `apt-get install`; older releases without sums degrade to a warning.
- AI endpoints: per-user rate limit (30/min), client-supplied history capped
  (16 messages, 8,000 chars each), `/dev-apply` capped at 50 proposals.
- Attachments: uploaded bytes are now verified against the declared mimetype
  via magic bytes (CSV must be text) before storing.
- Every response carries an `X-Request-Id`; 5xx error logs include it, so a
  user-reported id maps to a journalctl line.
- Added a re-import regression test: two identical rows in one file both
  import; re-importing the same file inserts nothing.
- Extracted a reusable accessible `Modal` (focus trap, Escape, aria labels,
  focus restore) and rebuilt the Transactions split/attachment dialogs on it;
  split form controls now carry labels.
- Import preview and confirm return row-level parse errors (row number,
  reason, sample value, capped at 50); the import page lists them in a warning
  box instead of silently dropping rows.
- Added an XLSX export round-trip integration test through the maintained
  spreadsheet package.
- Reworked the Android client shell after emulator testing exposed four real
  defects: no auto-connect on relaunch, raw connection errors with no recovery
  path, changing a server requiring app-storage clearing, and the back button
  exiting the app instantly (Capacitor loads the server page without WebView
  history). The shell now auto-connects, shows a recovery view, offers
  "Forget this server", and back walks in-app history or returns to the
  connect screen. All states verified with screenshots on an Android 15
  emulator against a live server.
- Reworked the phone layout of the web client (found via the user's phone
  screenshots, verified on the emulator with seeded data): sticky top app bar
  with hamburger drawer instead of 13 wrapped nav pills, chart x-axes capped
  to ~6-8 labels, tables scrolling inside their cards with no page-level
  horizontal scroll, and full-width stacked forms.

## 1. Goals

The project should become:

- Safe against accidental data loss.
- Correct for all budgeting, projection, rollover, recurrence, import, and currency calculations.
- Secure for local, LAN, and Tailscale use.
- Installable and upgradeable without version or package mismatches.
- Accessible and usable on desktop, mobile browsers, Android, and Linux.
- Covered by committed automated tests and CI.
- Documented consistently for public users and future maintainers.

The implementation should preserve existing user databases and avoid destructive migrations.

## 2. Priority Order

| Priority | Area | Reason |
|---|---|---|
| P0 | Database safety and financial correctness | Prevent data loss and incorrect financial results |
| P0 | Installer and release correctness | Prevent installing the wrong package or no package |
| P1 | Authentication and transport security | Protect credentials and user data |
| P1 | Import/parser safety | Imported files are untrusted input |
| P1 | Automated regression tests | Prevent the same defects returning |
| P2 | Client accessibility and UX | Improve usability and reduce accidental destructive actions |
| P2 | Packaging and native-client hardening | Make desktop and Android distribution reliable |
| P3 | Documentation, CI, and maintenance workflow | Keep the public project supportable |

## 3. Phase 0: Establish a Safe Baseline

- Confirm the intended GitHub repository visibility and that releases are reachable anonymously.
- Work from a clean branch based on `main`.
- Use a temporary test data directory for every test run; never the real dev database.
- Record the current version/artifact state (root and desktop packages `3.9.0`, web
  and mobile package metadata still `1.0.0`, Android build metadata `1.0`, and
  existing local/published artifacts requiring verification).
- Preserve a complete backup of the ZorinHP development database before any migration work.
- Record baseline results for: `npm audit`, build, server startup, login/setup, CSV import,
  backup/restore, splits, projection, recurrences, multi-currency, Android and Linux clients.

## 4. Phase 1: Database and Financial Integrity

**Status: MOSTLY DONE.** Migration, split deletion, restore, projection, recurrence,
import, currency, and rollover-accumulation changes all have implementation plus
regression coverage. Open: fund `contributed_so_far` vs balance consistency,
reflected-semantics decisions (§4.10), parser ambiguous-date decision.

### 4.1 Enable SQLite foreign keys — PARTIAL

- Execute `PRAGMA foreign_keys = ON` for every master and user connection immediately after open.
- Confirm with a startup check and `PRAGMA foreign_key_check` diagnostics.
- Detect and report orphaned rows (split children, attachments, categories, etc.) before any cleanup;
  back up first; repair only known-safe rows.

### 4.2 Fix split deletion — MOSTLY DONE

- Deleting a split parent currently orphans its children because FK enforcement is off.
- With FKs on, cascade rows; also delete attachment files on disk for the parent AND all children.
- Direct split-child deletion is rejected; deleting the parent cascades to children;
  unsplit removes children and restores the parent. Re-import behavior still needs
  a dedicated regression test.

### 4.3 Make restore atomic — DONE

Garbage files, foreign SQLite databases, and the full backup→restore round trip
are covered by regression tests; schema migration-on-restore is applied.

- Validate: size, SQLite format, required tables, `integrity_check`, `foreign_key_check`, schema compat.
- Close the live handle, snapshot the current DB (timestamped `.pre-restore`), rename staging into place,
  reopen; roll back to the old file if reopen fails.
- Support database-only vs full (attachments) backup scope in the future.

### 4.4 Correct projection anchoring — PARTIAL

- Apply an anchor strictly inside the forecast range at its month.
- When the latest observation predates the requested `from`, start from the observed balance and roll
  forward to `from`, then generate the horizon.
- Return a warning when observations don't cover every account.

### 4.5 Correct recurrence posting — PARTIAL

- "Post now" posts in the current month; future-month posting is explicit and confirmed.
- A future post must not suppress the current month's item; `last_posted_month` must not move backwards.
- Keep idempotent dedup; validate month format and linked account/category.

### 4.6 Account-aware import categorization — DONE

- Apply categorization AFTER the selected account is assigned (preview and confirm).
- Show the account used in the preview; re-run rules on confirm.

### 4.7 Make account selection explicit — PARTIAL

- Require an explicit account for imports (or an explicit "Unassigned"); never silently pick the
  first Revolut account; validate the account id.

### 4.8 Currency-aware deduplication — MOSTLY DONE

- Include currency in the fingerprint; recompute normal existing keys via a
  transactional migration with occurrence indexing; preserve recurrence/split
  identities. Stable occurrence behavior after deleting/reordering imported rows
  still needs a design and regression coverage.

### 4.9 Harden date and number parsing — PARTIAL

- Validate real calendar dates; reject impossible dates; don't silently guess ambiguous slash dates.
- Support ISO, DMY, MDY, dotted, Excel serials.
- Parse German `1.234,56`, `1,234.56`, currency symbols, paren negatives, split debit/credit columns.
- Import row/sheet/cell limits are now enforced; row-level errors and an explicit
  ambiguous-date decision remain open.

### 4.10 Product semantics (decisions needed before changing math)

1. Refunds increasing rollover beyond the monthly plan — intended?
2. Funds continuing to accrue after the target date — stop or continue?
3. Review counts global vs month-scoped vs both?
4. Raw vs converted yearly exports — provide both?
5. Default server binding: localhost/Tailscale-first vs LAN-wide?
6. Stronger password policy for all new/changed passwords?
7. Repository/release public access?

## 5. Phase 2: Authentication and Server Security

**Status: MOSTLY DONE.** Sessions, headers, setup gating, login throttling (per-IP
+ per-username + password-change), timing-safe login, and AI endpoint limits are
implemented. Open: progressive delays/lockout, optional API-key-at-rest encryption.

### 5.1 Login protection — MOSTLY DONE
Rate limit by IP and username; progressive delays; generic errors; max body size; optional lockout;
async scrypt; password policy >= 8 chars (enforced for new/changed passwords).

### 5.2 Secure first-run setup — DONE
Loopback-only setup by default, or a one-time token printed by the installer/console; installer-created admin.

### 5.3 Session lifecycle — DONE
Server-side expiry from `created_at`; absolute lifetime; periodic cleanup; invalidate all sessions on
password change; keep logout.

### 5.4 Cookies and transport — MOSTLY DONE
`HttpOnly`, `SameSite=Lax/Strict`, `Secure` when HTTPS; document that plain HTTP exposes credentials on LAN;
recommend localhost / Tailscale / HTTPS reverse proxy.

### 5.5 Security headers and errors — DONE
Helmet-style headers or equivalent; CSP compatible with the built client; disable `X-Powered-By`;
JSON 404s for API; centralized error middleware; no stack traces/paths in production responses;
request-id logging via `X-Request-Id`.

### 5.6 AI security — MOSTLY DONE
Allowlist permitted tables/columns for the read-only SQL tool; exclude `settings`/credentials/audit internals;
cap limits; per-user rate limiting and history/response caps implemented; encrypt API keys at rest
(operator secret) or store only in protected config — currently satisfied by owner-only file permissions
on the per-user database; explicit at-rest encryption remains a hardening option.

### 5.7 Upload and parser limits — PARTIAL
Import file/row/sheet/cell limits, staging cleanup, umask 0077, owner-only data
directories, attachment size/mime/extension validation with magic-byte checks,
and checksum-verified installer downloads are implemented. Zip-bomb protection
for XLSX and deeper content validation remain.

### 5.8 File permissions and service hardening — MOSTLY DONE
`umask 077` is set at startup and DATA_DIR/user/upload directories are chmod'ed
owner-only; the packaged systemd unit now also ships `UMask=0077`. Health endpoint
exists. Remaining: ownership verification on upgrade and deeper systemd hardening options.

### 5.9 Resolve the `xlsx` vulnerability — MOSTLY DONE
The vulnerable `xlsx@0.18.5` dependency was replaced with the API-compatible
`@e965/xlsx@0.20.3` npm alias and parser resource limits were added. XLSX import
compatibility is covered; dedicated export fixtures and long-term replacement
maintenance review remain.

## 6. Phase 3: Client UX and Accessibility

**Status: MOSTLY DONE.** Accessible `Modal`/dialogs, destructive confirmations,
phone layout (top bar + drawer), chart/table/form responsiveness, stale-response
guards, and bulk-action failure reporting are done. Open: remaining unlabeled
controls audit, upload() 401 handling, client component tests.

- Dialog: `aria-labelledby`/`aria-describedby`, real labels, initial focus, focus trap + restore, Escape
  everywhere, no accidental overlay dismissal on destructive actions, busy/error states, `aria-live` toasts.
- Forms: explicit labels/`aria-label`, validation, `aria-invalid`, keyboard support, focus indicators,
  loading/failure states.
- Destructive actions: add confirmation to FX-rate delete, rule delete, recurrence delete, category retire,
  income clear.
- Responsive: login card <430px, mobile sidebar, ~44px touch targets, table usability, dark-mode contrast.
- State/errors: catch page `load()` errors, preserve route after 401, consistent offline banner.
- Remove or implement dead `Savings.jsx` (references nonexistent `/envelopes`).
- Performance (after correctness): `React.lazy` + `Suspense`, PWA cache-versioning.

## 7. Phase 4: Desktop and Android Clients

**Status: MOSTLY DONE.** Electron is hardened and its runtime pinned +
checksum-verified; the Android shell rework is published in v3.9.2 (signed APK
in the release). Outstanding: CI-signed APKs (needs repo secrets) and physical
phone verification; Electron has no update mechanism yet.

- Electron: move reachability check into the main process via IPC (avoids permissive CORS), validate/save
  URLs in main, navigation `will-navigate` + `setWindowOpenHandler` allowlist, `shell.openExternal`,
  `sandbox: true`, IPC sender validation.
- Android: release signing with CI secret/local keystore, version from project, never commit keystore,
  separate debug/release artifacts, verify signatures, document cleartext-HTTP tradeoffs.

## 8. Phase 5: Packaging and Release Pipeline

**Status: MOSTLY DONE.** A tag-triggered release workflow builds server/client
debs, generates checksums in-pipeline, and publishes; the APK joins when
`BP_ANDROID_KEYSTORE*` repo secrets exist. Versions are single-sourced
(package.json, enforced by CI against desktop/mobile/CHANGELOG) and stamped
into the APK by `build-apk.sh` with verification. Installer verifies checksums
and fails hard. Open: fresh-install/upgrade matrix testing (v3.6–v3.8 →
current), APK filename versioning, signed checksums.

## 9. Phase 6: Automated Tests and CI

**Status: MOSTLY DONE.** 43 server tests (unit + DB + HTTP integration, including
restore failure/round-trip, recurrence, re-import, XLSX export round-trip, and
regressions for every review finding fixed so far). CI: tests, client build,
root+client dependency audits (HIGH blocks), shellcheck on all scripts,
packaging smoke (server deb from clean checkout), version consistency
including the CHANGELOG header. Open: client component tests (React Testing
Library scaffold), APK build job (needs Android SDK + signing secrets),
upgrade-path tests.

## 10. Phase 7: Documentation and Help

**Status: MOSTLY DONE.** All docs verified against the code in the full review:
obsolete "clear storage" advice replaced, MATH.md formulas corrected,
USER_GUIDE gained Recurring + Settings backup/restore + import-error and
setup-token notes, README covers healthz/X-Request-Id/checksum
verification/AI_MODEL default, CHANGELOG deduplicated with an accurate 3.9.2
section. Open: a CONTRIBUTING guide; final pass after the Lenovo migration.

## 11. Remaining Work

Already shipped through v3.9.2: all HIGH and MEDIUM review findings, the
Android shell rework, the phone layout rework, installer checksum
verification, and the release workflow.

### Remaining engineering work
1. Client component tests (React Testing Library scaffold; Dialog/Modal, key flows).
2. ZIP-bomb protection for XLSX imports and deeper attachment content validation.
3. Electron update story (autoUpdater or apt repo) — bundled Chromium gets no fixes today.
4. Fund accounting: reconcile `contributed_so_far` with `fundBalanceAt` (manual
   contribution movements are currently double-counted in balance).
5. Transactions list pagination (>500 rows silently capped; add a hint or paging).
6. Client a11y audit: remaining unlabeled selects/inputs, upload() 401 handling,
   Reports year-input guard, currency locale consistency, Budgets month-clear guard.
7. GET endpoints that mutate (recurrence auto-post, snapshot capture) → consider
   POST + CSRF stance review.
8. Optional hardening: API-key-at-rest encryption, progressive login delays/lockout.
9. CI: add repo secrets `BP_ANDROID_KEYSTORE*` so releases carry CI-signed APKs;
   add an APK build job; version the APK filename.
10. Physical-phone verification of the v3.9.2 APK (upgrade path from debug builds).

### Deferred by owner
- Lenovo migration (was judged too early; do after a verified ZorinHP backup and
  an upgrade test on a spare machine).
- §4.10 product decisions: refund rollover semantics beyond accumulation, funds
  after target date, raw vs converted exports, parser ambiguous-slash-date policy.

## 12. Decisions Needed Before Financial Changes

See §4.10. The safest path is to begin with database integrity, installer
correctness, and regression tests before changing security or UI behavior.
