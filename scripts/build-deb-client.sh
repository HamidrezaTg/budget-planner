#!/usr/bin/env bash
# Build budget-planner-client_<version>_amd64.deb — a desktop CLIENT only.
# Downloads the Electron runtime (~110 MB) and wraps the tiny connect-once UI.
# The app contains no backend; it connects to a server you run elsewhere.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./desktop-client/package.json').version")
# Pinned, not "whatever npm view returns today": two builds of the same
# version must contain the same (verified) runtime. Bump deliberately.
ELECTRON_VERSION=44.0.0
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging budget-planner-client $VERSION (electron $ELECTRON_VERSION)"

mkdir -p "$STAGE/opt/budget-planner-client" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/icons/hicolor/scalable/apps" \
         "$STAGE/DEBIAN"

echo "==> downloading electron $ELECTRON_VERSION (linux-x64)"
ZIP="$STAGE/electron.zip"
SUMS="$STAGE/SHASUMS256.txt"
curl -fL --retry 2 -o "$ZIP" \
  "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
# Verify the runtime against the official SHASUMS256.txt before unpacking —
# this ~110 MB blob runs with full user privileges.
curl -fL --retry 2 -o "$SUMS" \
  "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/SHASUMS256.txt"
grep -qE "^[0-9a-f]{64}[[:space:]]+electron-v${ELECTRON_VERSION}-linux-x64\.zip\$" "$SUMS" || {
  echo "ERROR: electron zip not listed in SHASUMS256.txt" >&2; exit 1;
}
(cd "$STAGE" && sha256sum -c --ignore-missing SHASUMS256.txt) || {
  echo "ERROR: electron zip failed checksum verification" >&2; exit 1;
}
unzip -q -o "$ZIP" -d "$STAGE/opt/budget-planner-client"
rm "$ZIP" "$SUMS"

# application files must live in resources/app — that is where the electron
# binary looks for package.json; anything else shows the default welcome screen
APP="$STAGE/opt/budget-planner-client/resources/app"
mkdir -p "$APP"
cp desktop-client/main.js desktop-client/preload.js desktop-client/setup.html desktop-client/package.json "$APP/"
mv "$STAGE/opt/budget-planner-client/electron" "$STAGE/opt/budget-planner-client/budget-planner-client"
chmod 755 "$STAGE/opt/budget-planner-client/budget-planner-client"
# The SUID sandbox binary loses its setuid bit through zip extraction on some
# systems; without it the client fails to launch where unprivileged user
# namespaces are restricted.
if [ -f "$STAGE/opt/budget-planner-client/chrome-sandbox" ]; then
  chown root:root "$STAGE/opt/budget-planner-client/chrome-sandbox"
  chmod 4755 "$STAGE/opt/budget-planner-client/chrome-sandbox"
fi

cp packaging/budget-planner-client.desktop "$STAGE/usr/share/applications/"
cp client/public/icon.svg "$STAGE/usr/share/icons/hicolor/scalable/apps/budget-planner-client.svg"

cp packaging/client-control "$STAGE/DEBIAN/control"
cp packaging/client-postinst "$STAGE/DEBIAN/postinst"
chmod 755 "$STAGE/DEBIAN/postinst"
# stamp the Debian metadata version from desktop-client/package.json so the
# .deb filename and its control metadata can never drift apart again
sed -i "s/^Version: .*/Version: $VERSION/" "$STAGE/DEBIAN/control"

mkdir -p dist
echo "==> dpkg-deb --build"
dpkg-deb --root-owner-group --build "$STAGE" "dist/budget-planner-client_${VERSION}_amd64.deb"
ls -lh "dist/budget-planner-client_${VERSION}_amd64.deb"
echo "==> install with:  sudo apt install ./dist/budget-planner-client_${VERSION}_amd64.deb"
