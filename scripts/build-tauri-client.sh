#!/usr/bin/env bash
# Build the Tauri v2 desktop client on the current host. On Linux this produces:
#   - dist/budget-planner-client_<version>_amd64.deb
#   - dist/budget-planner-client_<version>_amd64.AppImage
# The same command can produce the native bundle for macOS or Windows when
# invoked on those hosts; this script collects Linux artifacts only.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./desktop-client-tauri/package.json').version")
BUNDLES=${TAURI_BUNDLES:-deb,appimage}
if ! command -v cargo >/dev/null 2>&1; then
  if command -v mise >/dev/null 2>&1; then
    exec mise exec rust@stable -- "$0" "$@"
  fi
  echo "ERROR: cargo not found. Install Rust: https://rustup.rs/" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node.js >= 22." >&2; exit 1;
fi

echo "==> building budget-planner-client $VERSION (Tauri v2)"
pushd desktop-client-tauri >/dev/null
npm ci --no-audit --no-fund
npx tauri build --bundles "$BUNDLES"
popd >/dev/null

# Tauri uses the product name in bundle filenames, while the project release
# contract uses stable machine-friendly names. Normalize both here so release
# workflows and AUR URLs do not depend on spaces in the product name.
mkdir -p dist
shopt -s nullglob
deb_files=(desktop-client-tauri/src-tauri/target/release/bundle/deb/*.deb)
appimage_files=(desktop-client-tauri/src-tauri/target/release/bundle/appimage/*.AppImage)
if [[ ",$BUNDLES," == *,deb,* ]] && ((${#deb_files[@]} == 0)); then
  echo "ERROR: Tauri did not produce a .deb" >&2
  exit 1
fi
if [[ ",$BUNDLES," == *,appimage,* ]] && ((${#appimage_files[@]} == 0)); then
  echo "ERROR: Tauri did not produce an AppImage" >&2
  exit 1
fi
if [[ ",$BUNDLES," == *,deb,* ]]; then
  cp "${deb_files[0]}" "dist/budget-planner-client_${VERSION}_amd64.deb"
fi
if [[ ",$BUNDLES," == *,appimage,* ]]; then
  cp "${appimage_files[0]}" "dist/budget-planner-client_${VERSION}_amd64.AppImage"
fi

ls -lh dist/ 2>/dev/null || true
echo "==> install on Debian/Ubuntu:  sudo apt install ./dist/budget-planner-client_${VERSION}_amd64.deb"
echo "==> install AppImage:            chmod +x dist/budget-planner-client_${VERSION}_amd64.AppImage && ./dist/budget-planner-client_${VERSION}_amd64.AppImage"
