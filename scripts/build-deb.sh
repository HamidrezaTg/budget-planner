#!/usr/bin/env bash
# Build a Debian package: gulden-server_<version>_all.deb
# Result: dist/gulden-server_<version>_all.deb
# The package ships server + built client + production node_modules and a
# systemd service running as the system user 'budget' with data in
# /var/lib/gulden.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging Gulden $VERSION"

# application files. The deb ships the BUILT client — build it here so the
# package can never contain a stale (or missing) dist from an old dev run.
[ -f client/dist/index.html ] || { echo "==> client/dist missing — building client"; }
npm --prefix client run build
mkdir -p "$STAGE/opt/gulden" "$STAGE/DEBIAN" "$STAGE/lib/systemd/system" "$STAGE/etc/default"
mkdir -p "$STAGE/usr/bin"
cp -r server "$STAGE/opt/gulden/server"
cp -r client/dist "$STAGE/opt/gulden/client-dist-tmp"
mkdir -p "$STAGE/opt/gulden/client"
mv "$STAGE/opt/gulden/client-dist-tmp" "$STAGE/opt/gulden/client/dist"
cp package.json package-lock.json "$STAGE/opt/gulden/"

# production-only dependencies (all pure JS → Architecture: all)
echo "==> npm ci --omit=dev"
( cd "$STAGE/opt/gulden" && npm ci --omit=dev --no-audit --no-fund --loglevel=error )

# deb control files + service + defaults (version stamped from package.json)
for f in control postinst prerm postrm; do
  cp "packaging/$f" "$STAGE/DEBIAN/$f"
  chmod 755 "$STAGE/DEBIAN/$f"
done
cp packaging/conffiles "$STAGE/DEBIAN/conffiles"
chmod 644 "$STAGE/DEBIAN/conffiles"
sed -i "s/^Version: .*/Version: $VERSION/" "$STAGE/DEBIAN/control"
cp packaging/gulden.service "$STAGE/lib/systemd/system/"
cp packaging/gulden.default "$STAGE/etc/default/gulden"
cp packaging/gulden-cli "$STAGE/usr/bin/gulden"
chmod 755 "$STAGE/usr/bin/gulden"
chmod 644 "$STAGE/etc/default/gulden"

mkdir -p dist
echo "==> dpkg-deb --build"
dpkg-deb --root-owner-group --build "$STAGE" "dist/gulden-server_${VERSION}_all.deb"
ls -lh "dist/gulden-server_${VERSION}_all.deb"
echo "==> install with:  sudo apt install ./dist/gulden-server_${VERSION}_all.deb"
