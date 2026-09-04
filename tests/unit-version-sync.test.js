import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(args, cwd = root) {
  return execFileSync('node', args, {
    cwd,
    encoding: 'utf8',
  });
}

test('sync-version stamps every shipped metadata source', () => {
  const staging = mkdtempSync(path.join(tmpdir(), 'bp-sync-version-'));
  try {
    // Stage a copy of the repo so the test can run idempotently.
    fsSync.cpSync(root, staging, {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        !src.includes('/data/') &&
        !src.includes('/dist/') &&
        !src.includes('/coverage/') &&
        !src.includes('/test-results/') &&
        !src.includes('/.git/'),
    });

    const newVersion = '9.99.9';
    // The changelog must lead with the target version; otherwise sync-version
    // would refuse to write.
    const changelogPath = path.join(staging, 'CHANGELOG.md');
    const originalChangelog = readFileSync(changelogPath, 'utf8');
    const stamped = `## [${newVersion}] — 2026-09-03\n\n### Added\n\n- Test release.\n\n${originalChangelog}`;
    writeFileSync(changelogPath, stamped);

    run(['scripts/sync-version.mjs', newVersion, staging], staging);

    const pkg = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'));
    assert.equal(pkg.version, newVersion);

    const lock = JSON.parse(readFileSync(path.join(staging, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages[''].version, newVersion);

    const tauriPkg = JSON.parse(
      readFileSync(path.join(staging, 'desktop-client-tauri/package.json'), 'utf8'),
    );
    assert.equal(tauriPkg.version, newVersion);

    const tauriLock = JSON.parse(
      readFileSync(path.join(staging, 'desktop-client-tauri/package-lock.json'), 'utf8'),
    );
    assert.equal(tauriLock.packages[''].version, newVersion);

    const cargo = readFileSync(
      path.join(staging, 'desktop-client-tauri/src-tauri/Cargo.toml'),
      'utf8',
    );
    assert.match(cargo, new RegExp(`^version = "${newVersion}"`, 'm'));

    const tauriConf = readFileSync(
      path.join(staging, 'desktop-client-tauri/src-tauri/tauri.conf.json'),
      'utf8',
    );
    assert.match(tauriConf, new RegExp(`"version": "${newVersion}"`));

    const mobilePkg = JSON.parse(readFileSync(path.join(staging, 'mobile/package.json'), 'utf8'));
    assert.equal(mobilePkg.version, newVersion);

    const mobileLock = JSON.parse(
      readFileSync(path.join(staging, 'mobile/package-lock.json'), 'utf8'),
    );
    assert.equal(mobileLock.packages[''].version, newVersion);

    const gradle = readFileSync(path.join(staging, 'mobile/android/app/build.gradle'), 'utf8');
    assert.match(gradle, new RegExp(`versionName "${newVersion}"`));
    assert.match(gradle, /versionCode \d+/);

    const ios = readFileSync(path.join(staging, 'mobile/ios/App/App/Info.plist'), 'utf8');
    assert.match(
      ios,
      new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${newVersion}</string>`),
    );

    const openapi = readFileSync(path.join(staging, 'docs/openapi.json'), 'utf8');
    assert.match(openapi, new RegExp(`"version": "${newVersion}"`));

    const pkgbuild = readFileSync(
      path.join(staging, 'packaging/aur/gulden-client/PKGBUILD'),
      'utf8',
    );
    assert.match(pkgbuild, new RegExp(`^pkgver=${newVersion}$`, 'm'));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test('sync-version is idempotent', () => {
  const staging = mkdtempSync(path.join(tmpdir(), 'bp-sync-version-idem-'));
  try {
    fsSync.cpSync(root, staging, {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        !src.includes('/data/') &&
        !src.includes('/dist/') &&
        !src.includes('/coverage/') &&
        !src.includes('/test-results/') &&
        !src.includes('/.git/'),
    });

    // Use a unique version, then run sync-version twice and assert no diff
    // after the first run.
    const newVersion = '7.0.0';
    const changelogPath = path.join(staging, 'CHANGELOG.md');
    const originalChangelog = readFileSync(changelogPath, 'utf8');
    writeFileSync(
      changelogPath,
      `## [${newVersion}] — 2026-09-03\n\n### Added\n\n- Idempotency test.\n\n${originalChangelog}`,
    );

    run(['scripts/sync-version.mjs', newVersion, staging], staging);
    const afterFirst = readFileSync(path.join(staging, 'package.json'), 'utf8');
    run(['scripts/sync-version.mjs', newVersion, staging], staging);
    const afterSecond = readFileSync(path.join(staging, 'package.json'), 'utf8');
    assert.equal(afterFirst, afterSecond, 'second run must be a no-op');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

test('check-version passes against the current tree', () => {
  // This only succeeds if every metadata source already agrees with
  // /package.json. After sync-version is wired into CI, a failed run points
  // to a forgotten source.
  const out = run(['scripts/check-version.mjs']);
  assert.match(out, /version-consistency: OK/);
});

test('sync-version refuses when the changelog lead is missing', () => {
  const staging = mkdtempSync(path.join(tmpdir(), 'bp-sync-version-no-changelog-'));
  try {
    fsSync.cpSync(root, staging, {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        !src.includes('/data/') &&
        !src.includes('/dist/') &&
        !src.includes('/coverage/') &&
        !src.includes('/test-results/') &&
        !src.includes('/.git/'),
    });
    // Wipe every ## [x.y.z] heading so sync-version cannot find a lead.
    const changelogPath = path.join(staging, 'CHANGELOG.md');
    const text = readFileSync(changelogPath, 'utf8');
    writeFileSync(
      changelogPath,
      text
        // Drop the leading heading + its body. The body is everything until
        // either the next ## heading or EOF.
        .replace(/^##\s*\[[^\]]+\][^\n]*\n(?:(?!^## ).*\n)*/m, '# No releases here yet\n\n')
        .replace(/^##\s*\[[^\]]+\][^\n]*\n(?:(?!^## ).*\n)*/gm, ''),
    );

    assert.throws(
      () => run(['scripts/sync-version.mjs', '9.9.9', staging], staging),
      /no ## \[<version>\] entry/,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});
