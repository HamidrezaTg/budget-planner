#!/usr/bin/env node
// Read-only consistency check: every shipped metadata source must agree with
// /package.json on the version. The release pipeline runs this after
// sync-version to detect drift introduced by a manual edit or an
// out-of-band change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function expectMatch(label, file, value) {
  if (!value) {
    failures.push({ file, label, value, reason: 'missing' });
    return;
  }
  if (value !== expected) {
    failures.push({ file, label, value, reason: 'mismatch' });
  } else {
    passed.push({ file, label, value });
  }
}

const baseRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const expected = readJSON(path.join(baseRoot, 'package.json')).version;
const failures = [];
const passed = [];

expectMatch(
  'package-lock',
  'package-lock.json',
  readJSON(path.join(baseRoot, 'package-lock.json')).packages?.['']?.version,
);
expectMatch(
  'tauri-pkg',
  'desktop-client-tauri/package.json',
  readJSON(path.join(baseRoot, 'desktop-client-tauri', 'package.json')).version,
);
expectMatch(
  'tauri-lock',
  'desktop-client-tauri/package-lock.json',
  readJSON(path.join(baseRoot, 'desktop-client-tauri', 'package-lock.json')).packages?.['']
    ?.version,
);

const cargoText = fs.readFileSync(
  path.join(baseRoot, 'desktop-client-tauri', 'src-tauri', 'Cargo.toml'),
  'utf8',
);
const cargoMatch = cargoText.match(/^version\s*=\s*"(\d+\.\d+\.\d+(?:-[^"]+)?)"/m);
expectMatch('cargo', 'desktop-client-tauri/src-tauri/Cargo.toml', cargoMatch?.[1]);

const tauriText = fs.readFileSync(
  path.join(baseRoot, 'desktop-client-tauri', 'src-tauri', 'tauri.conf.json'),
  'utf8',
);
const tauriMatch = tauriText.match(/"version"\s*:\s*"(\d+\.\d+\.\d+(?:-[^"]+)?)"/);
expectMatch('tauri-conf', 'desktop-client-tauri/src-tauri/tauri.conf.json', tauriMatch?.[1]);

expectMatch(
  'mobile-pkg',
  'mobile/package.json',
  readJSON(path.join(baseRoot, 'mobile', 'package.json')).version,
);
expectMatch(
  'mobile-lock',
  'mobile/package-lock.json',
  readJSON(path.join(baseRoot, 'mobile', 'package-lock.json')).packages?.['']?.version,
);

const gradleText = fs.readFileSync(
  path.join(baseRoot, 'mobile', 'android', 'app', 'build.gradle'),
  'utf8',
);
const gradleMatch = gradleText.match(/versionName\s+"([^"]+)"/);
expectMatch('android-gradle', 'mobile/android/app/build.gradle', gradleMatch?.[1]);

const iosText = fs.readFileSync(
  path.join(baseRoot, 'mobile', 'ios', 'App', 'App', 'Info.plist'),
  'utf8',
);
const iosMatch = iosText.match(
  /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
);
expectMatch('ios-plist', 'mobile/ios/App/App/Info.plist', iosMatch?.[1]);

const xcodeText = fs.readFileSync(
  path.join(baseRoot, 'mobile', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
  'utf8',
);
const xcodeMatch = xcodeText.match(/MARKETING_VERSION\s*=\s*([^;]+);/);
expectMatch(
  'xcode-project',
  'mobile/ios/App/App.xcodeproj/project.pbxproj',
  xcodeMatch?.[1].trim(),
);

const openapiText = fs.readFileSync(path.join(baseRoot, 'docs', 'openapi.json'), 'utf8');
const openapiMatch = openapiText.match(/"version"\s*:\s*"(\d+\.\d+\.\d+(?:-[^"]+)?)"/);
expectMatch('openapi', 'docs/openapi.json', openapiMatch?.[1]);

const pkgbuildText = fs.readFileSync(
  path.join(baseRoot, 'packaging', 'aur', 'budget-planner-client', 'PKGBUILD'),
  'utf8',
);
const pkgverMatch = pkgbuildText.match(/^pkgver=(\d+\.\d+\.\d+(?:-[^]+)?)/m);
expectMatch('pkgbuild', 'packaging/aur/budget-planner-client/PKGBUILD', pkgverMatch?.[1]);

const changelogText = fs.readFileSync(path.join(baseRoot, 'CHANGELOG.md'), 'utf8');
const changelogMatch = changelogText.match(/^##\s*\[(\d+\.\d+\.\d+(?:-[^]]+)?)\][^\n]*$/m);
expectMatch('changelog', 'CHANGELOG.md', changelogMatch?.[1]);

console.log(`version-consistency: expected ${expected}, ${passed.length} match(es)`);
if (failures.length) {
  console.error('version-consistency: FAILED');
  for (const f of failures) {
    console.error(`  - ${f.file} (${f.label}) = "${f.value ?? ''}" [${f.reason}]`);
  }
  process.exit(1);
}
console.log('version-consistency: OK');
