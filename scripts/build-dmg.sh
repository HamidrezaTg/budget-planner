#!/usr/bin/env bash
# Build the unsigned macOS Tauri client and copy the DMG to dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install Rust: https://rustup.rs/" >&2
  exit 1
fi

echo "==> building unsigned Gulden macOS client $VERSION"
npm --prefix desktop-client-tauri ci --no-audit --no-fund
( cd desktop-client-tauri && npx tauri build --bundles dmg )

shopt -s nullglob
dmg_files=(desktop-client-tauri/src-tauri/target/release/bundle/dmg/*.dmg)
if ((${#dmg_files[@]} == 0)); then
  echo "ERROR: Tauri did not produce a .dmg" >&2
  exit 1
fi

mkdir -p dist
ARCH=$(uname -m)
cp "${dmg_files[0]}" "dist/gulden-client_${VERSION}_${ARCH}.dmg"
ls -lh "dist/gulden-client_${VERSION}_${ARCH}.dmg"
echo "==> unsigned DMG ready for manual install; see docs/INSTALL_MAC.md"
