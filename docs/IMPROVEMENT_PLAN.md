# Improvement Plan — Budget Planner

> Status: active implementation plan, validated against the current codebase
> (v3.9.0). Updated 2026-08-27.

## Current Progress

The v3.9.0 implementation changes are committed on `main`, but a tagged/public
release and native artifacts still require verification.

- Verification: `npm test` passes 39 tests; `npm run build` passes; `git diff --check` passes.
- CI now installs both root and client dependencies before testing/building.
- `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities after the
  spreadsheet dependency replacement.
- The client build succeeds but emits a bundle-size warning for the main 762 kB chunk.

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

**Status: PARTIAL.** The highest-risk migration, split deletion, restore, projection,
recurrence, import, and currency changes have implementation coverage, but several
diagnostics, semantics, and parser-safety items remain open.

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

**Status: PARTIAL.** Authentication, sessions, headers, setup gating, and core SQL
execution controls are implemented; key-at-rest protection, endpoint limits, and
service hardening remain open.

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

### 5.5 Security headers and errors — MOSTLY DONE
Helmet-style headers or equivalent; CSP compatible with the built client; disable `X-Powered-By`;
JSON 404s for API; centralized error middleware; no stack traces/paths in production responses;
request-id logging.

### 5.6 AI security — PARTIAL
Allowlist permitted tables/columns for the read-only SQL tool; exclude `settings`/credentials/audit internals;
cap limits; rate-limit AI endpoints; cap history/response size; encrypt API keys at rest (operator secret)
or store only in protected config; never leak keys through SQL/AI output.

### 5.7 Upload and parser limits — PARTIAL
Import file/row/sheet/cell limits, staging cleanup, umask 0077, and owner-only data
directories are implemented. Attachment size limits, extension/content validation,
and zip-bomb protection remain.

### 5.8 File permissions and service hardening — MOSTLY DONE
`umask 077` is set at startup and DATA_DIR/user/upload directories are chmod'ed
owner-only; systemd already ships UMask. Health endpoint exists. Remaining:
ownership verification on upgrade and deeper systemd hardening options.

### 5.9 Resolve the `xlsx` vulnerability — MOSTLY DONE
The vulnerable `xlsx@0.18.5` dependency was replaced with the API-compatible
`@e965/xlsx@0.20.3` npm alias and parser resource limits were added. XLSX import
compatibility is covered; dedicated export fixtures and long-term replacement
maintenance review remain.

## 6. Phase 3: Client UX and Accessibility

**Status: PARTIAL.** Shared dialog improvements and destructive confirmations are
implemented, but custom overlays, full form labeling, page error handling, and
responsive/accessibility coverage remain.

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

**Status: LARGELY NOT DONE.** The clients build/connect, but Electron navigation and
IPC hardening plus Android release signing are still outstanding.

- Electron: move reachability check into the main process via IPC (avoids permissive CORS), validate/save
  URLs in main, navigation `will-navigate` + `setWindowOpenHandler` allowlist, `shell.openExternal`,
  `sandbox: true`, IPC sender validation.
- Android: release signing with CI secret/local keystore, version from project, never commit keystore,
  separate debug/release artifacts, verify signatures, document cleartext-HTTP tradeoffs.

## 8. Phase 5: Packaging and Release Pipeline

**Status: PARTIAL.** Installer argument handling and desktop Debian metadata stamping
are fixed; reproducible multi-artifact releases, version stamping, checksums, and
published artifact verification remain open.

- Single version source (root `package.json`); stamp server/client/Android metadata from it.
- One reproducible release command: npm ci, build client, build server `.deb`, client `.deb`, Android APK,
  SHA-256 checksums, metadata validation, manifest; fail on version mismatch.
- Installer fixes: preserve flags across sudo re-exec, don't parse JSON with Node before Node exists,
  `--client`/`--version`/`--quiet` reliability, checksum verification, clear private-repo handling.
- Every release: server `.deb`, client `.deb`, APK, checksums, notes, upgrade/rollback docs.
- Test fresh install, upgrades from v3.6–v3.8, WAL/attachment migration, failed install, rollback.

## 9. Phase 6: Automated Tests and CI

**Status: PARTIAL.** The server suite currently present in the worktree has 39 passing tests and
CI now installs client dependencies; restore-failure and recurrence paths are
covered, but client component, packaging, APK, and release tests are still missing.

- Commit a real `tests/` suite: unit (dates, dedup, FX, rollover, projection), DB integration (temp dirs),
  API (auth, isolation), import, restore, client components (dialog/destructive), packaging smoke.
- Mandatory regression tests for every confirmed defect (see findings list).
- GitHub Actions: Node 22, root/client `npm ci`, server tests, client build, package metadata checks, debug APK build,
  `npm audit` with HIGH findings blocking, and artifact version validation.

## 10. Phase 7: Documentation and Help

**Status: PARTIAL.** README, CHANGELOG, USER_GUIDE, Help, and SECURITY updates exist;
MATH/TROUBLESHOOTING synchronization and final version/release claims remain open.

Update README/CHANGELOG/USER_GUIDE/MATH/TROUBLESHOOTING/Help.jsx; add SECURITY.md, security-issue template,
contribution guide. Remove inaccurate claims (stale sidebar location, old versions, "local planner" phrasing,
package metadata mismatches).

## 11. Recommended Implementation Sequence

1. Add missing regression tests for restore failure, recurrence posting, migration compatibility, and imported-row occurrence behavior.
2. Add orphan diagnostics and startup `foreign_key_check` reporting; repair only after backup.
3. Resolve parser ambiguity, row/sheet/cell limits, explicit import-account UX, and missing-rate warnings.
4. Resolve refund/fund-goal/review-count/export semantics.
5. Harden API-key storage, AI endpoint limits, upload permissions, `umask`, health checks, request IDs, and systemd service settings.
6. Add XLSX import/export fixtures and review the replacement dependency's maintenance path.
7. Fix Electron IPC/navigation security and produce a properly signed Android release.
8. Make version stamping single-source and build server `.deb`, client `.deb`, APK, checksums, and manifests reproducibly.
9. Complete accessibility, responsive UX, and client tests.
10. Validate CI, fresh install/upgrade/restore/clients/rollback, and public release access.
11. Update all remaining docs and Help claims.
12. Test the full release on Lenovo, then migrate production data from ZorinHP only after a verified backup and rollback plan.

## 12. Decisions Needed Before Financial Changes

See §4.10. The safest path is to begin with database integrity, installer correctness, and regression
tests before changing security or UI behavior.
