#!/usr/bin/env bash
# Build the Tauri v2 desktop client. Produces:
#   - dist/budget-planner-client_<version>_amd64.deb
#   - dist/budget-planner-client_<version>_amd64.AppImage
# both wrapped around the same Rust binary the Windows/macOS scripts build.
# Mirrors scripts/build-deb-client.sh in shape (Debian metadata, control file,
# postinst); the v3.13 binary is <10 MB instead of the 110 MB Electron one.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./desktop-client-tauri/package.json').version")
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install Rust: https://rustup.rs/" >&2; exit 1;
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node.js >= 22." >&2; exit 1;
fi

echo "==> building budget-planner-client $VERSION (Tauri v2)"
pushd desktop-client-tauri >/dev/null
npm ci --no-audit --no-fund
npm run build
# Tauri requires a glibc-compatible system with libwebkit2gtk-4.1-dev.
npx --yes @tauri-apps/cli@2 build --bundles deb,appimage
popd >/dev/null

# Collect built artifacts into the project-level dist/ folder.
mkdir -p dist
find desktop-client-tauri/src-tauri/target/release/bundle -maxdepth 4 -type f \
  \( -name "*.deb" -o -name "*.AppImage" -o -name "*.msi" -o -name "*.dmg" -o -name "*.app" \) \
  -print -exec cp {} dist/ \;

ls -lh dist/ 2>/dev/null || true
echo "==> install on Debian/Ubuntu:  sudo apt install ./dist/budget-planner-client_${VERSION}_amd64.deb"
echo "==> install AppImage:            chmod +x dist/budget-planner-client_${VERSION}_amd64.AppImage && ./dist/budget-planner-client_${VERSION}_amd64.AppImage"
