#!/usr/bin/env bash
# Build budget-planner-client_<version>_amd64.deb — a desktop CLIENT only.
# Downloads the Electron runtime (~110 MB) and wraps the tiny connect-once UI.
# The app contains no backend; it connects to a server you run elsewhere.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./desktop-client/package.json').version")
ELECTRON_VERSION=$(npm view electron version)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging budget-planner-client $VERSION (electron $ELECTRON_VERSION)"

mkdir -p "$STAGE/opt/budget-planner-client" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/icons/hicolor/scalable/apps" \
         "$STAGE/DEBIAN"

echo "==> downloading electron $ELECTRON_VERSION (linux-x64)"
ZIP="$STAGE/electron.zip"
curl -fL --retry 2 -o "$ZIP" \
  "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
unzip -q -o "$ZIP" -d "$STAGE/opt/budget-planner-client"
rm "$ZIP"

# application files + launcher binary name
cp desktop-client/main.js desktop-client/preload.js desktop-client/setup.html desktop-client/package.json \
   "$STAGE/opt/budget-planner-client/"
mv "$STAGE/opt/budget-planner-client/electron" "$STAGE/opt/budget-planner-client/budget-planner-client"
chmod 755 "$STAGE/opt/budget-planner-client/budget-planner-client"

cp packaging/budget-planner-client.desktop "$STAGE/usr/share/applications/"
cp client/public/icon.svg "$STAGE/usr/share/icons/hicolor/scalable/apps/budget-planner-client.svg"

cp packaging/client-control "$STAGE/DEBIAN/control"
cp packaging/client-postinst "$STAGE/DEBIAN/postinst"
chmod 755 "$STAGE/DEBIAN/postinst"

mkdir -p dist
echo "==> dpkg-deb --build"
dpkg-deb --root-owner-group --build "$STAGE" "dist/budget-planner-client_${VERSION}_amd64.deb"
ls -lh "dist/budget-planner-client_${VERSION}_amd64.deb"
echo "==> install with:  sudo apt install ./dist/budget-planner-client_${VERSION}_amd64.deb"
