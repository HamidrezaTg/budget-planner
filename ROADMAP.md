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
- [ ] v3.13.8 Document install paths, signing, AUR publishing.
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
- [ ] v3.17.5 Dependency audit automation.
- [ ] v3.17.6 Optional Caddy/HTTPS recipes in docs.
- [ ] v3.17.7 Optional `/metrics` for Prometheus.
- [ ] v3.17.8 Tag `v3.17.0`, push `--follow-tags`.

### v3.18 — Optional big modules

- [ ] v3.18.1 Recurring templates (multi-category templates).
- [ ] v3.18.2 Multi-currency per-account display currency.
- [ ] v3.18.3 Forecast scenarios side by side.
- [ ] v3.18.4 Sharing budgets via read-only token.
- [ ] v3.18.5 ntfy.sh push notifications (Android only).
- [ ] v3.18.6 Tag `v3.18.0`, push `--follow-tags`.

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
