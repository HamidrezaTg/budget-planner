# Budget Planner Roadmap

This is the working roadmap for the Budget Planner project. It is meant to be
read by you and by future AI assistants, so each step is concrete and self
contained. The project lives at `/home/hamid/projects/mimo_test/budget-planner`
and uses Node.js ≥ 22 on the server, React + Vite on the web client, and
Capacitor for the Android shell. Tauri v2 will replace the current Electron
desktop client.

## How the project is built

- Server: `server/index.js` (Express 5, `node:sqlite`).
- Web client: `client/` (Vite + React).
- Android shell: `mobile/` (Capacitor, loads the same web bundle).
- Desktop client (Tauri v2): `desktop-client-tauri/`.
- Tests: `node --test tests/*.test.js`. Each file runs in its own process with
  a temp data dir.
- Versioning: `package.json`, `desktop-client-tauri/package.json`, `mobile/package.json`
  and the first version in `CHANGELOG.md` must all match. CI enforces this.
- Git policy: commit + tag + push on green after each release step. Use
  Conventional Commits (e.g. `feat: …`, `fix: …`).

## Decisions taken for this roadmap

| Topic | Decision |
|---|---|
| Desktop shell | Replace Electron with a Tauri v2 shell that targets Linux, macOS, and Windows from one codebase |
| macOS signing | Unsigned `.dmg` for v3.14; signing later when a Developer ID is available |
| Linux channels | AppImage + AUR (Debian package stays) |
| Desktop toolchain | Rust only, no JDK |
| Linting | Add ESLint + Prettier, keep plain JavaScript |
| Integration tests | Playwright tests against the live server in v3.17 |
| Changelog flow | Keep the existing top-of-file single changelog |
| Commit text | Conventional Commits |
| Git workflow | Commit + tag + push on green after each release |

## Status of in-progress work

The v3.13 Tauri source is in the working tree and has not been released yet.
After every release step:

```
git add -A
git status
git diff --check
npm test
npm run build
git commit -m "<conventional commit message>"
git tag v<X>.<Y>.<Z>
git push --follow-tags
```

## Release steps

### v3.12 — closeout (released)

- [x] v3.12.1 Add regression test for transfer-pair import preview
      (`tests/unit-import-transfer-review.test.js`).
- [x] v3.12.2 `npm test` and `npm run build` are green.
- [x] v3.12.3 Confirm `package.json`, `mobile/package.json` and the first
      version in `CHANGELOG.md` are all `3.12.0`.
- [x] v3.12.4 Conventional-Commits commit and release tag created.
- [x] v3.12.5 Tag `v3.12.0`, push `--follow-tags`.

### v3.13 — Tauri desktop client (replaces Electron)

- [x] v3.13.1 Decide Tauri app id, icon, and bundle identifier.
- [x] v3.13.2 Scaffold `desktop-client-tauri/` with Vite,
      React. Reuse `client/dist/` as the bundled frontend (the "Brownfield"
      pattern from the Tauri docs).
- [x] v3.13.3 Port the multi-server picker from `mobile/www/index.html` into a
      shared JS module used by both shells.
- [x] v3.13.4 Add Tauri plugins: `single-instance`, `window-state`,
      `autostart`, `log`, `updater`, `os`.
- [x] v3.13.5 Wire discovery endpoint `/.well-known/budget-planner` for
      reachability checks.
- [x] v3.13.6 Add Tauri build script and AUR `PKGBUILD`.
- [x] v3.13.7 CI matrix on Linux, macOS, Windows runners is green.
- [x] v3.13.8 Document install paths, signing, AUR publishing.
- [ ] v3.13.9 Test on each OS: server picker, server switch, tray behaviour.
- [x] v3.13.10 Delete the now-redundant `desktop-client/` Electron directory.
- [x] v3.13.11 Validate all release gates, then tag `v3.13.1` and push
      `--follow-tags`.

### v3.14 — macOS polish (unsigned)

- [x] v3.14.1 `Info.plist` and `Entitlements.plist` (sandboxed + allow HTTP to
      LAN).
- [x] v3.14.2 Native menu (File / Edit / View / Help), Cmd+Q quit,
      single-instance dock.
- [x] v3.14.3 `scripts/build-dmg.sh` on a macOS GitHub runner is green.
- [x] v3.14.4 `docs/INSTALL_MAC.md` (drag-to-Applications + Gatekeeper
      "Open anyway").
- [x] v3.14.5 Tag `v3.14.0`, push `--follow-tags`.

### v3.15 — Linux polish (AppImage + AUR)

- [x] v3.15.1 Add AppImage to the Linux CI job.
- [x] v3.15.2 `scripts/build-aur.sh` generates `PKGBUILD` + `.SRCINFO`,
      `makepkg` test in a clean Arch container
      (`ghcr.io/archlinux/archlinux:latest`).
- [x] v3.15.3 `docs/INSTALL_ARCH.md` (yay + AppImage fallback).
- [ ] v3.15.4 Optional: AUR submission (you need a maintainer account).
- [x] v3.15.5 Tag `v3.15.0`, push `--follow-tags`.

### v3.16 — Usability and portfolio polish

- [x] v3.16.1 Privacy mode toggle (global CSS class on the body).
- [x] v3.16.2 Keyboard shortcuts (g+d, g+t, g+r, ? for Help).
- [ ] v3.16.3 Tauri auto-update channel (signed JSON on the GitHub release).
- [x] v3.16.4 Reports: per-category trend chart and MoM comparison.
- [x] v3.16.5 Import UX: drag-and-drop, remember last account.
- [x] v3.16.6 PDF export per month/year.
- [x] v3.16.7 Tag `v3.16.0`, push `--follow-tags`.

### v3.17 — Hardening and infrastructure

- [x] v3.17.1 Add ESLint + Prettier, hook into CI.
- [x] v3.17.2 Playwright integration tests against the live server
      (login → import → review → dashboard).
- [x] v3.17.3 OpenAPI/JSON-Schema for the API.
- [x] v3.17.4 Coverage reports: `c8` for server, `vitest --coverage` for client.
- [x] v3.17.5 Dependency audit automation.
- [x] v3.17.6 Optional Caddy/HTTPS recipes in docs.
- [x] v3.17.7 Optional `/metrics` for Prometheus.
- [x] v3.17.8 Tag `v3.17.0`, push `--follow-tags`.

### v3.18 — Optional big modules

- [x] v3.18.1 Recurring templates (multi-category templates).
- [x] v3.18.2 Multi-currency per-account display currency.
- [x] v3.18.3 Forecast scenarios side by side.
- [x] v3.18.4 Sharing budgets via read-only token.
- [x] v3.18.5 ntfy.sh push notifications (Android only).
- [x] v3.18.6 Tag `v3.18.0`, push `--follow-tags`.

## External follow-up plan

The remaining items require operating systems, external accounts, or secrets
that are not available in this Linux workspace. Keep their roadmap checkboxes
unchecked until the evidence listed below is recorded.

### v3.13.9 Native runtime checks

Use the released `v3.18.1` desktop bundles, or a newer release, and run the
checks in `docs/OS_TEST_MATRIX.md`:

- [ ] Linux: launch the `.deb` or AppImage, select a valid server, switch
      servers, test the menu/tray behavior, and confirm invalid discovery URLs
      are rejected.
- [ ] macOS: open the unsigned DMG, use **Open Anyway** if prompted, select a
      valid server, switch servers, and verify the native menu, dock, and
      single-instance behavior.
- [ ] Windows: install the NSIS or MSI bundle, select a valid server, switch
      servers, and verify taskbar/tray behavior and invalid discovery rejection.
- [ ] For every platform, confirm the client remembers valid URLs and never
      creates or exposes a local budget database.
- [ ] Record OS version, bundle filename, date, and pass/fail notes in
      `docs/OS_TEST_MATRIX.md`, then mark v3.13.9 complete.

### v3.15.4 AUR publication

This is separate from the CI package validation, which already passes:

- [ ] Create or use an AUR maintainer account with SSH access.
- [ ] From the project root, run `./scripts/build-aur.sh` to regenerate and
      validate `packaging/aur/budget-planner-client/PKGBUILD` and `.SRCINFO`.
- [ ] Clone the AUR repository with
      `git clone ssh://aur@aur.archlinux.org/budget-planner-client.git`.
- [ ] Copy the generated `PKGBUILD` and `.SRCINFO` into that checkout, review
      the version, source URL, and checksum, then commit and push to AUR.
- [ ] Verify the package can be installed from AUR, record the package URL and
      submission date, then mark v3.15.4 complete.

### v3.16.3 Tauri updater channel

The updater plugin is installed but intentionally not enabled for public
updates. Complete the implementation and key setup together:

- [ ] Generate a Tauri updater key once, or provide an existing project key,
      using `npm run tauri signer generate -- -w ~/.tauri/budget-planner.key`
      from `desktop-client-tauri/`.
- [ ] Back up the private key securely. Never commit it, paste it into chat, or
      store it in the repository. The public key may be committed.
- [ ] Add the public key and the GitHub Releases `latest.json` endpoint to the
      updater section of `desktop-client-tauri/src-tauri/tauri.conf.json`.
- [ ] Set `bundle.createUpdaterArtifacts` to `true` and update the release
      workflow to sign and publish updater artifacts for Linux, macOS, and
      Windows, including each platform's `.sig` file and static JSON metadata.
- [ ] Configure repository secrets `TAURI_SIGNING_PRIVATE_KEY` and, if used,
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Do not put either value in source.
- [ ] Install an older signed desktop build, publish a newer signed release,
      and verify the client detects, verifies, downloads, and installs the
      update on each supported OS.
- [ ] Record the public key location, endpoint, release URL, and OS results in
      `docs/DESKTOP_CLIENT.md`, then mark v3.16.3 complete.

## Postponed (per your instructions)

- GoCardless/PSD2 bank synchronization.

## Inspiration and references

These are the projects I checked while drafting this roadmap. They informed
the desktop-client and packaging choices.

- https://github.com/HamidrezaTg/budget-planner — your own project.
- https://github.com/solid-logic-studios/bucketwise-planner — Barefoot-Investor
  methodology, multi-user, DDD-style architecture.
- https://github.com/honeybearfolio/HoneyBear-Folio — Tauri + React, SQLite,
  portfolio tracking, privacy mode.
- https://github.com/MnemosyneLab/Nestworth — Local-first macOS, Tauri v2,
  signed/notarized release contract.
- https://github.com/ruja71/Personal-Finance-Manager — Tauri v2, React,
  offline, encrypted SQLite.
- https://tauri.app/distribute/macos-application-bundle/ — macOS bundle and
  `Info.plist` reference.
- https://tauri.app/distribute/appimage/ — AppImage limitations and
  build-host guidance.
- https://tauri.app/distribute/aur/ — AUR `PKGBUILD` template.
- https://tauri.app/distribute/debian/ — Debian package and cross-compile
  guide.

## Commands reference

```bash
# Run the server tests
npm test

# Build the web client
npm run build

# Build the Android APK
./scripts/build-apk.sh

# Build the server .deb
./scripts/build-deb.sh

# Tauri builds (added in v3.13)
cd desktop-client-tauri
npm run tauri dev
npm run tauri build
```

## Status snapshot at the start of v3.12.1

- Source: uncommitted, untracked files for v3.12 in the worktree.
- Tests: 63/63 passing.
- Build: green.
- Version metadata: `3.12.0` in `package.json`, `desktop-client/package.json`,
  `mobile/package.json`. First line of `CHANGELOG.md` should be `## [3.12.0]`.
